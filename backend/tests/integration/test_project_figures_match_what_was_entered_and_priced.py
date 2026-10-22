# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The figures a project shows are the ones the user entered and priced.

Three readings disagreed with each other:

* the projects list card summed position totals, so a bill with overhead,
  profit and VAT showed its direct cost on the card and its grand total in
  the editor;
* the overview's original budget ignored the budget typed at creation and
  showed the BOQ total, or zero before any BOQ existed, and finance had no
  budget line for the project at all;
* open RFIs were counted against a status list that named a status the RFI
  module does not have, instead of the module's own open set.
"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest_asyncio.fixture(scope="module")
async def client():
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest_asyncio.fixture(scope="module")
async def auth(client: AsyncClient) -> dict[str, str]:
    unique = uuid.uuid4().hex[:8]
    email = f"projfigures-{unique}@test.io"
    password = f"ProjFigures{unique}9"
    reg = await client.post(
        "/api/v1/users/auth/register",
        json={"email": email, "password": password, "full_name": "Project Figures Tester", "role": "admin"},
    )
    assert reg.status_code == 201, reg.text

    from ._auth_helpers import promote_to_admin

    await promote_to_admin(email)

    token = ""
    data: dict = {}
    for attempt in range(3):
        resp = await client.post("/api/v1/users/auth/login", json={"email": email, "password": password})
        data = resp.json()
        token = data.get("access_token", "")
        if token:
            break
        if "Too many login attempts" in data.get("detail", ""):
            await asyncio.sleep(5 * (attempt + 1))
            continue
        break
    assert token, f"Login failed: {data}"
    return {"Authorization": f"Bearer {token}"}


async def _create_project(client: AsyncClient, auth: dict[str, str], **extra: object) -> dict:
    body = {
        "name": f"Figures {uuid.uuid4().hex[:6]}",
        "description": "",
        "region": "Vietnam",
        "classification_standard": "vn_tt12",
        "currency": "VND",
        "locale": "vi",
        **extra,
    }
    resp = await client.post("/api/v1/projects/", json=body, headers=auth)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _priced_boq_with_markup(client: AsyncClient, auth: dict[str, str], project_id: str) -> str:
    resp = await client.post(
        "/api/v1/boq/boqs/",
        json={"project_id": project_id, "name": "Priced bill", "description": ""},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    boq_id = resp.json()["id"]
    resp = await client.post(
        f"/api/v1/boq/boqs/{boq_id}/positions/",
        json={
            "boq_id": boq_id,
            "ordinal": "01.001",
            "description": "Bê tông móng",
            "unit": "m3",
            "quantity": 100.0,
            "unit_rate": 2500000,
        },
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post(
        f"/api/v1/boq/boqs/{boq_id}/markups/",
        json={
            "name": "Lợi nhuận",
            "markup_type": "percentage",
            "category": "profit",
            "percentage": 10.0,
            "apply_to": "direct_cost",
            "sort_order": 50,
        },
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    return boq_id


async def _bill_grand_total(client: AsyncClient, auth: dict[str, str], project_id: str) -> Decimal:
    resp = await client.get("/api/v1/boq/boqs/", params={"project_id": project_id}, headers=auth)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    rows = payload["items"] if isinstance(payload, dict) else payload
    return sum((Decimal(str(r["grand_total"])) for r in rows), Decimal("0"))


async def _card_for(client: AsyncClient, auth: dict[str, str], project_id: str) -> dict:
    resp = await client.get("/api/v1/projects/dashboard/cards/", headers=auth)
    assert resp.status_code == 200, resp.text
    cards = [c for c in resp.json() if c["id"] == project_id]
    assert cards, "the project has no dashboard card"
    return cards[0]


@pytest.mark.asyncio
async def test_the_card_shows_the_bill_grand_total_with_its_markups(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    project = await _create_project(client, auth)
    await _priced_boq_with_markup(client, auth, project["id"])

    grand = await _bill_grand_total(client, auth, project["id"])
    assert grand > Decimal("250000000"), "the markup did not lift the bill above its direct cost"

    card = await _card_for(client, auth, project["id"])
    assert Decimal(str(card["boq_total_value"])).quantize(Decimal("1")) == grand.quantize(Decimal("1"))

    resp = await client.get(f"/api/v1/projects/{project['id']}/dashboard/", headers=auth)
    assert resp.status_code == 200, resp.text
    dashboard = resp.json()
    assert Decimal(str(dashboard["boq_total_value"])).quantize(Decimal("1")) == grand.quantize(Decimal("1"))


@pytest.mark.asyncio
async def test_the_budget_entered_at_creation_is_the_original_budget(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    project = await _create_project(
        client,
        auth,
        budget_estimate="9174287000000",
        contract_value="9500000000000",
        planned_start_date="2026-11-01",
        planned_end_date="2027-12-31",
        project_code="VN-HN-001",
    )
    await _priced_boq_with_markup(client, auth, project["id"])

    resp = await client.get(f"/api/v1/projects/{project['id']}/dashboard/", headers=auth)
    assert resp.status_code == 200, resp.text
    dashboard = resp.json()
    assert Decimal(dashboard["budget"]["original"]) == Decimal("9174287000000")

    info = dashboard["project"]
    assert Decimal(info["budget_estimate"]) == Decimal("9174287000000")
    assert Decimal(info["contract_value"]) == Decimal("9500000000000")
    assert info["planned_start_date"] == "2026-11-01"
    assert info["planned_end_date"] == "2027-12-31"
    assert info["project_code"] == "VN-HN-001"


@pytest.mark.asyncio
async def test_a_project_without_an_entered_budget_falls_back_to_its_bill(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    project = await _create_project(client, auth)
    await _priced_boq_with_markup(client, auth, project["id"])
    grand = await _bill_grand_total(client, auth, project["id"])

    resp = await client.get(f"/api/v1/projects/{project['id']}/dashboard/", headers=auth)
    assert resp.status_code == 200, resp.text
    original = Decimal(resp.json()["budget"]["original"])
    assert original.quantize(Decimal("1")) == grand.quantize(Decimal("1"))


@pytest.mark.asyncio
async def test_finance_gets_a_budget_line_from_the_entered_budget(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    project = await _create_project(client, auth, budget_estimate="2180000000")

    resp = await client.get("/api/v1/finance/budgets/", params={"project_id": project["id"]}, headers=auth)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1, items
    line = items[0]
    assert line["category"] == "project_budget"
    assert Decimal(str(line["original_budget"])) == Decimal("2180000000")
    assert Decimal(str(line["revised_budget"])) == Decimal("2180000000")


@pytest.mark.asyncio
async def test_a_project_without_an_entered_budget_gets_no_finance_line(
    client: AsyncClient, auth: dict[str, str]
) -> None:
    project = await _create_project(client, auth)

    resp = await client.get("/api/v1/finance/budgets/", params={"project_id": project["id"]}, headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_open_rfis_are_the_rfi_module_open_set(client: AsyncClient, auth: dict[str, str]) -> None:
    project = await _create_project(client, auth)
    for status in ("draft", "open", "answered", "closed"):
        resp = await client.post(
            "/api/v1/rfi/",
            json={
                "project_id": project["id"],
                "subject": f"RFI {status}",
                "question": "Chiều dày lớp bảo vệ cốt thép móng?",
                "status": status,
            },
            headers=auth,
        )
        assert resp.status_code == 201, resp.text

    card = await _card_for(client, auth, project["id"])
    assert card["open_rfis"] == 2

    resp = await client.get(f"/api/v1/projects/{project['id']}/dashboard/", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["communication"]["open_rfis"] == 2
