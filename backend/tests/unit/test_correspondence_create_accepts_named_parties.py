"""Creating a correspondence entry never ends in a server error.

The register's sender column holds 36 characters, the length of a UUID, while
the entry form stored the sender's display name there. A directory contact such
as "FabriTec Structures - Estimating Dept" (37 characters) therefore reached
PostgreSQL as an over-long value and every create answered 500, whatever else
the user changed on the form. A sender is a contact id or a typed name: a name
that does not fit the id column is kept in ``from_name``, and anything longer
than that column is refused with a 422.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

from tests.unit.test_correspondence import (  # noqa: F401 - fixture re-export
    _build_app,
    _make_project,
    _make_user,
    db_session,
)

UAT_SENDER = "FabriTec Structures - Estimating Dept"


def _body(project_id: uuid.UUID, **overrides) -> dict:
    body = {
        "project_id": str(project_id),
        "subject": "Thông báo sự kiện trì hoãn – mưa kỷ lục 2017 (CO-001)",
        "direction": "outgoing",
        "correspondence_type": "letter",
        "from_contact_id": UAT_SENDER,
        "to_contact_ids": ["StadCo LA (Owner)"],
        "date_sent": "2017-03-10",
        "date_received": "2017-03-12",
        "status": "awaiting_response",
        "response_required_by": "2017-03-24",
        "contract_clause_ref": "GC 8.3.2",
        "linked_document_ids": [],
        "linked_transmittal_id": None,
        "linked_rfi_id": None,
        "notes": "Record rainfall, February 2017.",
    }
    body.update(overrides)
    return body


async def _post(db_session, owner_id, body):
    app = _build_app(db_session, caller_id=str(owner_id))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/v1/correspondence/", json=body)


async def _owner_and_project(db_session):
    owner_id = await _make_user(db_session)
    project_id = await _make_project(db_session, owner_id)
    await db_session.commit()
    return owner_id, project_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {},
        {"response_required_by": None},
        {"response_required_by": None, "contract_clause_ref": None},
        {"response_required_by": None, "contract_clause_ref": None, "to_contact_ids": []},
        {"date_sent": "2026-10-20", "date_received": "2026-10-21"},
        {"correspondence_type": "email", "direction": "incoming", "subject": "Test email"},
    ],
    ids=["full", "no-deadline", "no-clause", "no-recipient", "dates-2026", "email"],
)
async def test_the_entry_is_created_with_a_long_sender_name(db_session, overrides):
    owner_id, project_id = await _owner_and_project(db_session)
    resp = await _post(db_session, owner_id, _body(project_id, **overrides))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["from_name"] == UAT_SENDER
    assert body["from_contact_id"] is None


@pytest.mark.asyncio
async def test_a_typed_sender_up_to_the_cap_is_kept_and_a_longer_one_is_a_validation_error(db_session):
    owner_id, project_id = await _owner_and_project(db_session)
    ok = await _post(db_session, owner_id, _body(project_id, from_contact_id="S" * 255))
    assert ok.status_code == 201, ok.text
    too_long = await _post(db_session, owner_id, _body(project_id, from_contact_id="S" * 256))
    assert too_long.status_code == 422, too_long.text
    long_recipient = await _post(db_session, owner_id, _body(project_id, to_contact_ids=["R" * 256]))
    assert long_recipient.status_code == 422, long_recipient.text


@pytest.mark.asyncio
async def test_a_link_that_is_not_a_record_id_is_a_validation_error(db_session):
    owner_id, project_id = await _owner_and_project(db_session)
    resp = await _post(db_session, owner_id, _body(project_id, linked_rfi_id="RFI-001"))
    assert resp.status_code == 422, resp.text


async def _change_order(db_session, project_id) -> str:
    from app.modules.changeorders.models import ChangeOrder

    order = ChangeOrder(project_id=project_id, code=f"CO-{uuid.uuid4().hex[:4]}", title="Mưa kỷ lục")
    db_session.add(order)
    await db_session.flush()
    await db_session.commit()
    return str(order.id)


@pytest.mark.asyncio
async def test_a_notice_can_point_at_a_change_order(db_session):
    owner_id, project_id = await _owner_and_project(db_session)
    change_order_id = await _change_order(db_session, project_id)
    resp = await _post(db_session, owner_id, _body(project_id, linked_change_order_id=change_order_id))
    assert resp.status_code == 201, resp.text
    assert resp.json()["linked_change_order_id"] == change_order_id


@pytest.mark.asyncio
@pytest.mark.parametrize("whose", ["other_project", "missing"])
async def test_a_notice_cannot_point_at_a_change_order_outside_its_project(db_session, whose):
    owner_id, project_id = await _owner_and_project(db_session)
    if whose == "other_project":
        other_project = await _make_project(db_session, owner_id)
        change_order_id = await _change_order(db_session, other_project)
    else:
        change_order_id = str(uuid.uuid4())
    resp = await _post(db_session, owner_id, _body(project_id, linked_change_order_id=change_order_id))
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "correspondence_change_order_not_in_project"
    assert detail["field"] == "linked_change_order_id"


@pytest.mark.asyncio
async def test_a_picked_contact_keeps_its_id_and_its_name(db_session):
    owner_id, project_id = await _owner_and_project(db_session)
    contact_id = str(uuid.uuid4())
    resp = await _post(
        db_session, owner_id, _body(project_id, from_contact_id=contact_id, from_name=UAT_SENDER)
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["from_contact_id"] == contact_id
    assert resp.json()["from_name"] == UAT_SENDER


@pytest.mark.asyncio
async def test_a_short_typed_sender_still_reads_from_the_id_column(db_session):
    """Readers elsewhere (reconciliation, change intelligence) read the sender
    from ``from_contact_id``; a short typed name keeps reaching them there."""
    owner_id, project_id = await _owner_and_project(db_session)
    resp = await _post(db_session, owner_id, _body(project_id, from_contact_id="StadCo LA"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["from_contact_id"] == "StadCo LA"
    assert resp.json()["from_name"] == "StadCo LA"


@pytest.mark.asyncio
async def test_editing_the_sender_to_a_long_name_does_not_fail(db_session):
    owner_id, project_id = await _owner_and_project(db_session)
    created = await _post(db_session, owner_id, _body(project_id, from_contact_id="Short"))
    assert created.status_code == 201, created.text
    app = _build_app(db_session, caller_id=str(owner_id))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.patch(
            f"/v1/correspondence/{created.json()['id']}", json={"from_contact_id": UAT_SENDER}
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["from_name"] == UAT_SENDER
    assert resp.json()["from_contact_id"] is None


def test_the_register_prints_the_saved_name_for_a_typed_or_unknown_sender():
    from types import SimpleNamespace

    from app.modules.correspondence.pdf_export import _sender

    contact_id = str(uuid.uuid4())
    typed = SimpleNamespace(from_contact_id=None, from_name=UAT_SENDER)
    picked = SimpleNamespace(from_contact_id=contact_id, from_name="Old name")
    assert _sender(typed, {}) == UAT_SENDER
    assert _sender(picked, {contact_id: "FabriTec Structures"}) == "FabriTec Structures"
    assert _sender(picked, {}) == "Old name"
