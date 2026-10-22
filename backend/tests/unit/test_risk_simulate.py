"""Unit tests for the Risk Register Monte Carlo simulation.

Covers:

* **Smoke**: 3 risks × 100 iterations → P50 ≤ P80 ≤ P95 (monotonic).
* **Determinism**: the same ``seed`` (or ``random.seed``) reproduces a run.
* **Edge**: project with zero risks → empty/null result, no crash.
* **Sampling**: occurrence is a Bernoulli draw on the probability and the
  impact a triangle, so a register of point estimates still yields a spread
  distribution whose mean is the register EMV (Σ probability × impact).
* **Edge**: mis-ordered triple (p10 > p90) clamped so triangular() never
  raises (regression guard for the pre-clamp version).
* Tornado entries sorted descending by contribution.
* Every run stored as its own row, newest first; ``last_simulation`` JSON
  persisted on every risk row after the run.

All tests use a transaction-isolated PostgreSQL session (rolled back on
teardown by ``tests._pg.transactional_session``) so they run fast and never
touch the production database.
"""

from __future__ import annotations

import random
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.risk.schemas import RiskCreate, RiskUpdate
from app.modules.risk.service import (
    RiskService,
    _histogram,
    _percentiles,
    _pert_triple_or_point,
)
from tests._pg import transactional_session

PROJECT_ID = uuid.uuid4()
EMPTY_PROJECT_ID = uuid.uuid4()
VND_PROJECT_ID = uuid.uuid4()
OWNER_ID = uuid.uuid4()


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    """Transaction-isolated PostgreSQL session, seeded with two projects."""
    async with transactional_session() as s:
        from app.modules.projects.models import Project
        from app.modules.users.models import User

        s.add(
            User(
                id=OWNER_ID,
                email=f"o-{uuid.uuid4().hex[:6]}@test.io",
                hashed_password="x",
                full_name="O",
            )
        )
        await s.flush()
        s.add(Project(id=PROJECT_ID, name="MC Test", owner_id=OWNER_ID, currency="EUR"))
        s.add(
            Project(
                id=EMPTY_PROJECT_ID,
                name="Empty",
                owner_id=OWNER_ID,
                currency="EUR",
            )
        )
        s.add(Project(id=VND_PROJECT_ID, name="Theme park VN", owner_id=OWNER_ID, currency="VND"))
        await s.commit()
        yield s


def _create(**overrides) -> RiskCreate:
    base = {
        "project_id": PROJECT_ID,
        "title": "Test risk",
        "probability": 0.5,
        "impact_severity": "medium",
        "impact_cost": 100_000.0,
    }
    base.update(overrides)
    return RiskCreate(**base)


async def _seed_three_risks(svc: RiskService) -> list[uuid.UUID]:
    """Seed three risks with explicit PERT triples for cost+schedule."""
    r1 = await svc.create_risk(_create(title="Foundation soil", probability=0.5))
    r2 = await svc.create_risk(_create(title="Permit delay", probability=0.3))
    r3 = await svc.create_risk(_create(title="Steel price spike", probability=0.7, impact_severity="high"))
    # Read IDs into Python locals BEFORE issuing any update — the repo
    # ``update_fields`` calls ``session.expire_all()`` which would
    # otherwise force a lazy load on r{1,2,3}.id when read post-update,
    # tripping MissingGreenlet on the sync-cursor path.
    ids = [r1.id, r2.id, r3.id]
    pert_rows = (
        (ids[0], 5_000, 10_000, 25_000, 1, 3, 10),
        (ids[1], 2_000, 8_000, 30_000, 0, 5, 20),
        (ids[2], 20_000, 50_000, 200_000, 7, 14, 60),
    )
    for risk_id, c10, c50, c90, s10, s50, s90 in pert_rows:
        await svc.repo.update_fields(
            risk_id,
            cost_p10=Decimal(c10),
            cost_p50=Decimal(c50),
            cost_p90=Decimal(c90),
            schedule_p10=s10,
            schedule_p50=s50,
            schedule_p90=s90,
        )
    return ids


# ── Pure helpers ─────────────────────────────────────────────────────────


