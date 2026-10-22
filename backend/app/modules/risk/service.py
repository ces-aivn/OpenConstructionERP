# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Risk Register service - business logic for risk management.

Stateless service layer. Handles:
- Risk CRUD with auto-generated codes (R-001, R-002, ...)
- Risk score computation: probability x severity_numeric
- Summary aggregation and risk matrix data
"""

import logging
import math
import random
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import event_bus
from app.core.json_merge import merge_metadata
from app.modules.risk.contingency import (
    MATERIALISED_STATUS,
    ContingencyLine,
    DrawdownRecord,
    RiskMoney,
    allocated_amount,
    build_position,
    clamp_probability,
    default_line,
    fx_map_from_rates,
    norm_code,
    parse_drawdown_record,
    quantize_money,
    resolve_base_currency,
    risk_weight,
    to_decimal,
)
from app.modules.risk.models import RiskItem, RiskSimulationRun
from app.modules.risk.repository import RiskRepository
from app.modules.risk.schemas import (
    DEFAULT_IMPACT_SPREAD,
    SEED_MAX,
    SEVERITY_ALIASES,
    SEVERITY_CANONICAL,
    ContingencyDrawdownRequest,
    RiskCreate,
    RiskUpdate,
)

logger = logging.getLogger(__name__)
_logger_events = logging.getLogger(__name__ + ".events")


async def _safe_publish(
    name: str,
    data: dict[str, Any],
    source_module: str = "oe_risk",
) -> None:
    """Publish event safely - best-effort, never blocks the caller."""
    try:
        event_bus.publish_detached(name, data, source_module=source_module)
    except Exception:
        _logger_events.debug("Event publish skipped: %s", name)


# Severity → 1-5 numeric scale. Built from the canonical vocabulary in
# schemas.py so the request-schema regex and this map are derived from a
# single source and can never drift (F-PFO-RISK-03). SEVERITY_CANONICAL is
# ordered very_low→critical, so its index+1 is the 1-5 rank; each legacy
# alias maps onto the canonical level at the same ordinal position
# (negligible≈very_low … catastrophic≈critical).
SEVERITY_NUMERIC: dict[str, int] = {level: rank for rank, level in enumerate(SEVERITY_CANONICAL, start=1)}
SEVERITY_NUMERIC.update({alias: rank for rank, alias in enumerate(SEVERITY_ALIASES, start=1)})

# 5x5 matrix scoring: maps probability to a 1-5 score
PROBABILITY_SCORE_MAP: list[tuple[float, int]] = [
    (0.2, 1),  # very low
    (0.4, 2),  # low
    (0.6, 3),  # medium
    (0.8, 4),  # high
    (1.0, 5),  # very high
]

# Impact severity to 1-5 score for the canonical 5x5 PMBOK risk matrix.
# Identical scale to SEVERITY_NUMERIC and likewise derived from the shared
# schema vocabulary - kept as a separate name for call-site clarity.
IMPACT_SCORE_MAP: dict[str, int] = dict(SEVERITY_NUMERIC)


def _probability_to_score(probability: float) -> int:
    """Map probability (0.0-1.0) to a 1-5 score for the 5x5 matrix."""
    for threshold, score in PROBABILITY_SCORE_MAP:
        if probability <= threshold:
            return score
    return 5


def _compute_risk_tier(prob_score: int, impact_score: int) -> str:
    """Compute risk tier from probability_score x impact_score (1-25 range).

    1-4: low, 5-9: medium, 10-15: high, 16-25: critical
    """
    product = prob_score * impact_score
    if product >= 16:
        return "critical"
    if product >= 10:
        return "high"
    if product >= 5:
        return "medium"
    return "low"


def _compute_risk_score(probability: float, severity: str) -> float:
    """Compute risk score as probability x severity_numeric."""
    return round(probability * SEVERITY_NUMERIC.get(severity, 2), 2)


#: Probability axis of the matrix, low to high: the label the ``/matrix/`` cell
#: has always carried for each 1-5 probability score.
PROBABILITY_LEVELS: tuple[str, ...] = ("0.1", "0.3", "0.5", "0.7", "0.9")
#: Impact axis of the matrix, low to high (canonical severity vocabulary).
IMPACT_LEVELS: tuple[str, ...] = SEVERITY_CANONICAL


def matrix_position(probability: object, severity: str | None) -> tuple[int, int, int, str]:
    """Where one risk sits on the 5x5 matrix: the one scale of the register.

    Returns ``(probability_score, impact_score, score, tier)``: the 1-5
    probability score (``_probability_to_score``), the 1-5 impact score of the
    severity (legacy aliases map to the canonical level of the same rank), their
    product 1-25 and its tier (``_compute_risk_tier``). The matrix cells, the
    tier counts on the summary and every risk's ``risk_tier`` all come from
    here, so a risk is never "high" on one card and "low" on the grid.
    """
    prob = float(clamp_probability(probability))
    prob_score = _probability_to_score(prob)
    impact_score = IMPACT_SCORE_MAP.get(severity or "medium", IMPACT_SCORE_MAP["medium"])
    return prob_score, impact_score, prob_score * impact_score, _compute_risk_tier(prob_score, impact_score)


def expected_value(status: str | None, probability: object, impact_cost: object, *, drawn: bool = False) -> Decimal:
    """One risk's EMV: weight x cost impact (``contingency.risk_weight``).

    The register summary's ``total_exposure``, the contingency card's EMV, the
    Monte Carlo ``emv_cost`` and each risk's ``expected_value`` are all sums of
    this, so the page carries one exposure definition.
    """
    impact = to_decimal(impact_cost)
    if impact <= 0:
        return Decimal("0")
    return risk_weight(status, probability, drawn=drawn) * impact


class RiskService:
    """Business logic for risk register operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = RiskRepository(session)

    async def _get_project_currency(self, project_id: uuid.UUID) -> str:
        """Return the owning project's configured currency.

        Currency is strictly data-driven - it comes from the project record
        and nowhere else. When the project has no currency set (or the
        lookup fails) we return an empty string rather than fabricating a
        default (mirrors costmodel/finance). The UI renders a currency-less
        number instead of silently mislabelling, e.g., AED costs as EUR.
        """
        try:
            from app.modules.projects.repository import ProjectRepository

            repo = ProjectRepository(self.session)
            project = await repo.get_by_id(project_id)
            return project.currency if project and project.currency else ""
        except Exception:
            return ""

    async def _maybe_escalate(self, risk_id: uuid.UUID) -> bool:
        """Run the auto-escalation engine for one risk (on-create/update hook).

        Best-effort: escalation must never break a normal CRUD path, so any
        failure is logged and swallowed. Returns True iff the risk was
        escalated by this call.
        """
        try:
            from app.modules.risk.escalation import RiskEscalationService

            return await RiskEscalationService(self.session).evaluate_one(risk_id)
        except Exception:
            logger.debug("Risk auto-escalation hook failed for %s", risk_id, exc_info=True)
            return False

    # ── Create ────────────────────────────────────────────────────────────

    async def create_risk(
        self,
        data: RiskCreate,
        *,
        user_id: str | None = None,
    ) -> RiskItem:
        """Create a new risk item with auto-generated code."""
        count = await self.repo.count_for_project(data.project_id)
        code = f"R-{count + 1:03d}"

        # Currency is data-driven: an explicit payload value wins, else it
        # is inherited from the owning project. Never a hardcoded "EUR".
        currency = data.currency or await self._get_project_currency(data.project_id)

        risk_score = _compute_risk_score(data.probability, data.impact_severity)

        # 5x5 matrix scoring
        prob_score = _probability_to_score(data.probability)
        impact_score = IMPACT_SCORE_MAP.get(data.impact_severity, 2)
        risk_tier = _compute_risk_tier(prob_score, impact_score)

        item = RiskItem(
            project_id=data.project_id,
            code=code,
            title=data.title,
            description=data.description,
            category=data.category,
            probability=str(data.probability),
            impact_cost=str(data.impact_cost),
            impact_schedule_days=data.impact_schedule_days,
            impact_severity=data.impact_severity,
            status=data.status,
            risk_score=str(risk_score),
            probability_score=prob_score,
            impact_score_cost=impact_score,
            impact_score_time=impact_score,
            risk_tier=risk_tier,
            mitigation_strategy=data.mitigation_strategy,
            contingency_plan=data.contingency_plan,
            owner_name=data.owner_name,
            owner_user_id=data.owner_user_id,
            response_cost=str(data.response_cost),
            currency=currency,
            escalation_threshold=data.escalation_threshold,
            metadata_=data.metadata,
        )
        item = await self.repo.create(item)
        logger.info("Risk created: %s for project %s", code, data.project_id)
        # On-create escalation hook: a risk can be born already critical (or
        # imported with a lapsed review date), so evaluate it immediately.
        await self._maybe_escalate(item.id)
        await _safe_publish(
            "risk.risk.created",
            {
                "risk_id": str(item.id),
                "project_id": str(data.project_id),
                "code": code,
                "title": data.title,
            },
        )
        if data.owner_user_id is not None:
            await _safe_publish(
                "risk.assigned",
                {
                    "risk_id": str(item.id),
                    "project_id": str(data.project_id),
                    "code": code,
                    "title": data.title,
                    "owner_user_id": str(data.owner_user_id),
                    "assigned_by": user_id or "",
                },
            )
        return item

    # ── Read ──────────────────────────────────────────────────────────────

    async def get_risk(self, risk_id: uuid.UUID) -> RiskItem:
        """Get risk item by ID. Raises 404 if not found."""
        item = await self.repo.get_by_id(risk_id)
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Risk item not found",
            )
        return item

    async def list_risks(
        self,
        project_id: uuid.UUID,
        *,
        offset: int = 0,
        limit: int = 50,
        status_filter: str | None = None,
        category_filter: str | None = None,
        severity_filter: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[RiskItem], int]:
        """List risk items for a project."""
        return await self.repo.list_for_project(
            project_id,
            offset=offset,
            limit=limit,
            status=status_filter,
            category=category_filter,
            severity=severity_filter,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    # ── Update ────────────────────────────────────────────────────────────

    async def update_risk(
        self,
        risk_id: uuid.UUID,
        data: RiskUpdate,
        *,
        user_id: str | None = None,
    ) -> RiskItem:
        """Update risk item fields. Recalculates risk_score if needed."""
        item = await self.get_risk(risk_id)

        fields = data.model_dump(exclude_unset=True)
        if "metadata" in fields:
            _incoming = fields.pop("metadata")
            fields["metadata_"] = (
                merge_metadata(getattr(item, "metadata_", None), _incoming)
                if isinstance(_incoming, dict)
                else _incoming
            )

        if not fields:
            return item

        # Recalculate risk_score and 5x5 matrix scoring if probability or severity changed.
        # Stored numerics can be "" on legacy/imported rows (DB-level defaults were
        # removed), so coerce defensively like the read paths instead of float("").
        probability = fields.get("probability")
        if probability is None:
            probability = _safe_float(item.probability, 0.5)
        severity = fields.get("impact_severity", item.impact_severity)
        if "probability" in fields or "impact_severity" in fields:
            fields["risk_score"] = str(_compute_risk_score(probability, severity))
            prob_score = _probability_to_score(probability)
            impact_score = IMPACT_SCORE_MAP.get(severity, 2)
            fields["probability_score"] = prob_score
            fields["impact_score_cost"] = impact_score
            fields["impact_score_time"] = impact_score
            fields["risk_tier"] = _compute_risk_tier(prob_score, impact_score)

        # Convert float fields to strings for storage
        for key in ("probability", "impact_cost", "response_cost"):
            if key in fields:
                fields[key] = str(fields[key])

        # Snapshot owner before update so we can detect (re)assignment.
        old_owner = str(item.owner_user_id) if item.owner_user_id else None
        new_owner = fields.get("owner_user_id")
        code_s = item.code
        title_s = item.title
        project_id_s = str(item.project_id)

        await self.repo.update_fields(risk_id, **fields)
        await self.session.refresh(item)

        # On-update escalation hook: re-score may have crossed the threshold,
        # or the metadata may carry a (now lapsed) review date. Idempotent -
        # a no-op when the risk is already escalated or below threshold.
        await self._maybe_escalate(risk_id)

        logger.info("Risk updated: %s (fields=%s)", risk_id, list(fields.keys()))
        await _safe_publish(
            "risk.risk.updated",
            {
                "risk_id": str(risk_id),
                "project_id": project_id_s,
                "changes": list(fields.keys()),
            },
        )
        if "owner_user_id" in fields and new_owner is not None and str(new_owner) != old_owner:
            await _safe_publish(
                "risk.assigned",
                {
                    "risk_id": str(risk_id),
                    "project_id": project_id_s,
                    "code": code_s,
                    "title": title_s,
                    "owner_user_id": str(new_owner),
                    "assigned_by": user_id or "",
                },
            )
        return item

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_risk(self, risk_id: uuid.UUID) -> None:
        """Delete a risk item."""
        item = await self.get_risk(risk_id)  # Raises 404 if not found
        project_id = str(item.project_id)
        await self.repo.delete(risk_id)
        logger.info("Risk deleted: %s", risk_id)
        await _safe_publish(
            "risk.risk.deleted",
            {
                "risk_id": str(risk_id),
                "project_id": project_id,
            },
        )

    # ── Summary ───────────────────────────────────────────────────────────

    async def get_summary(self, project_id: uuid.UUID) -> dict[str, Any]:
        """Get aggregated stats for a project's risk register."""
        items = await self.repo.all_for_project(project_id)
        drawn_ids = await self._drawn_risk_ids(project_id) if items else set()

        by_status: dict[str, int] = {}
        by_tier: dict[str, int] = {}
        by_category: dict[str, int] = {}
        high_critical_count = 0
        mitigated_count = 0
        with_mitigation = 0
        without_mitigation = 0
        # Exposure grouped per currency. Summing impact across mixed
        # currencies under one last-wins label is wrong (F-PFO-RISK-04);
        # we keep each currency separate. "" is the bucket for risks with
        # no resolvable currency.
        exposure_by_currency: dict[str, float] = {}
        risk_scores: list[float] = []
        scored_items: list[tuple[str, float]] = []

        for item in items:
            by_status[item.status] = by_status.get(item.status, 0) + 1
            by_category[item.category] = by_category.get(item.category, 0) + 1

            # Tier from the matrix scale (matrix_position), recomputed rather
            # than read from the stored column, and only for risks the matrix
            # shows (closed ones are retired). The "High / Critical" card is
            # the count of risks in the high and critical bands of that grid,
            # so the card and the matrix can never disagree.
            if item.status != "closed":
                tier = matrix_position(item.probability, item.impact_severity)[3]
                by_tier[tier] = by_tier.get(tier, 0) + 1
                if tier in ("high", "critical"):
                    high_critical_count += 1

            # A risk counts as "mitigated" once a mitigation is in flight or
            # complete. Beyond the in-flight "mitigating" and terminal
            # "closed" states, the canonical vocabulary (schemas.STATUS_VALUES)
            # and seed data also use the explicit "mitigated" state plus
            # "monitoring" (mitigation applied, now being watched) - both were
            # previously excluded, understating the Mitigated stat card.
            if item.status in ("mitigating", "mitigated", "monitoring", "closed"):
                mitigated_count += 1

            # Mitigation tracking
            if item.mitigation_strategy and item.mitigation_strategy.strip():
                with_mitigation += 1
            else:
                without_mitigation += 1

            # Exposure = impact_cost x weight, accumulated per currency. The
            # weight is the contingency card's rule (contingency.risk_weight):
            # a closed or already drawn risk carries nothing, an occurred one
            # waiting for its drawdown carries its full impact, every other one
            # its probability.
            try:
                weight = risk_weight(item.status, item.probability, drawn=str(item.id) in drawn_ids)
                exposure = float(
                    expected_value(item.status, item.probability, item.impact_cost, drawn=str(item.id) in drawn_ids)
                )
                # A legacy / raw-written non-finite or absurd impact_cost makes
                # float() overflow to inf (no exception); inf would poison the
                # whole rollup (round(inf) -> inf -> RiskSummary 500). Skip just
                # this contribution. New rows are guarded by the schema validator.
                if math.isfinite(exposure) and weight > 0:
                    cur = item.currency or ""
                    exposure_by_currency[cur] = exposure_by_currency.get(cur, 0.0) + exposure
            except (ValueError, TypeError):
                pass

            # Risk score: ALWAYS recompute on the single canonical 0-5 scale
            # (probability x severity_numeric) instead of trusting the stored
            # risk_score, which is heterogeneous - seed rows carry a
            # cost-scaled value while API-created rows store 0-5
            # (F-PFO-RISK-06). Recomputing makes the average and ranking
            # scale-correct and comparable across seed + runtime data.
            try:
                score = _compute_risk_score(float(item.probability), item.impact_severity or "medium")
                risk_scores.append(score)
                scored_items.append((item.title, score))
            except (ValueError, TypeError):
                pass

        avg_risk_score = 0.0
        if risk_scores:
            avg_risk_score = round(sum(risk_scores) / len(risk_scores), 1)

        # Top risks sorted by score descending
        scored_items.sort(key=lambda x: x[1], reverse=True)
        top_risks = [{"title": t, "score": s} for t, s in scored_items[:5]]

        # Project currency is data-driven (resolved from the project), not
        # last-wins from item rows. total_exposure is only emitted when all
        # exposure shares a single currency; otherwise it stays 0.0 and
        # callers must read exposure_by_currency.
        project_currency = await self._get_project_currency(project_id)
        non_empty = {c: v for c, v in exposure_by_currency.items() if c}
        if len(non_empty) == 1:
            total_exposure = round(next(iter(non_empty.values())), 2)
        elif not non_empty and exposure_by_currency:
            # All exposure is currency-less - a single (unknown) bucket.
            total_exposure = round(sum(exposure_by_currency.values()), 2)
        else:
            total_exposure = 0.0

        return {
            "total": len(items),
            "total_risks": len(items),
            "by_status": by_status,
            "by_tier": by_tier,
            "by_category": by_category,
            "high_critical_count": high_critical_count,
            "avg_risk_score": avg_risk_score,
            "total_exposure": total_exposure,
            "exposure_by_currency": {c: round(v, 2) for c, v in exposure_by_currency.items()},
            "with_mitigation": with_mitigation,
            "without_mitigation": without_mitigation,
            "mitigated_count": mitigated_count,
            "top_risks": top_risks,
            "currency": project_currency,
        }

    # ── Risk Matrix ───────────────────────────────────────────────────────

    async def get_matrix(self, project_id: uuid.UUID) -> list[dict[str, Any]]:
        """Build the 5x5 risk matrix from the project's open risks.

        Rows are the 1-5 probability score, columns the 1-5 impact score of the
        severity, both read with :func:`matrix_position` - the same function
        that sets each risk's ``risk_tier`` and the summary's tier counts. Each
        cell carries its score (1-25) and tier, so the UI colours it from the
        server's bands instead of a second scale of its own. The legacy
        ``probability_level`` labels ("0.1" .. "0.9") and canonical
        ``impact_level`` names are kept on every cell. Closed risks are left out.
        """
        items = await self.repo.all_for_project(project_id)

        cells: dict[tuple[int, int], dict[str, Any]] = {}
        for p_score, prob_level in enumerate(PROBABILITY_LEVELS, start=1):
            for i_score, impact_level in enumerate(IMPACT_LEVELS, start=1):
                cells[(p_score, i_score)] = {
                    "probability_level": prob_level,
                    "impact_level": impact_level,
                    "probability_score": p_score,
                    "impact_score": i_score,
                    "score": p_score * i_score,
                    "tier": _compute_risk_tier(p_score, i_score),
                    "count": 0,
                    "risk_ids": [],
                }

        for item in items:
            if item.status == "closed":
                continue
            p_score, i_score, _, _ = matrix_position(item.probability, item.impact_severity)
            cell = cells[(p_score, i_score)]
            cell["count"] += 1
            cell["risk_ids"].append(item.id)

        return list(cells.values())

    # ── Monte Carlo simulation (v3.11 - T1) ──────────────────────────────

    async def simulate(
        self,
        project_id: uuid.UUID,
        *,
        iterations: int = 10000,
        mode: Literal["cost", "schedule", "both"] = "both",
        seed: int | None = None,
        impact_spread: float = DEFAULT_IMPACT_SPREAD,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Run a Monte Carlo simulation across this project's risks and store it.

        Every iteration decides for each risk whether it occurs - one uniform
        draw per risk compared with its weight (``contingency.risk_weight``:
        the probability, 1 for an occurred risk, 0 for a closed one; on the
        cost side also 0 once its drawdown is confirmed) - and, when it does,
        draws its cost and schedule impact from a triangular distribution: the
        three-point estimate (p10 / p50 / p90 read as low / most likely / high)
        when the risk has one, otherwise ``impact_spread`` either side of the
        stated impact, which keeps the mean at the stated impact. The totals per
        iteration form the distribution; P50 / P80 / P95 are read off it.

        The random stream comes from ``seed`` (drawn and reported when not
        given), so the same seed on the same register gives the same result.
        Each run is stored as a :class:`RiskSimulationRun` row and stamped on
        every risk's ``last_simulation``.

        Returns a dict matching :class:`RiskSimulationResult`.
        """
        iterations = max(1, min(int(iterations), 100_000))
        spread = min(max(float(impact_spread), 0.0), 0.9)
        if seed is None:
            # From the module RNG, so ``random.seed`` still pins a run in tests.
            seed = random.randint(0, SEED_MAX)
        rng = random.Random(seed)

        items = await self.repo.all_for_project(project_id)
        currency = await self._get_project_currency(project_id)
        drawn_ids = await self._drawn_risk_ids(project_id) if items and mode in ("cost", "both") else set()

        sample_cost = mode in ("cost", "both")
        sample_schedule = mode in ("schedule", "both")

        cost_weights: list[float] = []
        schedule_weights: list[float] = []
        cost_triples: list[tuple[float, float, float]] = []
        schedule_triples: list[tuple[float, float, float]] = []
        emv_cost = Decimal("0")
        emv_schedule = 0.0
        cost_currencies: set[str] = set()
        for item in items:
            drawn = str(item.id) in drawn_ids
            c_weight = float(risk_weight(item.status, item.probability, drawn=drawn))
            s_weight = float(risk_weight(item.status, item.probability))
            c_triple = _impact_triple(
                item.cost_p10, item.cost_p50, item.cost_p90, point=_safe_float(item.impact_cost), spread=spread
            )
            s_triple = _impact_triple(
                item.schedule_p10,
                item.schedule_p50,
                item.schedule_p90,
                point=float(item.impact_schedule_days or 0),
                spread=spread,
            )
            cost_weights.append(c_weight)
            schedule_weights.append(s_weight)
            cost_triples.append(c_triple)
            schedule_triples.append(s_triple)
            emv_cost += expected_value(item.status, item.probability, item.impact_cost, drawn=drawn)
            emv_schedule += s_weight * max(float(item.impact_schedule_days or 0), 0.0)
            # Currency honesty (F-PFO-RISK-04): a cost total blending two
            # currencies cannot be labelled, so it is suppressed below. A blank
            # currency inherits the project's and is not a distinct one.
            if c_weight > 0.0 and c_triple[2] > 0.0:
                cur = (item.currency or "").strip()
                if cur:
                    cost_currencies.add(cur)
        mixed_currency = len(cost_currencies) > 1
        cost_ok = sample_cost and not mixed_currency and bool(items)

        n = len(items)
        cost_totals: list[float] = []
        schedule_totals: list[float] = []
        per_risk_cost = [0.0] * n
        per_risk_schedule = [0.0] * n
        if items:
            for _ in range(iterations):
                c_total = 0.0
                s_total = 0.0
                for idx in range(n):
                    c_weight = cost_weights[idx]
                    s_weight = schedule_weights[idx]
                    if c_weight <= 0.0 and s_weight <= 0.0:
                        continue
                    # One occurrence draw per risk drives both sides: a risk
                    # that happens costs money and time in the same iteration.
                    u = rng.random()
                    if sample_cost and u < c_weight:
                        draw = _triangular(rng, cost_triples[idx])
                        c_total += draw
                        per_risk_cost[idx] += draw
                    if sample_schedule and u < s_weight:
                        draw = _triangular(rng, schedule_triples[idx])
                        s_total += draw
                        per_risk_schedule[idx] += draw
                if sample_cost:
                    cost_totals.append(c_total)
                if sample_schedule:
                    schedule_totals.append(s_total)

        def _money(value: float | None) -> Decimal | None:
            if value is None or not math.isfinite(value):
                return None
            return quantize_money(Decimal(repr(value)), currency)

        p50_cost = p80_cost = p95_cost = mean_cost = None
        if cost_ok:
            q50, q80, q95 = _percentiles(cost_totals)
            p50_cost, p80_cost, p95_cost = _money(q50), _money(q80), _money(q95)
            mean_cost = _money(sum(cost_totals) / len(cost_totals)) if cost_totals else None

        p50_sched = p80_sched = p95_sched = None
        mean_sched: float | None = None
        if sample_schedule and items:
            qs50, qs80, qs95 = _percentiles(schedule_totals)
            p50_sched, p80_sched, p95_sched = (_round_days(v) for v in (qs50, qs80, qs95))
            mean_sched = round(sum(schedule_totals) / len(schedule_totals), 1) if schedule_totals else None

        # The chart shows the cost distribution when there is one to show
        # honestly, otherwise the schedule distribution.
        if cost_ok:
            histogram_basis = "cost"
            histogram_bins = [
                {**b, "lower": _money(b["lower"]), "upper": _money(b["upper"])}
                for b in _histogram(cost_totals, bins=HISTOGRAM_BINS)
            ]
            contribs = per_risk_cost
        elif sample_schedule and items:
            histogram_basis = "schedule"
            histogram_bins = _histogram(schedule_totals, bins=HISTOGRAM_BINS)
            contribs = per_risk_schedule
        else:
            histogram_basis = ""
            histogram_bins = []
            contribs = [0.0] * n

        # Tornado: each risk's mean contribution to the total, largest first.
        tornado_entries: list[dict[str, Any]] = []
        for idx, item in enumerate(items):
            mean_contrib = contribs[idx] / iterations
            if mean_contrib <= 0.0:
                continue
            value = _money(mean_contrib) if histogram_basis == "cost" else round(mean_contrib, 2)
            tornado_entries.append({"risk_id": str(item.id), "code": item.code, "contribution": value})
        tornado_entries.sort(key=lambda e: float(e["contribution"]), reverse=True)

        run_id = uuid.uuid4()
        run_at = datetime.now(UTC)
        result: dict[str, Any] = {
            "run_id": str(run_id),
            "created_at": run_at.isoformat(),
            "seed": seed,
            "impact_spread": spread,
            "iterations": iterations,
            "risk_count": n,
            "mode": mode,
            "p50_cost": p50_cost,
            "p80_cost": p80_cost,
            "p95_cost": p95_cost,
            "mean_cost": mean_cost,
            "emv_cost": quantize_money(emv_cost, currency) if sample_cost and not mixed_currency else None,
            "p50_schedule_days": p50_sched,
            "p80_schedule_days": p80_sched,
            "p95_schedule_days": p95_sched,
            "mean_schedule_days": mean_sched,
            "emv_schedule_days": round(emv_schedule, 1) if sample_schedule else None,
            "histogram_basis": histogram_basis,
            "histogram_bins": histogram_bins,
            "tornado": tornado_entries,
            "currency": currency,
            "mixed_currency": mixed_currency,
        }

        # Stored JSON keeps money as decimal strings (exact, JSON-safe).
        stored = _json_ready(result)
        await self.repo.add_simulation_run(
            RiskSimulationRun(
                id=run_id,
                created_at=run_at,
                updated_at=run_at,
                project_id=project_id,
                created_by=user_id,
                iterations=iterations,
                mode=mode,
                seed=seed,
                result=stored,
            )
        )
        # Kept for clients that read the snapshot off a risk row. IDs are read
        # into a list first so the loop never iterates rows it is writing to.
        for risk_id in [item.id for item in items]:
            await self.repo.update_fields(risk_id, last_simulation=stored)

        logger.info(
            "Risk MC simulation: project=%s iterations=%d mode=%s risks=%d seed=%d",
            project_id,
            iterations,
            mode,
            n,
            seed,
        )
        await _safe_publish(
            "risk.simulation.completed",
            {
                "project_id": str(project_id),
                "run_id": str(run_id),
                "iterations": iterations,
                "mode": mode,
                "risk_count": n,
            },
        )
        return result

    async def list_simulation_runs(
        self, project_id: uuid.UUID, *, offset: int = 0, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Stored Monte Carlo results for a project, newest first."""
        runs = await self.repo.list_simulation_runs(project_id, offset=offset, limit=limit)
        return [run.result for run in runs if isinstance(run.result, dict) and run.result]

    async def count_simulation_runs(self, project_id: uuid.UUID) -> int:
        """How many Monte Carlo runs a project has stored."""
        return await self.repo.count_simulation_runs(project_id)

    # ── Risk-based contingency (EMV vs the finance contingency line) ─────

    async def _contingency_inputs(
        self,
        project_id: uuid.UUID,
    ) -> tuple[list[RiskMoney], list[ContingencyLine], str, dict[str, Any]]:
        """Load the register and the finance contingency lines for one project.

        Returns the risks, the lines (with their parsed drawdowns), the project
        currency and its FX table.
        """
        from app.modules.finance.service import FinanceService
        from app.modules.projects.repository import ProjectRepository

        project = await ProjectRepository(self.session).get_by_id(project_id)
        if project is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        project_currency = norm_code(getattr(project, "currency", "") or "")
        fx = fx_map_from_rates(getattr(project, "fx_rates", None))

        risks = [
            RiskMoney(
                risk_id=str(item.id),
                code=item.code,
                title=item.title,
                status=item.status,
                probability=clamp_probability(item.probability),
                impact=to_decimal(item.impact_cost),
                currency=norm_code(item.currency),
            )
            for item in await self.repo.all_for_project(project_id)
        ]

        lines: list[ContingencyLine] = []
        for budget in await FinanceService(self.session).list_contingency_lines(project_id):
            line_currency = norm_code(budget.currency_code)
            lines.append(
                ContingencyLine(
                    budget_id=str(budget.id),
                    wbs_id=budget.wbs_id,
                    currency=line_currency,
                    allocated=allocated_amount(budget.revised_budget, budget.original_budget),
                    drawdowns=_line_drawdowns(budget, line_currency or project_currency),
                )
            )
        return risks, lines, project_currency, fx

    async def _drawn_risk_ids(self, project_id: uuid.UUID) -> set[str]:
        """Ids of the risks holding a confirmed drawdown on this project's contingency.

        One read of the contingency lines, for the register summary and the
        Monte Carlo draw, which apply the card's rule (a drawn risk carries no
        cost exposure) without building the whole position.
        """
        from app.modules.finance.service import FinanceService

        return {
            record.risk_id
            for budget in await FinanceService(self.session).list_contingency_lines(project_id)
            for record in _line_drawdowns(budget, norm_code(budget.currency_code))
            if record.risk_id
        }

    async def drawn_risk_ids(self, project_id: uuid.UUID) -> set[str]:
        """Public read of :meth:`_drawn_risk_ids` for the routes that price one risk."""
        return await self._drawn_risk_ids(project_id)

    async def get_contingency_position(self, project_id: uuid.UUID) -> dict[str, Any]:
        """Risk-based contingency (EMV, P50/P80) against the finance contingency lines."""
        risks, lines, project_currency, fx = await self._contingency_inputs(project_id)
        return build_position(risks, lines, project_currency=project_currency, fx=fx)

    async def confirm_contingency_drawdown(
        self,
        project_id: uuid.UUID,
        risk_id: uuid.UUID,
        data: ContingencyDrawdownRequest,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """A person confirms the money an occurred risk draws from contingency.

        Nothing is drawn automatically when a risk's status turns to
        ``occurred``; the risk only shows up as pending on the contingency
        card until someone confirms an amount here. One drawdown per risk:
        confirming again replaces it (or moves it to another line), and
        replaying the same confirmation leaves the stored record, including
        who confirmed it and when, exactly as it was.

        Raises:
            HTTPException: 404 when the risk is not in this project or the
                line is not one of its contingency lines; 409 when the risk has
                not occurred or the project has no contingency line; 422 when
                several lines could take it and none was chosen.
        """
        from app.modules.finance.service import FinanceService

        risk = await self.get_risk(risk_id)
        if risk.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk item not found")
        if (risk.status or "").strip().lower() != MATERIALISED_STATUS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only a risk that has occurred can draw on contingency. Set its status to Occurred first.",
            )
        risk_code = risk.code
        risk_title = risk.title

        risks, lines, project_currency, fx = await self._contingency_inputs(project_id)
        if not lines:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This project has no contingency line in its finance budget. "
                    "Add a budget line with the category Contingency first."
                ),
            )
        base = resolve_base_currency(project_currency, [r.currency for r in risks] + [ln.currency for ln in lines])
        if data.budget_id is not None:
            target = next((ln for ln in lines if ln.budget_id == str(data.budget_id)), None)
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Contingency budget line not found for this project",
                )
        else:
            target = default_line(lines, base)
            if target is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="This project has several contingency lines. Choose the one to draw from.",
                )

        line_currency = norm_code(target.currency) or base
        amount = quantize_money(data.amount, line_currency)
        source = f"risk:{risk_id}"
        existing = next((d for d in target.drawdowns if d.source == source), None)
        if existing is not None and existing.amount == amount and existing.note == data.note:
            # Same confirmation replayed: keep the original record untouched.
            return build_position(risks, lines, project_currency=project_currency, fx=fx)

        # A drawdown binds contingency money: the commitment matrix is asked whether the item that
        # names this risk is released for the amount. ``ok`` without a matrix; ``block`` raises 409
        # before anything is written; ``warn`` is audited.
        from app.core import commitment_guard

        await commitment_guard.enforce(
            self.session,
            project_id=project_id,
            kind="contingency_drawdown",
            document_id=risk_id,
            new_amount=amount,
            currency=line_currency,
            actor_id=user_id,
        )

        record = {
            "amount": format(amount, "f"),
            "currency": line_currency,
            "risk_id": str(risk_id),
            "risk_code": risk_code,
            "risk_title": risk_title,
            "confirmed_by": user_id or "",
            "confirmed_at": datetime.now(UTC).isoformat(),
            "note": data.note,
        }
        await FinanceService(self.session).set_contingency_drawdown(
            project_id=project_id,
            source=source,
            budget_id=uuid.UUID(target.budget_id),
            record=record,
        )
        logger.info(
            "Contingency drawdown confirmed: risk=%s line=%s amount=%s %s",
            risk_code,
            target.budget_id,
            amount,
            line_currency,
        )
        await _safe_publish(
            "risk.contingency.drawdown_confirmed",
            {
                "project_id": str(project_id),
                "risk_id": str(risk_id),
                "budget_id": target.budget_id,
                "amount": format(amount, "f"),
                "currency": line_currency,
                "confirmed_by": user_id or "",
            },
        )
        return await self.get_contingency_position(project_id)

    async def reverse_contingency_drawdown(
        self,
        project_id: uuid.UUID,
        risk_id: uuid.UUID,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Take back a confirmed drawdown (a mistaken confirmation).

        Works for a risk that has since been deleted too: the drawdown is found
        by its source key on the project's contingency lines, not through the
        risk row.

        Raises:
            HTTPException: 404 when no drawdown is recorded for the risk.
        """
        from app.modules.finance.service import FinanceService

        _risks, lines, _currency, _fx = await self._contingency_inputs(project_id)
        source = f"risk:{risk_id}"
        holder = next((ln for ln in lines if any(d.source == source for d in ln.drawdowns)), None)
        if holder is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No contingency drawdown is recorded for this risk",
            )
        # A released commitment item that names this risk wrote the same record: it is the released
        # money, so it is taken back by aborting that item, not by reversing here.
        try:
            from app.modules.commitment_release.public import released_drawdown_for_risk
        except ImportError:
            released_item = None
        else:
            released_item = await released_drawdown_for_risk(self.session, project_id, risk_id)
        if released_item is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "drawdown_released_by_commitment",
                    "message_key": "commitment.errors.drawdown_released_by_commitment",
                    "message": (
                        f"This drawdown is the released commitment item {released_item}. "
                        "Abort that item in the commitment matrix to take the money back."
                    ),
                    "item_code": released_item,
                },
            )
        await FinanceService(self.session).set_contingency_drawdown(
            project_id=project_id,
            source=source,
            budget_id=None,
            record=None,
        )
        logger.info("Contingency drawdown reversed: risk=%s line=%s", risk_id, holder.budget_id)
        await _safe_publish(
            "risk.contingency.drawdown_reversed",
            {
                "project_id": str(project_id),
                "risk_id": str(risk_id),
                "budget_id": holder.budget_id,
                "reversed_by": user_id or "",
            },
        )
        return await self.get_contingency_position(project_id)


def _line_drawdowns(budget: Any, line_currency: str) -> tuple[DrawdownRecord, ...]:
    """The confirmed drawdowns stored on one contingency budget line's metadata."""
    from app.modules.finance.service import CONTINGENCY_DRAWDOWN_PREFIX

    records: list[DrawdownRecord] = []
    for key, raw in (getattr(budget, "metadata_", None) or {}).items():
        if not str(key).startswith(CONTINGENCY_DRAWDOWN_PREFIX):
            continue
        record = parse_drawdown_record(
            str(key)[len(CONTINGENCY_DRAWDOWN_PREFIX) :],
            raw,
            line_currency=line_currency,
        )
        if record is not None:
            records.append(record)
    return tuple(records)


# ── Monte Carlo helpers (module-level, pure) ──────────────────────────────


def _safe_float(value: object, default: float = 0.0) -> float:
    """Coerce a stored string/Decimal/None numeric to a finite float safely."""
    if value is None or value == "":
        return default
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    # A legacy / raw-written absurd value (e.g. "1e400") yields inf here with no
    # exception; inf would poison the simulation percentiles -> Pydantic 500.
    # Treat non-finite as the default. New rows are guarded by the schema.
    if not math.isfinite(result):
        return default
    return result


#: Equal-width bins of the simulated distribution chart.
HISTOGRAM_BINS = 30


def _impact_triple(
    p10: object,
    p50: object,
    p90: object,
    *,
    point: float,
    spread: float,
) -> tuple[float, float, float]:
    """(low, mode, high) of one risk's impact distribution.

    A complete three-point estimate is used as given (clamped into order). A
    risk with only its stated impact gets ``spread`` either side of it - a
    symmetric triangle, so its mean stays the stated impact. Negative values
    read as 0: an impact never reduces the total.
    """
    if all(math.isfinite(_safe_float(v, math.nan)) for v in (p10, p50, p90)):
        lo, mid, hi = _pert_triple_or_point(p10, p50, p90, fallback=point)
        if hi > lo:
            return max(lo, 0.0), max(mid, 0.0), max(hi, 0.0)
        point = mid
    point = max(point, 0.0)
    return point * (1.0 - spread), point, point * (1.0 + spread)


def _triangular(rng: random.Random, triple: tuple[float, float, float]) -> float:
    """One draw from a (low, mode, high) triangle; a point when it has no width."""
    lo, mid, hi = triple
    if hi <= lo:
        return mid
    # random.triangular takes (low, high, mode) - not (low, mode, high).
    return rng.triangular(lo, hi, mid)


def _round_days(value: float | None) -> int | None:
    return int(round(value)) if value is not None else None


def _json_ready(value: Any) -> Any:
    """A result dict with Decimals as plain decimal strings, for a JSON column."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {k: _json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_ready(v) for v in value]
    return value


def _pert_triple_or_point(
    p10: object,
    p50: object,
    p90: object,
    *,
    fallback: float,
) -> tuple[float, float, float]:
    """Return a (low, mode, high) PERT triple, with safe fallbacks.

    * If all three are present and well-ordered, return them as floats.
    * If any are missing/unparseable, treat ``fallback`` as a zero-
      variance point estimate (lo == mid == hi == fallback) - folds the
      risk into the simulation without inventing data.
    * If the triple is mis-ordered (e.g. p10 > p90) we clamp it so
      ``random.triangular`` never raises.
    """
    lo = _safe_float(p10, fallback)
    mid = _safe_float(p50, fallback)
    hi = _safe_float(p90, fallback)
    # Clamp ordering: lo ≤ mid ≤ hi. random.triangular requires lo ≤ hi
    # and the mode in [lo, hi], so a swapped triple would otherwise raise.
    if hi < lo:
        lo, hi = hi, lo
    if mid < lo:
        mid = lo
    if mid > hi:
        mid = hi
    return lo, mid, hi


def _percentiles(
    samples: list[float],
) -> tuple[float | None, float | None, float | None]:
    """Return (P50, P80, P95) - inclusive method, no numpy dependency.

    We sort once and index by rank; this matches
    ``statistics.quantiles(..., n=100, method='inclusive')[k-1]`` for
    integer percentile k, and avoids the overhead of building a 100-bin
    list when we only want three points.
    """
    if not samples:
        return None, None, None
    sorted_samples = sorted(samples)
    n = len(sorted_samples)

    def _q(p: float) -> float:
        if n == 1:
            return sorted_samples[0]
        # Inclusive method: rank h = p * (n - 1).
        h = p * (n - 1)
        lo = int(h)
        hi = min(lo + 1, n - 1)
        frac = h - lo
        return sorted_samples[lo] + (sorted_samples[hi] - sorted_samples[lo]) * frac

    return _q(0.50), _q(0.80), _q(0.95)


def _histogram(samples: list[float], *, bins: int = 10) -> list[dict[str, Any]]:
    """Build a ``bins``-wide equal-width histogram. Empty → []."""
    if not samples:
        return []
    lo = min(samples)
    hi = max(samples)
    if hi <= lo:
        # All samples identical - collapse to a single point bin so the
        # chart still has something to render.
        return [{"lower": round(lo, 2), "upper": round(hi, 2), "count": len(samples)}]
    width = (hi - lo) / bins
    counts = [0] * bins
    for s in samples:
        idx = int((s - lo) / width)
        if idx >= bins:
            idx = bins - 1
        counts[idx] += 1
    return [
        {
            "lower": round(lo + i * width, 2),
            "upper": round(lo + (i + 1) * width, 2),
            "count": counts[i],
        }
        for i in range(bins)
    ]
