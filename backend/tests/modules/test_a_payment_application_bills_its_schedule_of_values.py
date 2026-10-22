# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""A contract's schedule of values comes from its bill, and a claim bills against it.

The chain contract, schedule of values, progress, payment application was
there, but its first link had to be typed in by hand line by line, and then
linked to the bill line by line, before "Populate from progress" could bill
anything. And a claim line took any amount: work far past what the line was
worth went in unchallenged until submission.

On PostgreSQL, through the service and the endpoints the screens call:

* a draft contract draws one schedule line per priced position, linked to it,
  and drawing again adds nothing;
* a contract created with a bill gets its schedule at once; its value is the
  agreed price and is never taken from the bill's direct cost;
* a bill priced in another currency is scheduled in the contract currency at
  the project's rate, and refused when there is no rate;
* a bill of another project, or a signed contract, is refused;
* a claim line carries stored materials and its continuation-sheet row, and
  the net due counts the stored materials;
* a line that would bill past its scheduled value, or take back more than was
  billed, is refused with a code the screen translates.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.modules.boq.models import BOQ, Position
from app.modules.contracts.models import Contract, ContractLine, ProgressClaim
from app.modules.contracts.router import create_claim_line, list_claim_lines, update_claim_line
from app.modules.contracts.schemas import ContractCreate, ProgressClaimLineCreate, ProgressClaimLineUpdate
from app.modules.contracts.service import BOQ_POSITION_META_KEY, ContractsService
from app.modules.projects.models import Project
from app.modules.users.models import User
from tests._pg import transactional_session

pytestmark = pytest.mark.asyncio

OWNER_ID = uuid.uuid4()


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        s.add(User(id=OWNER_ID, email=f"sov-{uuid.uuid4().hex[:8]}@test.io", hashed_password="x"))
        await s.flush()
        yield s


async def _project(session, currency: str = "VND", country: str = "VN") -> Project:
    project = Project(id=uuid.uuid4(), name="LEGO", owner_id=OWNER_ID, currency=currency, country_code=country)
    session.add(project)
    await session.flush()
    return project


async def _bill(session, project: Project) -> SimpleNamespace:
    boq = BOQ(id=uuid.uuid4(), project_id=project.id, name="Dự toán")
    session.add(boq)
    await session.flush()
    rows: dict[str, Position] = {}

    def add(key: str, ordinal: str, unit: str, qty: str, rate: str, parent: str | None = None, order: int = 0):
        pos = Position(
            id=uuid.uuid4(),
            boq_id=boq.id,
            parent_id=rows[parent].id if parent else None,
            ordinal=ordinal,
            description=f"Hạng mục {ordinal}",
            unit=unit,
            quantity=qty,
            unit_rate=rate,
            total=str(Decimal(qty) * Decimal(rate)),
            sort_order=order,
        )
        session.add(pos)
        rows[key] = pos

    add("section", "01", "", "0", "0", order=0)
    await session.flush()
    add("concrete", "01.001", "m3", "120", "2500000", parent="section", order=1)
    add("rebar", "01.002", "t", "8.5", "21000000", parent="section", order=2)
    add("empty", "01.003", "m2", "0", "0", parent="section", order=3)
    await session.flush()
    return SimpleNamespace(boq=boq, **rows)


async def _draft_contract(session, project: Project, total: str = "0") -> Contract:
    contract = Contract(
        id=uuid.uuid4(),
        code=f"HD-{uuid.uuid4().hex[:8]}",
        title="Thi công phần thân",
        project_id=project.id,
        contract_type="lump_sum",
        currency=project.currency,
        total_value=Decimal(total),
        retention_percent=Decimal("5"),
        status="draft",
    )
    session.add(contract)
    await session.flush()
    return contract


async def test_a_draft_contract_draws_one_linked_line_per_priced_position(session) -> None:
    project = await _project(session)
    bill = await _bill(session, project)
    contract = await _draft_contract(session, project)
    svc = ContractsService(session)

    result = await svc.build_sov_from_boq(contract.id, bill.boq.id)

    assert result["created"] == 2
    lines = await svc.line_repo.list_for_contract(contract.id)
    by_position = {ln.metadata_[BOQ_POSITION_META_KEY]: ln for ln in lines}
    assert set(by_position) == {str(bill.concrete.id), str(bill.rebar.id)}
    concrete = by_position[str(bill.concrete.id)]
    assert (concrete.code, concrete.unit, concrete.quantity, concrete.unit_rate, concrete.total_value) == (
        "01.001",
        "m3",
        Decimal("120"),
        Decimal("2500000"),
        Decimal("300000000"),
    )
    assert by_position[str(bill.rebar.id)].total_value == Decimal("178500000")
    # The contract value is the agreed price; the bill's direct cost leaves
    # its markups out, so it does not become the value of a contract with none.
    await session.refresh(contract)
    assert contract.total_value == Decimal("0")
    assert result["sov_total"] == Decimal("478500000")

    again = await svc.build_sov_from_boq(contract.id, bill.boq.id)
    assert (again["created"], again["already_linked"]) == (0, 2)
    assert len(await svc.line_repo.list_for_contract(contract.id)) == 2