def test_percentiles_monotonic_and_inclusive_method():
    """P50 ≤ P80 ≤ P95 on a known distribution; matches statistics.quantiles."""
    samples = [float(i) for i in range(1, 101)]  # 1..100
    p50, p80, p95 = _percentiles(samples)
    assert p50 is not None
    assert p80 is not None
    assert p95 is not None
    assert p50 <= p80 <= p95
    # Inclusive method: rank = p * (n - 1). p=0.5 on 1..100 → 49.5 → 50.5.
    assert p50 == pytest.approx(50.5)
    assert p80 == pytest.approx(80.2)
    assert p95 == pytest.approx(95.05)


def test_percentiles_empty_returns_nones():
    assert _percentiles([]) == (None, None, None)


def test_percentiles_single_sample_returns_value():
    assert _percentiles([42.0]) == (42.0, 42.0, 42.0)


def test_histogram_bin_count_sums_to_samples():
    samples = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    bins = _histogram(samples, bins=5)
    assert len(bins) == 5
    assert sum(b["count"] for b in bins) == 10


def test_histogram_empty_returns_empty():
    assert _histogram([], bins=10) == []


def test_histogram_all_identical_collapses_to_one_bin():
    bins = _histogram([3.0, 3.0, 3.0], bins=10)
    assert len(bins) == 1
    assert bins[0]["count"] == 3


def test_pert_triple_clamps_misordered():
    """p10 > p90 was a triangular() crash bug; clamp pins lo ≤ mid ≤ hi."""
    lo, mid, hi = _pert_triple_or_point(Decimal(90), Decimal(50), Decimal(10), fallback=0.0)
    assert lo <= mid <= hi


def test_pert_triple_falls_back_to_point_when_missing():
    lo, mid, hi = _pert_triple_or_point(None, None, None, fallback=42.0)
    assert lo == mid == hi == 42.0


# ── Smoke: monotonic percentiles + run completes ─────────────────────────


@pytest.mark.asyncio
async def test_simulate_smoke_monotonic_percentiles(session):
    svc = RiskService(session)
    await _seed_three_risks(svc)
    random.seed(42)  # determinism for the assertions below
    res = await svc.simulate(PROJECT_ID, iterations=100, mode="both")

    assert res["risk_count"] == 3
    assert res["iterations"] == 100
    assert res["mode"] == "both"
    assert res["currency"] == "EUR"

    # P50 ≤ P80 ≤ P95 — the whole point of the percentile contract.
    assert res["p50_cost"] is not None
    assert res["p50_cost"] <= res["p80_cost"] <= res["p95_cost"]
    assert res["p50_schedule_days"] is not None
    assert res["p50_schedule_days"] <= res["p80_schedule_days"]
    assert res["p80_schedule_days"] <= res["p95_schedule_days"]

    # Histogram is a 30-bin equal-width distribution of the cost totals.
    assert res["histogram_basis"] == "cost"
    assert len(res["histogram_bins"]) == 30
    assert sum(b["count"] for b in res["histogram_bins"]) == 100

    # Tornado entries sorted descending; at most one per risk (a risk that
    # never occurred in 100 iterations contributes nothing).
    tornado = res["tornado"]
    assert 1 <= len(tornado) <= 3
    contribs = [float(e["contribution"]) for e in tornado]
    assert contribs == sorted(contribs, reverse=True)


@pytest.mark.asyncio
async def test_simulate_persists_last_simulation_on_every_row(session):
    """Every risk row must carry the snapshot after a run."""
    svc = RiskService(session)
    risk_ids = await _seed_three_risks(svc)
    random.seed(7)
    await svc.simulate(PROJECT_ID, iterations=50, mode="cost")

    # Refresh each row and check last_simulation is populated.
    from app.modules.risk.models import RiskItem

    for rid in risk_ids:
        row = await session.get(RiskItem, rid)
        assert row is not None
        assert row.last_simulation is not None
        assert row.last_simulation["iterations"] == 50
        assert row.last_simulation["mode"] == "cost"
        assert row.last_simulation["p50_cost"] is not None
        # Money is stored as an exact decimal string, not a float.
        assert isinstance(row.last_simulation["p50_cost"], str)


# ── Regression: deterministic with the same seed ─────────────────────────


@pytest.mark.asyncio
async def test_simulate_deterministic_with_seed(session):
    """Same seed → byte-for-byte identical P50/P80/P95."""
    svc = RiskService(session)
    await _seed_three_risks(svc)

    random.seed(42)
    a = await svc.simulate(PROJECT_ID, iterations=200, mode="cost")
    random.seed(42)
    b = await svc.simulate(PROJECT_ID, iterations=200, mode="cost")

    assert a["p50_cost"] == b["p50_cost"]
    assert a["p80_cost"] == b["p80_cost"]
    assert a["p95_cost"] == b["p95_cost"]


