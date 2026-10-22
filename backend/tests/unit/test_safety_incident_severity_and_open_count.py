"""An incident's severity is the reporter's choice, and "open" is one rule.

A crane collapse reported as property damage used to be stored as ``minor``
because the create schema defaulted the severity and the form never asked.
The service now refuses a harmful incident without a severity, with a coded
error the UI can translate, and only a near miss may leave it out.

The dashboard's "open incidents" tile added two statuses on the client and
missed ``corrective_action``; the stats endpoint now returns the count itself,
from the same tuple of open statuses.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.safety.schemas import OPEN_INCIDENT_STATUSES, IncidentCreate
from tests.unit.test_safety import PROJECT_ID, _make_service, _StatsSession


def _data(**overrides) -> IncidentCreate:
    base = {
        "project_id": PROJECT_ID,
        "incident_date": "2017-03-10",
        "incident_type": "property_damage",
        "description": "Tower crane boom collapsed onto the laydown area",
    }
    base.update(overrides)
    return IncidentCreate(**base)


@pytest.mark.asyncio
async def test_a_harmful_incident_without_a_severity_is_refused_with_a_code() -> None:
    svc = _make_service()
    with pytest.raises(HTTPException) as exc:
        await svc.create_incident(_data(), user_id="u1")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "safety_incident_severity_required"
    assert exc.value.detail["field"] == "severity"


@pytest.mark.asyncio
async def test_the_chosen_severity_is_stored_as_chosen() -> None:
    svc = _make_service()
    with patch("app.modules.safety.service.event_bus.publish_detached", new_callable=MagicMock):
        inc = await svc.create_incident(_data(severity="critical"), user_id="u1")
    assert inc.severity == "critical"


@pytest.mark.asyncio
async def test_a_near_miss_may_leave_severity_out_and_is_minor() -> None:
    svc = _make_service()
    with patch("app.modules.safety.service.event_bus.publish_detached", new_callable=MagicMock):
        inc = await svc.create_incident(_data(incident_type="near_miss"), user_id="u1")
    assert inc.severity == "minor"


@pytest.mark.asyncio
@pytest.mark.parametrize(("treatment", "recordable"), [("lost_time", True), ("fatality", True), ("first_aid", False)])
async def test_lost_time_and_fatality_are_choosable_and_osha_recordable(treatment: str, recordable: bool) -> None:
    svc = _make_service()
    with patch("app.modules.safety.service.event_bus.publish_detached", new_callable=MagicMock):
        inc = await svc.create_incident(
            _data(incident_type="injury", severity="severe", treatment_type=treatment), user_id="u1"
        )
    assert inc.treatment_type == treatment
    assert inc.osha_recordable is recordable


def test_an_unknown_treatment_is_still_refused() -> None:
    with pytest.raises(ValidationError):
        _data(severity="major", treatment_type="amputation")


@pytest.mark.asyncio
async def test_open_incidents_counts_every_open_status() -> None:
    def row(status: str) -> SimpleNamespace:
        return SimpleNamespace(
            id=uuid.uuid4(),
            incident_number="INC-001",
            incident_date="2017-03-10",
            incident_type="property_damage",
            status=status,
            treatment_type=None,
            days_lost=0,
            corrective_actions=[],
        )

    svc = _make_service()
    statuses = [*OPEN_INCIDENT_STATUSES, "closed"]
    svc.session = _StatsSession([row(s) for s in statuses], [])
    stats = await svc.get_stats(PROJECT_ID)
    assert stats.open_incidents == len(OPEN_INCIDENT_STATUSES) == 3
    assert stats.total_incidents == 4