async def test_a_typed_contract_value_is_the_agreed_price_and_stays(session) -> None:
    project = await _project(session)
    bill = await _bill(session, project)
    contract = await _draft_contract(session, project, total="500000000")
    result = await ContractsService(session).build_sov_from_boq(contract.id, bill.boq.id)
    await session.refresh(contract)
    assert contract.total_value == Decimal("500000000")
    assert (result["sov_total"], result["contract_total_value"]) == (Decimal("478500000"), Decimal("500000000"))


async def test_a_contract_created_with_its_bill_has_its_schedule_at_once(session) -> None:
    project = await _project(session)
    bill = await _bill(session, project)
    contract = await ContractsService(session).create_contract(
        ContractCreate(
            code=f"HD-{uuid.uuid4().hex[:6]}",
            title="Phần thân",
            contract_type="lump_sum",
            project_id=project.id,
            currency="VND",
            sov_boq_id=bill.boq.id,
        ),
        user_id=str(OWNER_ID),
    )
    lines = await ContractsService(session).line_repo.list_for_contract(contract.id)
    assert len(lines) == 2
    assert contract.total_value == Decimal("0")


async def test_a_bill_in_dong_is_scheduled_in_the_dollars_of_the_contract(session) -> None:
    project = await _project(session)
    project.fx_rates = [{"code": "USD", "rate": "25000"}]
    await session.flush()
    bill = await _bill(session, project)
    contract = await _draft_contract(session, project)
    contract.currency = "USD"
    await session.flush()
    svc = ContractsService(session)

    result = await svc.build_sov_from_boq(contract.id, bill.boq.id)

    by_position = {ln.metadata_[BOQ_POSITION_META_KEY]: ln for ln in await svc.line_repo.list_for_contract(contract.id)}
    concrete = by_position[str(bill.concrete.id)]
    assert (concrete.quantity, concrete.unit_rate, concrete.total_value) == (
        Decimal("120"),
        Decimal("100"),
        Decimal("12000"),
    )
    assert by_position[str(bill.rebar.id)].total_value == Decimal("7140")
    assert result["sov_total"] == Decimal("19140")


async def test_a_bill_in_a_currency_the_project_has_no_rate_for_is_refused(session) -> None:
    project = await _project(session)
    bill = await _bill(session, project)
    contract = await _draft_contract(session, project)
    contract.currency = "EUR"
    await session.flush()
    svc = ContractsService(session)

    with pytest.raises(HTTPException) as refused:
        await svc.build_sov_from_boq(contract.id, bill.boq.id)

    assert refused.value.status_code == 422
    assert refused.value.detail["code"] == "sov_currency_rate_missing"
    assert refused.value.detail["params"] == {"from_currency": "VND", "to_currency": "EUR"}
    assert await svc.line_repo.list_for_contract(contract.id) == []


async def test_a_bill_of_another_project_is_refused_with_a_code(session) -> None:
    project = await _project(session)
    other = await _project(session)
    bill = await _bill(session, other)
    contract = await _draft_contract(session, project)
    with pytest.raises(HTTPException) as caught:
        await ContractsService(session).build_sov_from_boq(contract.id, bill.boq.id)
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "sov_boq_not_in_project"
    assert caught.value.detail["field"] == "boq_id"


async def test_a_signed_contract_keeps_its_schedule(session) -> None:
    project = await _project(session)
    bill = await _bill(session, project)
    contract = await _draft_contract(session, project)
    contract.status = "active"
    await session.flush()
    with pytest.raises(HTTPException) as caught:
        await ContractsService(session).build_sov_from_boq(contract.id, bill.boq.id)
    assert caught.value.status_code == 409
    assert caught.value.detail["error"] == "contract_lines_frozen"


# ── Claim lines against the schedule ─────────────────────────────────────