@pytest.mark.asyncio
async def test_explicit_seed_reproduces_a_run_and_is_reported(session):
    svc = RiskService(session)
    await _seed_three_risks(svc)

    a = await svc.simulate(PROJECT_ID, iterations=500, mode="both", seed=2024)
    b = await svc.simulate(PROJECT_ID, iterations=500, mode="both", seed=2024)
    c = await svc.simulate(PROJECT_ID, iterations=500, mode="both", seed=2025)

    assert a["seed"] == b["seed"] == 2024
    assert (a["p50_cost"], a["p95_cost"], a["p80_schedule_days"]) == (
        b["p50_cost"],
        b["p95_cost"],
        b["p80_schedule_days"],
    )
    assert a["histogram_bins"] == b["histogram_bins"]
    assert a["run_id"] != b["run_id"]
    assert a["mean_cost"] != c["mean_cost"]


@pytest.mark.asyncio
async def test_a_run_without_seed_reports_the_seed_it_drew(session):
    svc = RiskService(session)
    await _seed_three_risks(svc)
    first = await svc.simulate(PROJECT_ID, iterations=300, mode="cost")
    again = await svc.simulate(PROJECT_ID, iterations=300, mode="cost", seed=first["seed"])
    assert isinstance(first["seed"], int)
    assert again["p80_cost"] == first["p80_cost"]


# ── Edge: project with zero risks ────────────────────────────────────────


@pytest.mark.asyncio
async def test_simulate_zero_risks_returns_empty_result(session):
    """No risks → no crash, all percentiles null, empty histogram/tornado."""
    svc = RiskService(session)
    res = await svc.simulate(EMPTY_PROJECT_ID, iterations=100, mode="both")

    assert res["risk_count"] == 0
    assert res["iterations"] == 100
    assert res["p50_cost"] is None
    assert res["p80_cost"] is None
    assert res["p95_cost"] is None
    assert res["p50_schedule_days"] is None
    assert res["histogram_bins"] == []
    assert res["tornado"] == []


# ── Point estimates only: occurrence is still sampled ────────────────────


@pytest.mark.asyncio
async def test_point_estimates_are_sampled_on_occurrence_not_flattened(session):
    """A register of single impact figures must not collapse to one number.

    Weighting every draw by its probability made each iteration the same
    total, so P50 = P80 = P95 and the chart held one bar. Sampling whether
    each risk happens gives the real spread.
    """
    svc = RiskService(session)
    await svc.create_risk(_create(title="A", probability=0.5, impact_cost=10_000))
    await svc.create_risk(_create(title="B", probability=0.3, impact_cost=20_000))
    await svc.create_risk(_create(title="C", probability=0.7, impact_cost=30_000))

    res = await svc.simulate(PROJECT_ID, iterations=5000, mode="cost", seed=11, impact_spread=0)

    assert res["p50_cost"] < res["p80_cost"] < res["p95_cost"]
    # Spread switched off: every total is a sum of whole impacts.
    possible = {Decimal(x) for x in (0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000)}
    assert {res["p50_cost"], res["p80_cost"], res["p95_cost"]} <= possible
    # EMV = 5000 + 6000 + 21000; the sampled mean sits on it.
    assert res["emv_cost"] == Decimal("32000.00")
    assert abs(res["mean_cost"] - res["emv_cost"]) / res["emv_cost"] < Decimal("0.03")
    assert sum(1 for b in res["histogram_bins"] if b["count"] > 0) > 1


@pytest.mark.asyncio
async def test_probability_is_read_as_entered_not_rounded_to_a_matrix_score(session):
    """0.35 is 35 %, not the 40 % of its 1-5 matrix score."""
    svc = RiskService(session)
    await svc.create_risk(_create(title="Only", probability=0.35, impact_cost=100_000))
    res = await svc.simulate(PROJECT_ID, iterations=20_000, mode="cost", seed=5, impact_spread=0)
    assert res["emv_cost"] == Decimal("35000.00")
    assert abs(res["mean_cost"] - Decimal("35000")) < Decimal("1500")


