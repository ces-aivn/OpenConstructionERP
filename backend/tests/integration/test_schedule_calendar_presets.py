"""Integration: a project calendar from a ready-made one, holidays filled in by the server.

A Vietnamese site plans six days a week around Tết, Giỗ Tổ, 30/4, 1/5 and
Quốc khánh; an American one plans five around the federal holidays. The
project picks either as a named calendar, its holidays filled in for the
project's years, and the list says which one a project of its country
starts from.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.modules.schedule_advanced.schemas import CalendarFromPreset
from app.modules.schedule_advanced.service import ScheduleAdvancedService
from tests._pg import transactional_session


async def _project(session, **fields) -> uuid.UUID:  # noqa: ANN001, ANN003
    from app.modules.projects.models import Project
    from app.modules.users.models import User

    user = User(
        email=f"cal-{uuid.uuid4().hex[:8]}@schedule-cal.io",
        hashed_password="x",
        full_name="Planner",
        role="editor",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    project = Project(name="Calendar QA", owner_id=user.id, **fields)
    session.add(project)
    await session.flush()
    return project.id


@pytest.mark.asyncio
async def test_a_vietnamese_project_defaults_to_the_six_day_calendar() -> None:
    async with transactional_session() as session:
        project_id = await _project(session, region="Vietnam")
        listing = await ScheduleAdvancedService(session).calendar_presets(project_id)
        assert listing["default_preset"] == "vn_6day"
        assert {p["key"] for p in listing["presets"]} == {"vn_6day", "vn_5day", "us_federal"}

        us = await _project(session, region="US", country_code="US")
        assert (await ScheduleAdvancedService(session).calendar_presets(us))["default_preset"] == "us_federal"


@pytest.mark.asyncio
async def test_a_preset_calendar_carries_the_holidays_of_the_project_years() -> None:
    async with transactional_session() as session:
        project_id = await _project(
            session, region="Vietnam", planned_start_date="2022-08-22", planned_end_date="2025-06-30"
        )
        service = ScheduleAdvancedService(session)
        calendar = await service.create_calendar_from_preset(
            CalendarFromPreset(project_id=project_id, preset="vn_6day", is_default=True)
        )
        assert calendar.work_days == [0, 1, 2, 3, 4, 5]
        assert calendar.is_default is True
        holidays = set(calendar.holidays)
        # Tết 2023 and 2025, Quốc khánh 2022 with its extra day, 30/4/2025.
        assert {"2023-01-22", "2025-01-29", "2022-09-01", "2022-09-02", "2025-04-30"} <= holidays
        assert min(holidays) >= "2022-01-01" and max(holidays) <= "2025-12-31"


@pytest.mark.asyncio
async def test_a_reversed_year_range_is_refused_with_a_code() -> None:
    async with transactional_session() as session:
        project_id = await _project(session)
        with pytest.raises(HTTPException) as refused:
            await ScheduleAdvancedService(session).create_calendar_from_preset(
                CalendarFromPreset(project_id=project_id, preset="us_federal", start_year=2026, end_year=2020)
            )
        assert refused.value.status_code == 422
        assert refused.value.detail["error"] == "calendar_preset_years_invalid"