async def _billing_world(session) -> SimpleNamespace:
    project = await _project(session, currency="USD", country="US")
    contract = Contract(
        id=uuid.uuid4(),
        code=f"C-{uuid.uuid4().hex[:8]}",
        title="Works",
        project_id=project.id,
        contract_type="lump_sum",
        currency="USD",
        total_value=Decimal("100000"),
        retention_percent=Decimal("10"),
        status="active",
    )
    session.add(contract)
    await session.flush()
    line = ContractLine(
        id=uuid.uuid4(),
        contract_id=contract.id,
        code="A",
        description="Structure",
        quantity=Decimal("1"),
        unit_rate=Decimal("60000"),
        total_value=Decimal("60000"),
        order_index=0,
    )
    session.add(line)
    claim = ProgressClaim(
        id=uuid.uuid4(),
        contract_id=contract.id,
        claim_number="PC-1",
        period_start="2026-03-01",
        period_end="2026-03-31",
        period_from=date(2026, 3, 1),
        period_to=date(2026, 3, 31),
        currency="USD",
        status="draft",
    )
    session.add(claim)
    await session.flush()
    return SimpleNamespace(contract=contract, line=line, claim=claim)


async def test_a_claim_line_bills_work_and_stored_materials_against_its_scheduled_value(session) -> None:
    world = await _billing_world(session)
    written = await create_claim_line(
        ProgressClaimLineCreate(
            progress_claim_id=world.claim.id,
            contract_line_id=world.line.id,
            period_completed_value=Decimal("30000"),
            materials_stored_value=Decimal("10000"),
        ),
        session,
        str(OWNER_ID),
    )
    assert written.materials_stored_value == Decimal("10000")
    # The continuation-sheet row: C, G = D + E + F, G/C and H.
    assert written.scheduled_value == Decimal("60000.00")
    assert written.previous_value == Decimal("0.00")
    assert written.total_completed_stored == Decimal("40000.00")
    assert written.balance_to_finish == Decimal("20000.00")
    assert written.percent_complete == Decimal("66.67")

    await session.refresh(world.claim)
    # Gross is the work billed this period; stored materials are paid too,
    # less their retention: 40,000 to date less 10% is 36,000 due.
    assert world.claim.gross_amount == Decimal("30000")
    assert world.claim.net_due == Decimal("36000.0000")

    (listed,) = await list_claim_lines(world.claim.id, session, str(OWNER_ID))
    assert listed.total_completed_stored == Decimal("40000.00")


async def test_a_line_billed_past_its_scheduled_value_is_refused(session) -> None:
    world = await _billing_world(session)
    with pytest.raises(HTTPException) as caught:
        await create_claim_line(
            ProgressClaimLineCreate(
                progress_claim_id=world.claim.id,
                contract_line_id=world.line.id,
                period_completed_value=Decimal("55000"),
                materials_stored_value=Decimal("10000"),
            ),
            session,
            str(OWNER_ID),
        )
    detail = caught.value.detail
    assert caught.value.status_code == 422
    assert detail["code"] == "claim_line_exceeds_scheduled_value"
    assert detail["field"] == "period_completed_value"
    assert detail["params"]["line"] == "A"
    assert "60,000.00" in detail["params"]["scheduled"]

    written = await create_claim_line(
        ProgressClaimLineCreate(
            progress_claim_id=world.claim.id,
            contract_line_id=world.line.id,
            period_completed_value=Decimal("50000"),
        ),
        session,
        str(OWNER_ID),
    )
    # Raising only the stored materials past the line names that field.
    with pytest.raises(HTTPException) as caught:
        await update_claim_line(
            written.id,
            ProgressClaimLineUpdate(materials_stored_value=Decimal("10001")),
            session,
            str(OWNER_ID),
        )
    assert caught.value.detail["code"] == "claim_line_exceeds_scheduled_value"


async def test_a_period_may_not_take_back_more_than_was_billed(session) -> None:
    world = await _billing_world(session)
    with pytest.raises(HTTPException) as caught:
        await create_claim_line(
            ProgressClaimLineCreate(
                progress_claim_id=world.claim.id,
                contract_line_id=world.line.id,
                period_completed_value=Decimal("-1"),
            ),
            session,
            str(OWNER_ID),
        )
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "claim_line_below_zero_to_date"


async def test_a_line_of_another_contract_is_refused(session) -> None:
    world = await _billing_world(session)
    other = await _billing_world(session)
    with pytest.raises(HTTPException) as caught:
        await create_claim_line(
            ProgressClaimLineCreate(
                progress_claim_id=world.claim.id,
                contract_line_id=other.line.id,
                period_completed_value=Decimal("100"),
            ),
            session,
            str(OWNER_ID),
        )
    assert caught.value.detail["code"] == "claim_line_not_on_contract"


async def test_stored_materials_are_never_negative() -> None:
    with pytest.raises(ValueError):
        ProgressClaimLineCreate(
            progress_claim_id=uuid.uuid4(),
            contract_line_id=uuid.uuid4(),
            materials_stored_value=Decimal("-5"),
        )
