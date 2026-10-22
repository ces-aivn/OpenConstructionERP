# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Earned value comes from progress and planned value from the programme.

A snapshot created with no figures used to take earned value from the money
committed and planned value as the whole budget on any date, so a project with
a third of its work bought read as three percent on schedule and a third over
budget's worth under it. These tests pin the derivation: EV is the budget times
the percent complete, PV the budget times the share of the 4D programme due by
the snapshot date. The same programme draws the plan line of the physical
progress S-curve, and the record-progress dialog can pick any priced position.

Runs on a throwaway PostgreSQL database.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.boq.models import BOQ, Position
from app.modules.finance.models import ProjectBudget
from app.modules.finance.schemas import EVMSnapshotCreate
from app.modules.finance.service import FinanceService
from app.modules.full_evm.progress_baseline import (
    EARNED_NONE,
    EARNED_PHYSICAL_PROGRESS,
    EARNED_SCHEDULE_PROGRESS,
    PLANNED_NONE,
    PLANNED_PROGRESS_PLAN,
    PLANNED_PROJECT_DATES,
    PLANNED_SCHEDULE,
    PLANNED_SCHEDULE_BASELINE,
    linear_planned_pct,
    load_progress_baseline,
)
from app.modules.progress.models import ProgressPlan
from app.modules.progress.schedule_plan import period_end, period_labels_between, period_start
from app.modules.progress.schemas import ProgressEntryCreate
from app.modules.progress.service import ProgressService
from app.modules.projects.models import Project
from app.modules.schedule.models import Activity, Schedule, ScheduleBaseline
from app.modules.users.models import User
from tests._pg import isolated_engine

D = Decimal
AS_OF = "2026-10-22"

#: Done by the status date: 600k of 1M of planned cost.
_DONE = {"start": "2026-01-05", "end": "2026-02-27", "cost": "600000", "progress": "100"}
#: Not due yet at the status date: the other 400k.
_LATER = {"start": "2026-11-02", "end": "2026-12-31", "cost": "400000", "progress": "0"}


