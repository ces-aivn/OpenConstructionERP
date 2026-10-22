"""Payment runs through the API: draw up, edit, approve, execute.

One legal entity, supplier invoices in several states. A run must propose what
is still open on each approved invoice that falls due, never put an invoice in
two runs, refuse to pay more than is open, notice a payment recorded by hand
after it was approved, record one payment per invoice when executed, mark a
settled invoice paid, and stay invisible to a user without access.

Run:
    cd backend
    python -m pytest tests/integration/test_finance_payment_runs_api.py -v
"""

import asyncio
import uuid
from datetime import date, timedelta

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import create_app

pytestmark = __import__("pytest").mark.asyncio

TODAY = date.today()
BASE = "/api/v1/finance/payment-runs/"


def _d(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest_asyncio.fixture(scope="module")
async def client():
    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


async def _login(client: AsyncClient, *, admin: bool) -> dict[str, str]:
    unique = uuid.uuid4().hex[:8]
    email, password = f"payrun-{unique}@test.io", f"Payrun{unique}9"
    reg = await client.post(
        "/api/v1/users/auth/register", json={"email": email, "password": password, "full_name": "Payrun"}
    )
    assert reg.status_code == 201, reg.text
    if admin:
        from ._auth_helpers import promote_to_admin

        await promote_to_admin(email)
    data: dict = {}
    for attempt in range(3):
        data = (await client.post("/api/v1/users/auth/login", json={"email": email, "password": password})).json()
        if data.get("access_token"):
            return {"Authorization": f"Bearer {data['access_token']}"}
        await asyncio.sleep(5 * (attempt + 1))
    raise AssertionError(f"login failed: {data}")


async def _ok(resp, code: int = 200):
    assert resp.status_code == code, resp.text
    return resp.json()


@pytest_asyncio.fixture(scope="module")
async def admin(client: AsyncClient) -> dict[str, str]:
    return await _login(client, admin=True)


@pytest_asyncio.fixture(scope="module")
async def approver(client: AsyncClient) -> dict[str, str]:
    """A second finance user: four eyes means the person who drew a run up never approves or pays it."""
    return await _login(client, admin=True)


@pytest_asyncio.fixture(scope="module")
async def world(client: AsyncClient, admin: dict[str, str]) -> dict[str, str]:
    tag = uuid.uuid4().hex[:6].upper()
    project = await _ok(
        await client.post("/api/v1/projects/", json={"name": f"Payrun {tag}", "currency": "CAD"}, headers=admin), 201
    )
    entity = await _ok(
        await client.post(
            "/api/v1/legal-entities/entities/",
            json={
                "code": f"R{tag}",
                "name": "Runway Developments Inc.",
                "country_code": "CA",
                "subdivision_code": "CA-ON",
                "functional_currency": "CAD",
            },
            headers=admin,
        ),
        201,
    )
    await _ok(
        await client.put(
            f"/api/v1/legal-entities/projects/{project['id']}/entity",
            json={"legal_entity_id": entity["id"]},
            headers=admin,
        )
    )
    ids = {"project": project["id"], "entity": entity["id"]}

    async def invoice(direction: str, total: str, due: int, approve: bool = True) -> str:
        body = {
            "project_id": ids["project"],
            "invoice_direction": direction,
            "invoice_date": _d(due - 30),
            "due_date": _d(due),
            "currency_code": "CAD",
            "amount_subtotal": total,
            "amount_total": total,
        }
        inv = await _ok(await client.post("/api/v1/finance/", json=body, headers=admin), 201)
        if approve:
            await _ok(await client.post(f"/api/v1/finance/{inv['id']}/approve/", headers=admin))
        return inv["id"]

    ids["a"] = await invoice("payable", "1000.00", -10)
    ids["b"] = await invoice("payable", "500.00", -5)
    await _ok(
        await client.post(
            "/api/v1/finance/payments/",
            json={"invoice_id": ids["b"], "payment_date": _d(-2), "amount": "200.00", "currency_code": "CAD"},
            headers=admin,
        ),
        201,
    )
    ids["later"] = await invoice("payable", "700.00", 30)
    ids["ar"] = await invoice("receivable", "900.00", -10)
    ids["draft"] = await invoice("payable", "50.00", -10, approve=False)
    return ids


def _new_run(world: dict[str, str]) -> dict:
    return {"legal_entity_id": world["entity"], "currency_code": "cad", "payment_date": _d(0)}


async def test_a_run_pays_what_is_open_and_never_twice(
    client: AsyncClient, admin: dict[str, str], approver: dict[str, str], world: dict[str, str]
) -> None:
    run = await _ok(await client.post(BASE, json=_new_run(world), headers=admin), 201)
    assert run["status"] == "draft" and run["currency_code"] == "CAD"
    assert run["run_number"].startswith("PAY-")
    amounts = {item["invoice_id"]: item["amount"] for item in run["items"]}
    assert amounts == {world["a"]: "1000.00", world["b"]: "300.00"}  # B less the 200 paid
    assert run["total"] == "1300.00"
    assert run["legal_entity_name"].endswith("Runway Developments Inc.")

    # The same invoices cannot go into a second run while this one is open.
    again = await client.post(BASE, json=_new_run(world), headers=admin)
    assert again.status_code == 422, again.text

    item_a = next(i for i in run["items"] if i["invoice_id"] == world["a"])
    over = await client.patch(f"{BASE}{run['id']}/items/{item_a['id']}", json={"amount": "1200"}, headers=admin)
    assert over.status_code == 422, over.text
    assert over.json()["detail"]["code"] == "payment_amount_over_open"
    assert over.json()["detail"]["field"] == "amount"
    assert over.json()["detail"]["params"]["open"] == "1000.00"
    negative = await client.patch(f"{BASE}{run['id']}/items/{item_a['id']}", json={"amount": "-500"}, headers=admin)
    assert negative.status_code == 422 and negative.json()["detail"]["code"] == "payment_amount_not_positive"
    garbage = await client.patch(f"{BASE}{run['id']}/items/{item_a['id']}", json={"amount": "abc"}, headers=admin)
    assert garbage.status_code == 422 and garbage.json()["detail"]["code"] == "payment_amount_invalid"
    edited = await _ok(
        await client.patch(f"{BASE}{run['id']}/items/{item_a['id']}", json={"amount": "600"}, headers=admin)
    )
    assert edited["total"] == "900.00"

    # The person who drew the run up cannot approve it.
    own = await client.post(f"{BASE}{run['id']}/approve/", headers=admin)
    assert own.status_code == 422, own.text
    assert {i["code"] for i in own.json()["detail"]["issues"]} == {"same_person"}

    approved = await _ok(await client.post(f"{BASE}{run['id']}/approve/", headers=approver))
    assert approved["status"] == "approved"
    assert approved["issues"] == []

    # Someone pays B by hand after the approval: the run must not pay it again.
    await _ok(
        await client.post(
            "/api/v1/finance/payments/",
            json={"invoice_id": world["b"], "payment_date": _d(0), "amount": "300.00", "currency_code": "CAD"},
            headers=admin,
        ),
        201,
    )
    blocked = await client.post(f"{BASE}{run['id']}/execute/", headers=approver)
    assert blocked.status_code == 422, blocked.text
    assert "amount_over_open" in blocked.text

    cancelled = await _ok(await client.post(f"{BASE}{run['id']}/cancel/", headers=admin))
    assert cancelled["status"] == "cancelled"


async def test_executing_records_one_payment_per_invoice_and_settles_it(
    client: AsyncClient, admin: dict[str, str], approver: dict[str, str], world: dict[str, str]
) -> None:
    run = await _ok(await client.post(BASE, json=_new_run(world), headers=admin), 201)
    assert [i["invoice_id"] for i in run["items"]] == [world["a"]]  # B is settled now
    await _ok(await client.post(f"{BASE}{run['id']}/approve/", headers=approver))
    # Nor can the person who drew it up record its payments.
    own = await client.post(f"{BASE}{run['id']}/execute/", headers=admin)
    assert own.status_code == 422, own.text
    assert {i["code"] for i in own.json()["detail"]["issues"]} == {"same_person_execute"}
    done = await _ok(await client.post(f"{BASE}{run['id']}/execute/", headers=approver))
    assert done["status"] == "executed" and done["executed_at"]
    assert done["items"][0]["payment_id"]

    payments = await _ok(
        await client.get("/api/v1/finance/payments/", params={"invoice_id": world["a"]}, headers=admin)
    )
    rows = payments["items"] if isinstance(payments, dict) else payments
    assert [(p["amount"], p["reference"]) for p in rows] == [("1000.00", run["run_number"])]
    invoice = await _ok(await client.get(f"/api/v1/finance/{world['a']}", headers=admin))
    assert invoice["status"] == "paid"

    again = await client.post(f"{BASE}{run['id']}/execute/", headers=approver)
    assert again.status_code == 409, again.text

    csv_resp = await client.get(f"{BASE}{run['id']}/bank-file.csv", headers=admin)
    assert csv_resp.status_code == 200
    lines = csv_resp.content.decode("utf-8-sig").splitlines()
    assert lines[0].startswith("run_number,payment_date,payee")
    assert len(lines) == 2 and "1000.00" in lines[1]


async def test_nothing_due_is_refused_rather_than_saved_empty(
    client: AsyncClient, admin: dict[str, str], world: dict[str, str]
) -> None:
    resp = await client.post(BASE, json={**_new_run(world), "currency_code": "USD"}, headers=admin)
    assert resp.status_code == 422, resp.text


async def test_a_user_without_access_sees_no_run(
    client: AsyncClient, admin: dict[str, str], world: dict[str, str]
) -> None:
    listed = await _ok(await client.get(BASE, headers=admin))
    run_id = listed["items"][0]["id"]
    outsider = await _login(client, admin=False)
    resp = await client.get(BASE, headers=outsider)
    if resp.status_code == 403:
        return  # no finance.read at all is also a correct answer
    assert all(r["id"] != run_id for r in resp.json()["items"])
    assert (await client.get(f"{BASE}{run_id}", headers=outsider)).status_code in (403, 404)


async def test_a_partial_payment_lowers_what_is_open_and_mark_paid_pays_only_the_rest(
    client: AsyncClient, admin: dict[str, str], approver: dict[str, str], world: dict[str, str]
) -> None:
    """200 panels at 250,000.50 plus 9.5 % VAT, paid 20,000,000 in a run, then marked paid."""
    project = await _ok(
        await client.post("/api/v1/projects/", json={"name": "Payrun USD", "currency": "USD"}, headers=admin), 201
    )
    await _ok(
        await client.put(
            f"/api/v1/legal-entities/projects/{project['id']}/entity",
            json={"legal_entity_id": world["entity"]},
            headers=admin,
        )
    )
    inv = await _ok(
        await client.post(
            "/api/v1/finance/",
            json={
                "project_id": project["id"],
                "invoice_direction": "payable",
                "invoice_date": _d(-20),
                "due_date": _d(-1),
                "currency_code": "USD",
                "amount_subtotal": "50000100.00",
                "tax_amount": "4750009.50",
                "amount_total": "54750109.50",
            },
            headers=admin,
        ),
        201,
    )
    assert inv["amount_open"] == "54750109.50" and inv["payment_status"] == "unpaid"
    await _ok(await client.post(f"/api/v1/finance/{inv['id']}/approve/", headers=approver))

    run = await _ok(
        await client.post(
            BASE,
            json={"legal_entity_id": world["entity"], "currency_code": "USD", "payment_date": _d(0)},
            headers=admin,
        ),
        201,
    )
    (item,) = run["items"]
    await _ok(await client.patch(f"{BASE}{run['id']}/items/{item['id']}", json={"amount": "20000000"}, headers=admin))
    await _ok(await client.post(f"{BASE}{run['id']}/approve/", headers=approver))
    await _ok(await client.post(f"{BASE}{run['id']}/execute/", headers=approver))

    after = await _ok(await client.get(f"/api/v1/finance/{inv['id']}", headers=admin))
    assert after["status"] == "approved"
    assert after["payment_status"] == "partially_paid"
    assert after["amount_paid"] == "20000000.00"
    assert after["amount_open"] == "34750109.50"

    dash = await _ok(
        await client.get("/api/v1/finance/dashboard/", params={"project_id": project["id"]}, headers=admin)
    )
    assert dash["total_payable"] == "34750109.50"
    assert dash["total_overdue"] == "34750109.50"

    # Paying more than is open by hand is refused with a code the screen can word.
    over = await client.post(
        "/api/v1/finance/payments/",
        json={"invoice_id": inv["id"], "payment_date": _d(0), "amount": "40000000.00", "currency_code": "USD"},
        headers=admin,
    )
    assert over.status_code == 422, over.text
    assert over.json()["detail"]["code"] == "payment_amount_over_open"

    settled = await _ok(await client.post(f"/api/v1/finance/{inv['id']}/settle/", json={}, headers=admin))
    assert settled["status"] == "paid" and settled["amount_open"] == "0.00"
    payments = await _ok(await client.get("/api/v1/finance/payments/", params={"invoice_id": inv["id"]}, headers=admin))
    rows = payments["items"] if isinstance(payments, dict) else payments
    assert sorted(p["amount"] for p in rows) == ["20000000.00", "34750109.50"]

    dash = await _ok(
        await client.get("/api/v1/finance/dashboard/", params={"project_id": project["id"]}, headers=admin)
    )
    assert dash["total_payable"] == "0.00" and dash["total_overdue"] == "0.00"


async def test_a_due_date_before_the_invoice_date_is_refused(
    client: AsyncClient, admin: dict[str, str], world: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/v1/finance/",
        json={
            "project_id": world["project"],
            "invoice_direction": "payable",
            "invoice_date": "2026-10-22",
            "due_date": "2026-10-01",
            "currency_code": "CAD",
            "amount_subtotal": "10.00",
            "amount_total": "10.00",
        },
        headers=admin,
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "invoice_due_before_issue" and detail["field"] == "due_date"
