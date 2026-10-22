# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cost control plans on the project budget, and forecasts the scope not let yet.

A project that budgets in Finance but has not broken the budget onto cost lines
used to report a plan of zero and a forecast of only its purchase orders. The
plan is the project budget (the estimate when there is no budget), and the part
of it no cost line plans yet forecasts what the uncommitted scope still costs:
the plan less the commitments already sitting on no cost line.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.boq.models import BOQ, BOQMarkup, Position
from app.modules.costmodel.cost_control import FINDING_OVER_PLAN, LineFigures, invoiced_over_accepted
from app.modules.costmodel.cost_control_service import KEY_PROJECT_BUDGET, CostControlService
from app.modules.costmodel.models import BudgetLine, CostLine
from app.modules.finance.models import ProjectBudget
from app.modules.procurement.models import PurchaseOrder, PurchaseOrderItem
from tests._pg import transactional_session

D = Decimal
TODAY = date(2026, 10, 22)


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with transactional_session(disable_fks=True) as s:
        yield s


async def _budget(session: AsyncSession, pid: uuid.UUID, original: str, revised: str | None = None) -> None:
    session.add(
        ProjectBudget(
            project_id=pid,
            category="construction",
            currency_code="",
            original_budget=D(original),
            revised_budget=D(revised if revised is not None else original),
        )
    )
    await session.flush()


async def _order(session: AsyncSession, pid: uuid.UUID, amount: str, cost_line: CostLine | None = None) -> None:
    po = PurchaseOrder(project_id=pid, po_number=f"PO-{uuid.uuid4().hex[:5]}", currency_code="", status="issued")
    po.amount_total = amount
    po.metadata_ = {}
    session.add(po)
    await session.flush()
    session.add(
        PurchaseOrderItem(
            po_id=po.id,
            description="Steel",
            quantity="1",
            unit_rate=amount,
            amount=amount,
            cost_line_id=cost_line.id if cost_line else None,
        )
    )
    await session.flush()


def _plan_row(report):  # type: ignore[no-untyped-def]
    return next((r for r in report.rows if r.key == KEY_PROJECT_BUDGET), None)


