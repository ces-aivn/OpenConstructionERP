"""Integration: a flat bill is built in trade order, inside the project's dates.

A 13-line hospital bill (2017-2021, nine hundred million dollars) came back
ending in 2046, with the steel frame starting on the day the foundations did:
every loose line at the top was worked side by side from day one, square feet
and cubic yards were read as one labour hour each, and without an end date in
the request the project's own planned end was ignored. The plan is now laid
out foundations, structure, envelope, services, finishes; it fits the
project's planned dates when the request names none; and a plan that cannot
fit is only written when the person accepts the overrun.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.modules.schedule.schemas import ScheduleCreate
from app.modules.schedule.service import ScheduleService
from tests._pg import transactional_session

START = date(2017, 5, 3)
END = date(2021, 7, 31)

HOSPITAL = [
    ("1", "Excavation & support of excavation (SOE)", "CY", "120000", "85"),
    ("2", "Foundations (caissons + mat/pile caps)", "CY", "14000", "1100"),
    ("3", "Structural steel frame (~22 lb/SF)", "TON", "16500", "6500"),
    ("4", "Composite metal deck + slab-on-deck concrete", "SF", "1300000", "28"),
    ("5", "Unitized curtain wall / facade", "SF", "450000", "165"),
    ("6", "Prefabricated bathroom pods", "EA", "504", "45000"),
    ("7", "Prefab headwalls + MEP racks (off-site)", "EA", "504", "25000"),
    ("8", "Mechanical (HVAC) & plumbing", "SF", "1500000", "160"),
    ("9", "Electrical & low-voltage / IT", "SF", "1500000", "110"),
    ("10", "Fire protection", "SF", "1500000", "10"),
    ("11", "Interior construction & finishes", "SF", "1500000", "120"),
    ("12", "OR / hybrid OR & interventional fit-out (specialty)", "EA", "47", "1500000"),
    ("13", "Vertical transportation (elevators)", "EA", "36", "450000"),
]


async def _setup(session, *, planned_end: date | None = END, start_date: date | None = START):  # noqa: ANN001, ANN202
    from app.modules.boq.models import BOQ, Position
    from app.modules.projects.models import Project
    from app.modules.users.models import User

    user = User(
        email=f"trade-{uuid.uuid4().hex[:8]}@schedule-gen.io",
        hashed_password="x",
        full_name="Planner",
        role="editor",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    project = Project(
        name="Hospital",
        owner_id=user.id,
        planned_start_date=START.isoformat(),
        planned_end_date=planned_end.isoformat() if planned_end else None,
    )
    session.add(project)
    await session.flush()
    project_id = project.id
    service = ScheduleService(session)
    schedule = await service.create_schedule(
        ScheduleCreate(project_id=project_id, name="Hospital", start_date=start_date.isoformat() if start_date else None)
    )
    schedule_id = schedule.id
    boq = BOQ(project_id=project_id, name="Hospital bill")
    session.add(boq)
    await session.flush()
    boq_id = boq.id
    for order, (ordinal, description, unit, qty, rate) in enumerate(HOSPITAL, start=1):
        session.add(
            Position(
                boq_id=boq_id,
                ordinal=ordinal,
                description=description,
                unit=unit,
                quantity=qty,
                unit_rate=rate,
                total=str(float(qty) * float(rate)),
                sort_order=order,
            )
        )
    await session.flush()
    return service, schedule_id, boq_id


async def _tasks(service: ScheduleService, schedule_id: uuid.UUID) -> dict[str, tuple[date, date]]:
    service.session.expire_all()
    rows, _ = await service.list_activities_for_schedule(schedule_id, limit=1000)
    return {
        a.name: (date.fromisoformat(a.start_date), date.fromisoformat(a.end_date))
        for a in rows
        if a.activity_type == "task"
    }


@pytest.mark.asyncio
async def test_without_dates_in_the_request_the_plan_fits_the_project_window_in_trade_order() -> None:
    async with transactional_session(disable_fks=True) as session:
        service, schedule_id, boq_id = await _setup(session)
        await service.generate_from_boq(schedule_id, boq_id, None, allow_overrun=False)
        tasks = await _tasks(service, schedule_id)

        assert max(end for _, end in tasks.values()) <= END
        record = (await service.get_schedule(schedule_id)).metadata_["boq_generation"]
        assert record["fitted_window"]["source"] == "project"
        assert record["requested_end"] == END.isoformat()

        def start(prefix: str) -> date:
            return next(s for name, (s, _) in tasks.items() if name.startswith(prefix))

        assert start("Excavation") < start("Foundations") < start("Structural steel")
        assert start("Structural steel") < start("Composite metal deck") < start("Unitized curtain wall")
        assert start("Unitized curtain wall") < start("Mechanical") < start("Interior construction")
        # The services start together, the finishes after them.
        assert start("Mechanical") == start("Fire protection")
        assert start("Interior construction") > start("Electrical")


@pytest.mark.asyncio
async def test_square_feet_and_pieces_get_working_durations() -> None:
    async with transactional_session(disable_fks=True) as session:
        service, schedule_id, boq_id = await _setup(session)
        await service.generate_from_boq(schedule_id, boq_id, None)
        tasks = await _tasks(service, schedule_id)
        lifts = tasks["Vertical transportation (elevators)"]
        theatres = tasks["OR / hybrid OR & interventional fit-out (specialty)"]
        # Thirty-six lifts and forty-seven operating theatres are weeks of work,
        # not a day: their price says so even though a count of pieces cannot.
        assert (lifts[1] - lifts[0]).days >= 14
        assert (theatres[1] - theatres[0]).days >= 30


@pytest.mark.asyncio
async def test_a_plan_past_the_end_date_is_refused_unless_accepted() -> None:
    async with transactional_session(disable_fks=True) as session:
        service, schedule_id, boq_id = await _setup(session, planned_end=date(2017, 6, 2))
        with pytest.raises(HTTPException) as refused:
            await service.generate_from_boq(schedule_id, boq_id, None, allow_overrun=False)
        assert refused.value.status_code == 422
        assert refused.value.detail["error"] == "plan_exceeds_window"
        assert refused.value.detail["requested_end"] == "2017-06-02"
        assert refused.value.detail["planned_end"] > "2017-06-02"
        assert await _tasks(service, schedule_id) == {}

        await service.generate_from_boq(schedule_id, boq_id, None, allow_overrun=True)
        record = (await service.get_schedule(schedule_id)).metadata_["boq_generation"]
        assert [w["code"] for w in record["warnings"]][0] == "plan_exceeds_window"