@pytest.mark.asyncio
async def test_default_spread_keeps_the_mean_and_spreads_the_impact(session):
    svc = RiskService(session)
    rid = await svc.create_risk(_create(title="Certain", probability=0.5, impact_cost=100_000))
    await svc.update_risk(rid.id, RiskUpdate(status="occurred"))
    res = await svc.simulate(PROJECT_ID, iterations=5000, mode="cost", seed=3)

    assert res["impact_spread"] == pytest.approx(0.2)
    # Occurred: it happens every time, its cost drawn from 80 000 .. 120 000.
    assert Decimal("80000") <= res["p50_cost"] < res["p80_cost"] < res["p95_cost"] <= Decimal("120000")
    assert abs(res["mean_cost"] - Decimal("100000")) < Decimal("1000")


# ── Acceptance: the theme-park register from the UAT ─────────────────────

# Six risks, 480 billion VND of impact in total and an EMV of 204 billion VND
# (Σ probability × impact): the register the UAT ran 10 000 iterations on.
THEME_PARK_RISKS = (
    ("Ground conditions", 0.5, 120_000_000_000, 30),
    ("Imported ride delay", 0.4, 100_000_000_000, 45),
    ("Steel price", 0.6, 80_000_000_000, 10),
    ("Permit change", 0.3, 60_000_000_000, 20),
    ("Monsoon flooding", 0.4, 70_000_000_000, 25),
    ("Labour shortage", 0.2, 50_000_000_000, 15),
)


@pytest.mark.asyncio
async def test_theme_park_register_gives_a_distribution_centred_on_its_emv(session):
    svc = RiskService(session)
    for title, prob, cost, days in THEME_PARK_RISKS:
        await svc.create_risk(
            _create(
                project_id=VND_PROJECT_ID,
                title=title,
                probability=prob,
                impact_cost=cost,
                impact_schedule_days=days,
                impact_severity="high",
            )
        )

    res = await svc.simulate(VND_PROJECT_ID, iterations=10_000, mode="both", seed=20261022)

    assert res["currency"] == "VND"
    assert res["p50_cost"] < res["p80_cost"] < res["p95_cost"]
    assert res["p50_schedule_days"] < res["p80_schedule_days"] < res["p95_schedule_days"]
    emv = Decimal("204000000000")
    assert res["emv_cost"] == emv
    assert abs(res["mean_cost"] - emv) / emv < Decimal("0.02")
    # 0.5x30 + 0.4x45 + 0.6x10 + 0.3x20 + 0.4x25 + 0.2x15 = 58 days expected.
    assert res["emv_schedule_days"] == pytest.approx(58.0)
    assert res["mean_schedule_days"] == pytest.approx(58.0, rel=0.03)
    # VND has no minor unit: every money figure is a whole number of dong.
    for key in ("p50_cost", "p80_cost", "p95_cost", "mean_cost"):
        assert res[key] == res[key].to_integral_value()
    # A real histogram, not one bar holding all 10 000 iterations.
    bins = res["histogram_bins"]
    assert len(bins) == 30
    assert sum(b["count"] for b in bins) == 10_000
    assert sum(1 for b in bins if b["count"] > 0) >= 15
    assert max(b["count"] for b in bins) < 10_000 // 4


# ── Every run is stored ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_each_run_is_stored_and_listed_newest_first(session):
    from app.modules.risk.schemas import RiskSimulationResult

    svc = RiskService(session)
    await _seed_three_risks(svc)
    first = await svc.simulate(PROJECT_ID, iterations=1000, mode="cost", seed=1)
    second = await svc.simulate(PROJECT_ID, iterations=2000, mode="both", seed=2)

    runs = await svc.list_simulation_runs(PROJECT_ID)
    assert [r["run_id"] for r in runs] == [second["run_id"], first["run_id"]]
    assert runs[0]["iterations"] == 2000
    assert runs[0]["seed"] == 2
    # A stored run reads back into the response model with the same figures.
    stored = RiskSimulationResult(**runs[0])
    assert stored.p80_cost == second["p80_cost"]
    assert stored.mean_cost == second["mean_cost"]
    assert await svc.list_simulation_runs(EMPTY_PROJECT_ID) == []


# ── Mode: schedule-only run skips cost percentiles ───────────────────────


@pytest.mark.asyncio
async def test_simulate_schedule_only_mode(session):
    svc = RiskService(session)
    await _seed_three_risks(svc)
    random.seed(99)
    res = await svc.simulate(PROJECT_ID, iterations=100, mode="schedule")

    assert res["mode"] == "schedule"
    assert res["p50_cost"] is None
    assert res["p50_schedule_days"] is not None
