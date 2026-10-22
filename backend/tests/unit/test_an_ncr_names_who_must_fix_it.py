"""A person raising an NCR names who is responsible for putting it right.

The NCR used to be created by one click from a failed inspection with no
description confirmed, an automatic severity and nobody answerable for it, and
the responsible party could only ever be an internal user, never the
subcontractor that did the work. Pinned here:

* the user-facing create refuses an NCR with no responsible party, with a code
  the client translates;
* a subcontractor (or any directory party) is stored by id with a name
  snapshot, and a typed name is kept as text;
* raising an NCR from a failed inspection uses what the user confirmed in the
  prefilled form, and still requires the responsible party;
* reassigning may change the party but never clear it.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user_id, get_current_user_payload, get_session, verify_project_access
from app.modules.inspections.models import QualityInspection
from app.modules.inspections.router import router as inspections_router
from app.modules.ncr.router import router as ncr_router
from app.modules.ncr.schemas import NCRCreate, NCRUpdate
from app.modules.ncr.service import NCRService, require_responsible_party
from app.modules.projects.models import Project
from app.modules.users.models import User
from tests._pg import transactional_session

SUB_ID = str(uuid.uuid4())


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with transactional_session() as s:
        yield s


async def _owner_and_project(session: AsyncSession) -> tuple[str, uuid.UUID]:
    user = User(email=f"ncrparty{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    session.add(user)
    await session.flush()
    project = Project(name="SoFi", owner_id=user.id, currency="USD")
    session.add(project)
    await session.flush()
    return str(user.id), project.id


def _app(session: AsyncSession, caller: str) -> FastAPI:
    app = FastAPI()
    app.include_router(ncr_router, prefix="/v1/ncr")
    app.include_router(inspections_router, prefix="/v1/inspections")

    async def _session_override():
        yield session

    async def _user() -> str:
        return caller

    async def _payload() -> dict:
        return {"sub": caller, "role": "admin", "permissions": []}

    async def _access(project_id, user_id, session) -> None:
        return None

    app.dependency_overrides[get_session] = _session_override
    app.dependency_overrides[get_current_user_id] = _user
    app.dependency_overrides[get_current_user_payload] = _payload
    app.dependency_overrides[verify_project_access] = _access
    return app


def _body(project_id: uuid.UUID, **extra: object) -> dict:
    return {
        "project_id": str(project_id),
        "title": "Welds G14 lack of fusion",
        "description": "UT shows lack of fusion on two CJP welds at grid G14.",
        "ncr_type": "workmanship",
        "severity": "major",
        **extra,
    }


def test_no_party_is_refused_with_a_code() -> None:
    with pytest.raises(HTTPException) as exc:
        require_responsible_party(None, "   ", None)
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "ncr_responsible_party_required"
    assert exc.value.detail["field"] == "responsible_party"


def test_a_typed_value_in_the_id_slot_is_a_name() -> None:
    assert require_responsible_party("Schuff Steel", None, "subcontractor") == (None, "Schuff Steel", "text")


def test_a_picked_subcontractor_keeps_its_id_and_kind() -> None:
    assert require_responsible_party(SUB_ID, "Schuff Steel", "subcontractor") == (SUB_ID, "Schuff Steel", "subcontractor")


async def test_the_create_route_refuses_an_ncr_nobody_answers_for(session: AsyncSession) -> None:
    caller, pid = await _owner_and_project(session)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(session, caller)), base_url="http://t") as c:
        resp = await c.post("/v1/ncr/", json=_body(pid))
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "ncr_responsible_party_required"


async def test_the_create_route_stores_a_subcontractor(session: AsyncSession) -> None:
    caller, pid = await _owner_and_project(session)
    body = _body(
        pid,
        responsible_party_id=SUB_ID,
        responsible_party_name="Schuff Steel",
        responsible_party_kind="subcontractor",
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(session, caller)), base_url="http://t") as c:
        resp = await c.post("/v1/ncr/", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert (data["responsible_party_id"], data["responsible_party_name"], data["responsible_party_kind"]) == (
        SUB_ID,
        "Schuff Steel",
        "subcontractor",
    )


async def test_reassigning_cannot_clear_the_party(session: AsyncSession) -> None:
    _, pid = await _owner_and_project(session)
    service = NCRService(session)
    ncr = await service.create_ncr(
        NCRCreate(**_body(pid), responsible_party_name="FabriTec", responsible_party_kind="text")  # type: ignore[arg-type]
    )
    with pytest.raises(HTTPException) as exc:
        await service.update_ncr(ncr.id, NCRUpdate(responsible_party_name="", responsible_party_id=None))
    assert exc.value.detail["code"] == "ncr_responsible_party_required"
    moved = await service.update_ncr(ncr.id, NCRUpdate(responsible_party_name="Schuff Steel"))
    assert moved.responsible_party_name == "Schuff Steel"


async def _failed_inspection(session: AsyncSession, pid: uuid.UUID) -> QualityInspection:
    inspection = QualityInspection(
        project_id=pid,
        inspection_number=f"INS-{uuid.uuid4().hex[:4]}",
        inspection_type="structural",
        title="Bolted connections, roof grid 12-18",
        status="completed",
        result="fail",
        checklist_data=[{"id": "a", "question": "CJP welds UT 100%", "response": "fail", "critical": True}],
    )
    session.add(inspection)
    await session.flush()
    return inspection


async def test_raising_from_an_inspection_uses_the_confirmed_form(session: AsyncSession) -> None:
    caller, pid = await _owner_and_project(session)
    inspection = await _failed_inspection(session, pid)
    confirmed = {
        "title": "NCR từ kiểm tra INS-001: Liên kết bu lông",
        "description": "Mối hàn CJP không đạt UT.",
        "severity": "minor",
        "responsible_party_id": SUB_ID,
        "responsible_party_name": "Schuff Steel",
        "responsible_party_kind": "subcontractor",
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app(session, caller)), base_url="http://t") as c:
        refused = await c.post(f"/v1/inspections/{inspection.id}/create-ncr/", json={"title": "x"})
        made = await c.post(f"/v1/inspections/{inspection.id}/create-ncr/", json=confirmed)
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["code"] == "ncr_responsible_party_required"
    assert made.status_code == 201, made.text
    assert made.json()["severity"] == "minor"
    ncr = await NCRService(session).get_ncr(uuid.UUID(made.json()["ncr_id"]))
    assert ncr.title == confirmed["title"]
    assert ncr.description == confirmed["description"]
    assert ncr.responsible_party_name == "Schuff Steel"
    assert ncr.linked_inspection_id == str(inspection.id)