@pytest_asyncio.fixture(scope="module")
async def _module_db() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    async with isolated_engine() as engine:
        yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def session(_module_db: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with _module_db() as s:
        yield s


async def _project(
    session: AsyncSession,
    *,
    budget: str | None = "2000000",
    actual: str = "300000",
    activities: list[dict[str, str]] | None = None,
    planned_dates: tuple[str, str] | None = None,
) -> uuid.UUID:
    user = User(
        email=f"evm-{uuid.uuid4().hex[:10]}@datadrivenconstruction.io",
        hashed_password="x" * 16,
        full_name="EVM Test",
    )
    session.add(user)
    await session.flush()
    project = Project(
        id=uuid.uuid4(),
        name=f"EVM {uuid.uuid4().hex[:6]}",
        owner_id=user.id,
        currency="USD",
        region="US",
        classification_standard="masterformat",
        metadata_={},
        fx_rates=[],
        planned_start_date=planned_dates[0] if planned_dates else None,
        planned_end_date=planned_dates[1] if planned_dates else None,
    )
    session.add(project)
    await session.flush()
    if budget is not None:
        session.add(
            ProjectBudget(
                project_id=project.id,
                category="construction",
                currency_code="USD",
                original_budget=D(budget),
                revised_budget=D(budget),
                actual=D(actual),
            )
        )
    if activities:
        schedule = Schedule(project_id=project.id, name="Master", schedule_type="master")
        session.add(schedule)
        await session.flush()
        for i, spec in enumerate(activities):
            session.add(
                Activity(
                    schedule_id=schedule.id,
                    name=f"A{i}",
                    start_date=spec["start"],
                    end_date=spec["end"],
                    progress_pct=spec.get("progress", "0"),
                    activity_type="task",
                    cost_planned=D(spec["cost"]) if spec.get("cost") else None,
                )
            )
    await session.commit()
    return project.id


async def _record(session: AsyncSession, project_id: uuid.UUID, period: str, pct: float, **kw: Any) -> None:
    await ProgressService(session).record_entry(
        ProgressEntryCreate(project_id=project_id, period_label=period, percent_complete=pct, **kw)
    )
    await session.commit()


async def _snapshot(session: AsyncSession, project_id: uuid.UUID) -> Any:
    snap = await FinanceService(session).create_evm_snapshot(
        EVMSnapshotCreate(project_id=project_id, snapshot_date=AS_OF)
    )
    await session.commit()
    return snap


# ── Period labels ────────────────────────────────────────────────────────────


def test_period_labels_name_their_last_and_first_day() -> None:
    assert period_end("2023-11").isoformat() == "2023-11-30"  # type: ignore[union-attr]
    assert period_start("2023-11").isoformat() == "2023-11-01"  # type: ignore[union-attr]
    assert period_end("2024-02").isoformat() == "2024-02-29"  # type: ignore[union-attr]
    assert period_end("2026-W01").isoformat() == "2026-01-04"  # type: ignore[union-attr]
    assert period_start("2026-W01").isoformat() == "2025-12-29"  # type: ignore[union-attr]
    assert period_end("2026-Q2").isoformat() == "2026-06-30"  # type: ignore[union-attr]
    assert period_end("W21") is None
    assert period_end("2026-13") is None


def test_generated_months_cover_the_whole_programme() -> None:
    assert period_labels_between(date(2023, 11, 15), date(2024, 2, 1), "month") == [
        "2023-11",
        "2023-12",
        "2024-01",
        "2024-02",
    ]
    assert period_labels_between(date(2026, 1, 1), date(2026, 7, 1), "quarter") == ["2026-Q1", "2026-Q2", "2026-Q3"]


def test_a_straight_line_plan_needs_both_dates() -> None:
    assert linear_planned_pct(None, date(2026, 12, 31), date(2026, 6, 1)) is None
    assert linear_planned_pct(date(2026, 1, 1), date(2026, 1, 11), date(2026, 1, 6)) == D("50")
    assert linear_planned_pct(date(2026, 1, 1), date(2026, 1, 11), date(2027, 1, 1)) == D("100")


# ── The EVM snapshot ─────────────────────────────────────────────────────────


async def test_ev_is_budget_times_physical_progress_and_pv_follows_the_programme(session: AsyncSession) -> None:
    pid = await _project(session, activities=[_DONE, _LATER])
    await _record(session, pid, "2026-10", 45.0)

    snap = await _snapshot(session, pid)

    assert D(snap.bac) == D("2000000")
    # 60 % of the planned cost is due by the status date.
    assert D(snap.pv) == D("1200000.00")
    # 45 % complete, not the money committed.
    assert D(snap.ev) == D("900000.00")
    assert D(snap.ac) == D("300000")
    assert D(snap.spi) == D("0.7500")
    assert D(snap.cpi) == D("3.0000")
    assert snap.metadata_["earned_source"] == EARNED_PHYSICAL_PROGRESS
    assert snap.metadata_["planned_source"] == PLANNED_SCHEDULE
    assert snap.metadata_["planned_pct"] == "60.00"


async def test_without_physical_progress_the_schedule_progress_is_earned(session: AsyncSession) -> None:
    pid = await _project(session, activities=[_DONE, _LATER])

    snap = await _snapshot(session, pid)

    assert D(snap.ev) == D("1200000.00")
    assert D(snap.spi) == D("1.0000")
    assert snap.metadata_["earned_source"] == EARNED_SCHEDULE_PROGRESS


async def test_an_active_baseline_is_the_plan_measured_against(session: AsyncSession) -> None:
    pid = await _project(session, activities=[_DONE, _LATER])
    schedule_id = (await session.execute(Schedule.__table__.select().where(Schedule.project_id == pid))).first().id
    activity_ids = [
        row.id
        for row in (await session.execute(Activity.__table__.select().where(Activity.schedule_id == schedule_id)))
    ]
    # The baseline had both activities finished by the end of September.
    session.add(
        ScheduleBaseline(
            schedule_id=schedule_id,
            project_id=pid,
            name="Original",
            baseline_date="2026-01-01",
            snapshot_data={
                "activities": [
                    {"id": str(a), "start_date": "2026-01-05", "end_date": "2026-09-30"} for a in activity_ids
                ]
            },
            is_active=True,
        )
    )
    await session.commit()

    baseline = await load_progress_baseline(session, pid, date(2026, 10, 22))

    assert baseline.planned_pct == D("100")
    assert baseline.planned_source == PLANNED_SCHEDULE_BASELINE


async def test_without_a_schedule_the_entered_plan_then_the_project_dates_give_pv(session: AsyncSession) -> None:
    pid = await _project(session, planned_dates=("2026-01-01", "2026-12-31"))
    on = date(2026, 10, 22)
    by_dates = await load_progress_baseline(session, pid, on)
    assert by_dates.planned_source == PLANNED_PROJECT_DATES
    assert by_dates.planned_pct is not None and D("79") < by_dates.planned_pct < D("81")
    assert (by_dates.earned_pct, by_dates.earned_source) == (D("0"), EARNED_NONE)

    session.add(ProgressPlan(project_id=pid, period_label="2026-09", planned_pct=70.0))
    session.add(ProgressPlan(project_id=pid, period_label="2026-11", planned_pct=90.0))
    await session.commit()
    by_plan = await load_progress_baseline(session, pid, on)
    assert (by_plan.planned_pct, by_plan.planned_source) == (D("70"), PLANNED_PROGRESS_PLAN)


async def test_no_plan_anywhere_is_reported_as_no_plan(session: AsyncSession) -> None:
    pid = await _project(session)
    baseline = await load_progress_baseline(session, pid, date(2026, 10, 22))
    assert (baseline.planned_pct, baseline.planned_source) == (None, PLANNED_NONE)
    snap = await _snapshot(session, pid)
    assert D(snap.pv) == D("0")
    assert D(snap.ev) == D("0")


async def test_a_reading_in_a_later_period_does_not_count_before_it(session: AsyncSession) -> None:
    pid = await _project(session, activities=[_DONE, _LATER])
    await _record(session, pid, "2026-09", 40.0)
    await _record(session, pid, "2026-12", 95.0)
    baseline = await load_progress_baseline(session, pid, date(2026, 10, 22))
    assert baseline.earned_pct == D("40")


# ── The physical-progress S-curve ────────────────────────────────────────────


async def test_the_s_curve_plan_comes_from_the_4d_programme(session: AsyncSession) -> None:
    pid = await _project(session, activities=[_DONE, _LATER])
    await _record(session, pid, "2026-01", 10.0)
    await _record(session, pid, "2026-03", 55.0)
    session.add(ProgressPlan(project_id=pid, period_label="2026-02", planned_pct=42.0))
    await session.commit()

    curve = await ProgressService(session).get_s_curve(pid)
    by_period = {p.period_label: p for p in curve.points}

    assert list(by_period) == [f"2026-{m:02d}" for m in range(1, 13)]
    assert curve.plan_source == "mixed"
    # Entered by hand wins for its period.
    assert (by_period["2026-02"].planned_cumulative_pct, by_period["2026-02"].planned_source) == (42.0, "manual")
    # The first activity is finished by the end of March, the second not started before November.
    assert by_period["2026-03"].planned_cumulative_pct == 60.0
    assert by_period["2026-03"].planned_source == "schedule"
    assert by_period["2026-10"].planned_cumulative_pct == 60.0
    assert by_period["2026-12"].planned_cumulative_pct == 100.0
    # Actual stops being a measurement after the last reading.
    assert by_period["2026-03"].actual_recorded is True
    assert by_period["2026-04"].actual_recorded is False
    assert by_period["2026-04"].actual_cumulative_pct == 55.0


async def test_without_a_programme_the_s_curve_keeps_its_own_periods(session: AsyncSession) -> None:
    pid = await _project(session)
    await _record(session, pid, "2023-11", 30.0)
    await _record(session, pid, "2024-11", 90.0)

    curve = await ProgressService(session).get_s_curve(pid)

    assert [p.period_label for p in curve.points] == ["2023-11", "2024-11"]
    assert curve.plan_source == "none"
    assert all(p.planned_cumulative_pct is None for p in curve.points)


# ── Positions progress can be recorded against ───────────────────────────────


async def _boq(session: AsyncSession, project_id: uuid.UUID) -> dict[str, uuid.UUID]:
    boq = BOQ(id=uuid.uuid4(), project_id=project_id, name="LEGO main", is_locked=True, status="final")
    session.add(boq)
    await session.flush()
    section = Position(
        id=uuid.uuid4(), boq_id=boq.id, ordinal="01", description="Section", unit="", quantity="0", sort_order=0
    )
    session.add(section)
    await session.flush()
    ids = {"section": section.id}
    for key, ordinal, qty, rate, total in (
        ("priced", "01.001", "100", "50", "5000"),
        ("rate_only", "01.002", "10", "7", "0"),
        ("unpriced", "01.003", "10", "0", "0"),
    ):
        position = Position(
            id=uuid.uuid4(),
            boq_id=boq.id,
            parent_id=section.id,
            ordinal=ordinal,
            description=key,
            unit="m2",
            quantity=qty,
            unit_rate=rate,
            total=total,
            sort_order=len(ids),
        )
        session.add(position)
        ids[key] = position.id
    await session.commit()
    return ids


async def test_every_priced_leaf_can_be_measured_before_any_reading(session: AsyncSession) -> None:
    pid = await _project(session)
    ids = await _boq(session, pid)

    listing = await ProgressService(session).list_trackable_positions(pid)

    assert [p.boq_position_id for p in listing.positions] == [ids["priced"], ids["rate_only"]]
    assert listing.positions[0].total == "5000"
    assert listing.positions[1].total == "70"
    assert all(p.percent_complete is None for p in listing.positions)

    await _record(session, pid, "2026-10", 30.0, boq_position_id=ids["priced"])
    listing = await ProgressService(session).list_trackable_positions(pid)
    assert D(listing.positions[0].percent_complete or "0") == D("30")


async def test_a_reading_against_another_projects_position_is_refused(session: AsyncSession) -> None:
    pid = await _project(session)
    other = await _project(session)
    ids = await _boq(session, other)

    with pytest.raises(HTTPException) as exc:
        await ProgressService(session).record_entry(
            ProgressEntryCreate(
                project_id=pid, period_label="2026-10", percent_complete=10, boq_position_id=ids["priced"]
            )
        )
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "progress.position_not_in_project"  # type: ignore[index]
    assert exc.value.detail["field"] == "boq_position_id"  # type: ignore[index]


def test_planned_and_earned_value_round_half_up_like_the_other_money() -> None:
    from app.modules.full_evm.progress_baseline import ProgressBaseline, planned_earned_from

    baseline = ProgressBaseline(
        as_of=date(2026, 10, 23),
        earned_pct=Decimal("50"),
        earned_source="physical_progress",
        planned_pct=Decimal("12.345"),
        planned_source="schedule",
    )
    # 50 % of 5 dong is 2.5 and 50 % of 1 dong is 0.5: half-up gives 3 and 1,
    # banker's rounding would give 2 and 0.
    assert planned_earned_from(baseline, bac=Decimal("5"), currency="VND").ev == Decimal("3")
    assert planned_earned_from(baseline, bac=Decimal("1"), currency="VND").ev == Decimal("1")
    assert planned_earned_from(baseline, bac=Decimal("1"), currency="VND").metadata()["planned_pct"] == "12.35"