async def test_the_plan_is_the_project_budget_and_the_forecast_covers_the_scope_not_let(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _budget(session, pid, "1000000")
    await _order(session, pid, "300000")

    report = await CostControlService(session).report(pid, today=TODAY)

    assert (report.project_plan, report.plan_source) == (D("1000000"), "budget")
    assert D(report.totals["planned"]) == D("1000000")
    assert D(report.totals["committed"]) == D("300000")
    # Commitments plus what the uncommitted scope is still expected to cost.
    assert D(report.totals["forecast"]) == D("1000000")
    assert D(report.totals["variance"]) == D("0")
    row = _plan_row(report)
    assert row is not None
    assert (row.planned, row.forecast, row.forecast_source) == (D("1000000"), D("700000"), "budget")


async def test_commitments_above_the_plan_forecast_the_commitment(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _budget(session, pid, "1000000")
    await _order(session, pid, "1200000")

    report = await CostControlService(session).report(pid, today=TODAY)

    assert D(report.totals["forecast"]) == D("1200000")
    assert D(report.totals["variance"]) == D("200000")
    row = _plan_row(report)
    assert row is not None and row.forecast == D("0")


async def test_the_original_budget_is_the_plan_so_approved_changes_show_as_variance(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _budget(session, pid, "1000000", revised="1100000")

    report = await CostControlService(session).report(pid, today=TODAY)

    assert report.project_plan == D("1000000")


async def test_only_the_plan_no_cost_line_carries_gets_a_row(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _budget(session, pid, "1000000")
    line = CostLine(project_id=pid, code="330", description="Shell", estimate_amount="0", currency="")
    session.add(line)
    await session.flush()
    session.add(
        BudgetLine(
            project_id=pid,
            cost_line_id=line.id,
            category="subcontractor",
            description="Shell",
            planned_amount="600000",
            currency="",
        )
    )
    await session.flush()

    report = await CostControlService(session).report(pid, today=TODAY)

    assert D(report.totals["planned"]) == D("1000000")
    row = _plan_row(report)
    assert row is not None and row.planned == D("400000")


async def test_a_fully_allocated_budget_adds_no_row(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _budget(session, pid, "500000")
    line = CostLine(project_id=pid, code="330", description="Shell", estimate_amount="0", currency="")
    session.add(line)
    await session.flush()
    session.add(
        BudgetLine(
            project_id=pid,
            cost_line_id=line.id,
            category="subcontractor",
            description="Shell",
            planned_amount="500000",
            currency="",
        )
    )
    await session.flush()

    report = await CostControlService(session).report(pid, today=TODAY)

    assert _plan_row(report) is None
    assert all(f.rule_id != FINDING_OVER_PLAN for f in report.findings)


async def test_without_a_budget_the_plan_is_the_estimate_with_markups(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    boq = BOQ(id=uuid.uuid4(), project_id=pid, name="Tender", is_locked=True, status="final")
    session.add(boq)
    await session.flush()
    session.add(
        Position(
            id=uuid.uuid4(),
            boq_id=boq.id,
            ordinal="01",
            description="Concrete",
            unit="m3",
            quantity="100",
            unit_rate="80",
            total="8000",
            sort_order=0,
        )
    )
    session.add(
        BOQMarkup(
            id=uuid.uuid4(),
            boq_id=boq.id,
            name="Overhead",
            markup_type="percentage",
            percentage="25",
            apply_to="direct_cost",
            sort_order=0,
            is_active=True,
        )
    )
    await session.flush()

    report = await CostControlService(session).report(pid, today=TODAY)

    assert (report.project_plan, report.plan_source) == (D("10000"), "estimate")
    row = _plan_row(report)
    assert row is not None
    assert (row.estimate, row.planned, row.forecast) == (D("10000"), D("10000"), D("10000"))


async def _locked_bill(
    session: AsyncSession,
    pid: uuid.UUID,
    direct: str,
    *,
    parent: BOQ | None = None,
    markups: tuple[tuple[str, str, str], ...] = (),
    locked: bool = True,
) -> BOQ:
    boq = BOQ(
        id=uuid.uuid4(),
        project_id=pid,
        name="Tender",
        is_locked=locked,
        status="final",
        parent_estimate_id=parent.id if parent else None,
    )
    session.add(boq)
    await session.flush()
    session.add(
        Position(
            id=uuid.uuid4(),
            boq_id=boq.id,
            ordinal="01",
            description="Concrete",
            unit="lsum",
            quantity="1",
            unit_rate=direct,
            total=direct,
            sort_order=0,
        )
    )
    for order, (name, category, percentage) in enumerate(markups):
        session.add(
            BOQMarkup(
                id=uuid.uuid4(),
                boq_id=boq.id,
                name=name,
                category=category,
                markup_type="percentage",
                percentage=percentage,
                apply_to="direct_cost",
                sort_order=order,
                is_active=True,
            )
        )
    await session.flush()
    return boq


async def test_the_estimate_plan_leaves_vat_out_like_the_budget_does(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    await _locked_bill(session, pid, "8000", markups=(("Overhead", "overhead", "25"), ("VAT", "tax", "10")))

    report = await CostControlService(session).report(pid, today=TODAY)

    assert (report.project_plan, report.plan_source) == (D("10000"), "estimate")


async def test_a_revised_bill_counts_once_at_its_latest_locked_revision(session: AsyncSession) -> None:
    pid = uuid.uuid4()
    first = await _locked_bill(session, pid, "8000")
    second = await _locked_bill(session, pid, "9000", parent=first)
    # A third revision still being edited does not replace the second yet.
    await _locked_bill(session, pid, "9500", parent=second, locked=False)
    # A separate bill of the same project adds to it.
    await _locked_bill(session, pid, "1000")

    report = await CostControlService(session).report(pid, today=TODAY)

    assert (report.project_plan, report.plan_source) == (D("10000"), "estimate")


async def test_a_project_with_no_budget_and_no_estimate_has_no_plan(session: AsyncSession) -> None:
    report = await CostControlService(session).report(uuid.uuid4(), today=TODAY)

    assert (report.project_plan, report.plan_source) == (D("0"), "none")
    assert _plan_row(report) is None


def test_an_invoice_above_the_accepted_work_is_flagged() -> None:
    ahead = invoiced_over_accepted(None, "", LineFigures(invoiced=D("50000000"), certified=D("0")))
    assert ahead is not None
    assert ahead.amount == D("50000000")
    assert ahead.details == {"invoiced": "50000000", "accepted": "0"}


def test_an_invoice_within_the_accepted_work_is_not_flagged() -> None:
    assert invoiced_over_accepted("k", "", LineFigures(invoiced=D("100"), measured=D("100"), certified=D("40"))) is None
