# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The project's plan for cost control: its budget, else its estimate.

Cost control plans on cost lines and on the accounts' own amounts. A project
that budgets in Finance (the budget a locked BOQ produces, say) but has not
broken that budget onto cost lines yet would otherwise report a plan of zero
and a forecast of only what is already bought. Both are wrong for the same
reason: the money the project means to spend is known, it is just not on a
cost line.

So the project plan is read from the same source Finance reads: the project's
budget lines, original figure (revised where no original was set), each
converted to the project currency. Without a budget it is the
estimate, read the way Finance budgets a locked bill
(:mod:`app.modules.finance.boq_budget`): direct cost plus every markup except
VAT, which is charged on and recovered rather than spent. The bills are the
project's locked BOQs, each at its latest locked revision only (a revision
replaces the bill it revises, it does not add to it), or its most recently
edited one when none is locked. Cost control
then shows the part of that plan not on a cost line as a row of its own, whose
forecast is the plan left after the commitments already sitting on no cost
line: what the scope not yet let is still expected to cost.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ZERO = Decimal("0")

PLAN_SOURCE_BUDGET = "budget"
PLAN_SOURCE_ESTIMATE = "estimate"
PLAN_SOURCE_NONE = "none"

_INACTIVE_BOQ_STATUSES = frozenset({"archived", "closed", "cancelled", "rejected"})


@dataclass(frozen=True)
class ProjectPlan:
    """The project's plan in its own currency and where it was read from."""

    amount: Decimal
    source: str


async def project_budget_total(session: AsyncSession, project_id: uuid.UUID) -> Decimal:
    """The project budget as Finance aggregates it, in the project currency: original, else revised.

    The original, because cost control measures the forecast against the plan
    and shows what approved changes add as variance. The revised budget already
    carries those changes, so planning on it would hide every approved change
    from the variance column.
    """
    from app.modules.finance.repository import BudgetRepository
    from app.modules.finance.service import _convert_to_base, _project_fx_map
    from app.modules.projects.models import Project

    project = await session.get(Project, project_id)
    base = (getattr(project, "currency", "") or "").strip().upper() if project else ""
    fx_map = _project_fx_map(project)
    agg = await BudgetRepository(session).aggregate_for_dashboard(project_id=project_id)

    def _base(amounts: dict[str, float]) -> Decimal:
        converted, _missing = _convert_to_base(amounts, base_currency=base, fx_rates_map=fx_map)
        return Decimal(str(converted))

    original = _base(agg["original_by_currency"])
    return original if original != ZERO else _base(agg["revised_by_currency"])


def _timestamp(value: object) -> float:
    if isinstance(value, datetime):
        return value.timestamp()
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError):
        return float("-inf")


def _latest_revisions(locked: list[uuid.UUID], parent_of: dict[uuid.UUID, uuid.UUID | None]) -> list[uuid.UUID]:
    """The locked bills no later locked revision replaces.

    A revision points at the bill it revises through ``parent_estimate_id``.
    Every ancestor of a locked bill is replaced by it, whether or not the bills
    in between are locked.
    """
    superseded: set[uuid.UUID] = set()
    for boq_id in locked:
        seen = {boq_id}
        parent = parent_of.get(boq_id)
        while parent is not None and parent not in seen:
            superseded.add(parent)
            seen.add(parent)
            parent = parent_of.get(parent)
    return [boq_id for boq_id in locked if boq_id not in superseded]


async def project_estimate_total(session: AsyncSession, project_id: uuid.UUID) -> Decimal:
    """Total before VAT of the latest locked revision of each bill, else of the most recently edited live one."""
    from app.modules.boq.models import BOQ
    from app.modules.boq.service import BOQService
    from app.modules.finance.boq_budget import bill_markups

    rows = (
        await session.execute(
            select(BOQ.id, BOQ.status, BOQ.is_locked, BOQ.updated_at, BOQ.parent_estimate_id).where(
                BOQ.project_id == project_id
            )
        )
    ).all()
    chosen = _latest_revisions([r.id for r in rows if r.is_locked], {r.id: r.parent_estimate_id for r in rows})
    if not chosen:
        live = [r for r in rows if (r.status or "").lower() not in _INACTIVE_BOQ_STATUSES]
        if live:
            chosen = [max(live, key=lambda r: _timestamp(r.updated_at)).id]
    if not chosen:
        return ZERO
    totals = await BOQService(session).compute_boq_totals(chosen)
    total = ZERO
    for boq_id in chosen:
        total += Decimal(str(totals.get(boq_id, {}).get("direct_cost") or 0))
        total += sum((m.amount for m in await bill_markups(session, boq_id)), ZERO)
    return total


async def load_project_plan(session: AsyncSession, project_id: uuid.UUID) -> ProjectPlan:
    """The project's plan: its budget, else its estimate, else nothing.

    A failure to read either source is logged and reads as no plan rather than
    taking the cost report down with it.
    """
    try:
        budget = await project_budget_total(session, project_id)
    except Exception:
        logger.warning("Project budget unreadable for cost control on %s", project_id, exc_info=True)
        budget = ZERO
    if budget > ZERO:
        return ProjectPlan(budget, PLAN_SOURCE_BUDGET)
    try:
        estimate = await project_estimate_total(session, project_id)
    except Exception:
        logger.warning("Project estimate unreadable for cost control on %s", project_id, exc_info=True)
        estimate = ZERO
    if estimate > ZERO:
        return ProjectPlan(estimate, PLAN_SOURCE_ESTIMATE)
    return ProjectPlan(ZERO, PLAN_SOURCE_NONE)
