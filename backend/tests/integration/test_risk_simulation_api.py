# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""HTTP surface of the Monte Carlo runs and of the probability check.

* ``POST /api/v1/risk/projects/{pid}/simulate`` stores every run and returns
  P50 < P80 < P95 for a register of point estimates.
* ``GET  /api/v1/risk/projects/{pid}/simulations`` lists stored runs, newest
  first, and is refused to someone outside the project.
* ``POST /api/v1/risk/`` refuses a probability of 1.5 with the stable error
  type ``risk_probability_out_of_range`` on the ``probability`` field.
* Each risk in the list carries ``expected_value``; together they make the
  summary's ``total_exposure``.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.tenant_isolation

RISK = "/api/v1/risk"


@pytest_asyncio.fixture(scope="module")
async def app_instance():
    from app.config import get_settings

    get_settings.cache_clear()

    from app.main import create_app

    app = create_app()

    async with app.router.lifespan_context(app):
        from app.database import Base, engine
        from app.modules.finance import models as _finance_models  # noqa: F401
        from app.modules.risk import models as _risk_models  # noqa: F401

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        yield app


@pytest_asyncio.fixture(scope="module")
async def http_client(app_instance):
    transport = ASGITransport(app=app_instance)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _set_user_fields(email: str, **values) -> None:
    from sqlalchemy import update

    from app.database import async_session_factory
    from app.modules.users.models import User

    async with async_session_factory() as s:
        await s.execute(update(User).where(User.email == email.lower()).values(**values))
        await s.commit()


async def _user(client: AsyncClient, *, tenant: str, role: str) -> dict[str, str]:
    email = f"{tenant}-{uuid.uuid4().hex[:8]}@risk-contingency.io"
    password = f"RiskCont{uuid.uuid4().hex[:6]}9"
    reg = await client.post(
        "/api/v1/users/auth/register",
        json={"email": email, "password": password, "full_name": f"Tenant {tenant}"},
    )
    assert reg.status_code in (200, 201), reg.text
    await _set_user_fields(email, is_active=True, role=role)
    login = await client.post("/api/v1/users/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _project_with_risks(client: AsyncClient, headers: dict[str, str]) -> str:
    proj = await client.post(
        "/api/v1/projects/",
        json={"name": f"MC {uuid.uuid4().hex[:6]}", "currency": "VND"},
        headers=headers,
    )
    assert proj.status_code == 201, proj.text
    project_id = proj.json()["id"]
    for title, prob, cost in (
        ("Ground", 0.5, "120000000000"),
        ("Rides", 0.4, "100000000000"),
        ("Steel", 0.6, "80000000000"),
    ):
        r = await client.post(
            f"{RISK}/",
            json={
                "project_id": project_id,
                "title": title,
                "probability": prob,
                "impact_cost": cost,
                "currency": "VND",
            },
            headers=headers,
        )
        assert r.status_code == 201, r.text
    return project_id


@pytest_asyncio.fixture(scope="module")
async def tenants(http_client):
    a_headers = await _user(http_client, tenant="a", role="editor")
    b_headers = await _user(http_client, tenant="b", role="editor")
    return {
        "a": {"headers": a_headers, "project_id": await _project_with_risks(http_client, a_headers)},
        "b": {"headers": b_headers},
    }


@pytest.mark.asyncio
async def test_probability_above_one_is_refused_with_a_code_and_field(http_client, tenants):
    a = tenants["a"]
    resp = await http_client.post(
        f"{RISK}/",
        json={"project_id": a["project_id"], "title": "Bad", "probability": 1.5},
        headers=a["headers"],
    )
    assert resp.status_code == 422, resp.text
    (entry,) = resp.json()["detail"]
    assert entry["type"] == "risk_probability_out_of_range"
    assert entry["loc"] == ["body", "probability"]
    assert entry["ctx"]["max_percent"] == 100


@pytest.mark.asyncio
async def test_run_is_stored_and_listed(http_client, tenants):
    a = tenants["a"]
    run = await http_client.post(
        f"{RISK}/projects/{a['project_id']}/simulate",
        json={"iterations": 5000, "mode": "both", "seed": 7},
        headers=a["headers"],
    )
    assert run.status_code == 200, run.text
    body = run.json()
    p50, p80, p95 = (Decimal(body[k]) for k in ("p50_cost", "p80_cost", "p95_cost"))
    assert p50 < p80 < p95
    assert Decimal(body["emv_cost"]) == Decimal("148000000000")
    assert body["seed"] == 7
    assert len(body["histogram_bins"]) == 30

    listed = await http_client.get(f"{RISK}/projects/{a['project_id']}/simulations?limit=5", headers=a["headers"])
    assert listed.status_code == 200, listed.text
    page = listed.json()
    assert page["total"] == 1
    assert page["limit"] == 5
    runs = page["items"]
    assert runs[0]["run_id"] == body["run_id"]
    assert runs[0]["p80_cost"] == body["p80_cost"]


@pytest.mark.asyncio
async def test_other_tenant_cannot_list_runs(http_client, tenants):
    a, b = tenants["a"], tenants["b"]
    resp = await http_client.get(f"{RISK}/projects/{a['project_id']}/simulations", headers=b["headers"])
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_list_expected_values_add_up_to_the_summary_exposure(http_client, tenants):
    a = tenants["a"]
    items = (await http_client.get(f"{RISK}/?project_id={a['project_id']}", headers=a["headers"])).json()["items"]
    summary = (await http_client.get(f"{RISK}/summary/?project_id={a['project_id']}", headers=a["headers"])).json()
    assert sum(Decimal(i["expected_value"]) for i in items) == Decimal(summary["total_exposure"])
    assert all(1 <= i["matrix_score"] <= 25 for i in items)
