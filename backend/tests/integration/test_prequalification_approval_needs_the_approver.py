"""Only a prequalification approver can put a subcontractor into ``approved``.

The dedicated approve action is manager-only, but creating a firm already
approved, or editing it into ``approved`` with a reason for skipping the
insurance rule, used to need only the editor's create/update permission. An
editor could so approve a firm the approver never saw. Those writes now need
``subcontractors.approve_prequalification`` too; other edits do not.

Runs against the shared ``tests/conftest.py`` PostgreSQL cluster.
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

_BASE = "/api/v1/subcontractors/subcontractors/"


@pytest_asyncio.fixture(scope="module")
async def app_instance():
    from app.config import get_settings

    get_settings.cache_clear()

    from app.main import create_app

    app = create_app()

    async with app.router.lifespan_context(app):
        from app.database import Base, engine
        from app.modules.subcontractors import models as _sub_models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        yield app


@pytest_asyncio.fixture(scope="module")
async def http_client(app_instance):
    transport = ASGITransport(app=app_instance)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _user_with_role(client: AsyncClient, role: str) -> dict[str, str]:
    from sqlalchemy import update

    from app.database import async_session_factory
    from app.modules.users.models import User

    email = f"{role}-{uuid.uuid4().hex[:8]}@prequal-approver.io"
    password = f"Prequal{uuid.uuid4().hex[:6]}9!"
    reg = await client.post(
        "/api/v1/users/auth/register", json={"email": email, "password": password, "full_name": role}
    )
    assert reg.status_code in (200, 201), reg.text
    async with async_session_factory() as s:
        await s.execute(update(User).where(User.email == email.lower()).values(role=role, is_active=True))
        await s.commit()
    res = await client.post("/api/v1/users/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest_asyncio.fixture(scope="module")
async def editor(http_client) -> dict[str, str]:
    return await _user_with_role(http_client, "editor")


@pytest_asyncio.fixture(scope="module")
async def manager(http_client) -> dict[str, str]:
    return await _user_with_role(http_client, "manager")


def _firm(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {"legal_name": f"Cong ty Xay dung {uuid.uuid4().hex[:6]}", "country": "VN"}
    body.update(overrides)
    return body


def _assert_needs_approver(res, field: str) -> None:
    assert res.status_code == 403, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "prequal_approval_permission_required"
    assert detail["field"] == field


async def test_an_editor_cannot_create_a_firm_already_approved(http_client, editor) -> None:
    res = await http_client.post(
        _BASE,
        json=_firm(prequalification_status="approved", prequal_override_reason="Known firm"),
        headers=editor,
    )
    _assert_needs_approver(res, "prequalification_status")


async def test_an_editor_cannot_send_an_insurance_override_reason(http_client, editor) -> None:
    res = await http_client.post(_BASE, json=_firm(prequal_override_reason="Known firm"), headers=editor)
    _assert_needs_approver(res, "prequal_override_reason")


async def test_an_editor_cannot_edit_a_firm_into_approved(http_client, editor) -> None:
    created = await http_client.post(_BASE, json=_firm(), headers=editor)
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    res = await http_client.patch(
        f"{_BASE}{sub_id}",
        json={"prequalification_status": "approved", "prequal_override_reason": "Known firm"},
        headers=editor,
    )
    _assert_needs_approver(res, "prequalification_status")

    still = await http_client.get(f"{_BASE}{sub_id}", headers=editor)
    assert still.json()["prequalification_status"] == "pending"


async def test_an_editor_still_edits_a_firm_a_manager_approved(http_client, editor, manager) -> None:
    created = await http_client.post(
        _BASE,
        json=_firm(prequalification_status="approved", prequal_override_reason="Insurance on its way"),
        headers=manager,
    )
    assert created.status_code == 201, created.text
    assert created.json()["prequalification_status"] == "approved"
    sub_id = created.json()["id"]

    # The edit form sends the unchanged status back with the other fields.
    res = await http_client.patch(
        f"{_BASE}{sub_id}",
        json={"prequalification_status": "approved", "notes": "Site office moved"},
        headers=editor,
    )
    assert res.status_code == 200, res.text
    assert res.json()["notes"] == "Site office moved"
