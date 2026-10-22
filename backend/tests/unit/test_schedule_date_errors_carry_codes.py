"""A schedule or activity with bad dates is refused with a code the client can translate.

The 422 body lists Pydantic errors; the client reads ``type`` and
``ctx.field`` to say "the finish date is before the start date" in the
user's language rather than echoing the English ``msg``.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.schedule.schemas import ActivityCreate, ActivityUpdate, ScheduleCreate, ScheduleUpdate


def _only_error(exc: ValidationError) -> dict:
    errors = exc.errors()
    assert len(errors) == 1
    return errors[0]


def test_a_finish_before_the_start_is_refused_with_a_range_code() -> None:
    with pytest.raises(ValidationError) as caught:
        ScheduleCreate(project_id=uuid.uuid4(), name="Master", start_date="2026-05-10", end_date="2026-05-01")
    error = _only_error(caught.value)
    assert error["type"] == "date_range_invalid"
    assert error["ctx"] == {"field": "end_date", "start_date": "2026-05-10", "end_date": "2026-05-01"}


def test_an_impossible_calendar_date_is_refused_with_its_field() -> None:
    with pytest.raises(ValidationError) as caught:
        ScheduleUpdate(start_date="2026-02-30")
    error = _only_error(caught.value)
    assert error["type"] == "invalid_calendar_date"
    assert error["ctx"] == {"field": "start_date", "value": "2026-02-30"}


@pytest.mark.parametrize("model", [ActivityCreate, ActivityUpdate])
def test_activities_share_the_range_code(model: type) -> None:
    fields = {"start_date": "2026-05-10", "end_date": "2026-05-09"}
    if model is ActivityCreate:
        fields |= {"schedule_id": uuid.uuid4(), "name": "Pour slab"}
    with pytest.raises(ValidationError) as caught:
        model(**fields)
    assert _only_error(caught.value)["type"] == "date_range_invalid"


def test_a_same_day_range_is_accepted() -> None:
    schedule = ScheduleCreate(project_id=uuid.uuid4(), name="Master", start_date="2026-05-01", end_date="2026-05-01")
    assert schedule.end_date == "2026-05-01"
