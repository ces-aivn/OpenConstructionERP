# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""A tender bid is a non-negative price, measured against its package's own lines.

Three things a buyer reads off the comparison screen depend on this:

* A bid of -5,000 used to be stored, plotted as the lowest bid and printed as
  -100 % against budget. A price somebody offers for the work is never below
  zero, so the API refuses it, with a stable error type the screen words in the
  reader's language rather than the English ``msg``.
* A roof-steel package raised over the whole bill compared a 190 m bid against
  the whole bill's 2.18 bn budget and read -90 %. Picking single bill rows (not
  only whole sections) puts the budget on the package's own lines.
* A recipient whose email is malformed is refused with a coded error too.

No database: the scope collector is pure, and the service is driven through
stubs the way the module's other service tests do it.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.tendering.schemas import (
    BidCreate,
    BidLineItem,
    BidUpdate,
    PackageScopeUpdate,
    RecipientCreate,
)
from app.modules.tendering.service import _collect_scope, _scope_budget, _with_scope


def _error_types(exc: ValidationError) -> list[tuple[str, tuple]]:
    return [(e["type"], tuple(e["loc"])) for e in exc.errors()]


# ── Bid amounts ──────────────────────────────────────────────────────────────


def test_a_negative_bid_total_is_refused_with_a_coded_error() -> None:
    with pytest.raises(ValidationError) as exc:
        BidCreate(company_name="Schuff Steel", total_amount="-5000")
    assert ("amount_negative", ("total_amount",)) in _error_types(exc.value)


def test_a_bid_total_that_is_not_a_number_is_refused() -> None:
    with pytest.raises(ValidationError) as exc:
        BidCreate(company_name="Schuff Steel", total_amount="abc")
    assert ("amount_not_a_number", ("total_amount",)) in _error_types(exc.value)


def test_a_valid_bid_total_is_kept_as_sent_and_an_empty_one_reads_zero() -> None:
    assert BidCreate(company_name="FabriTec", total_amount="190000000").total_amount == "190000000"
    assert BidCreate(company_name="FabriTec", total_amount="0").total_amount == "0"
    assert BidCreate(company_name="FabriTec", total_amount="").total_amount == "0"


def test_a_bid_update_cannot_make_the_total_negative() -> None:
    with pytest.raises(ValidationError) as exc:
        BidUpdate(total_amount="-1")
    assert ("amount_negative", ("total_amount",)) in _error_types(exc.value)
    assert BidUpdate(notes="clarified").total_amount is None


def test_a_negative_line_rate_is_refused() -> None:
    with pytest.raises(ValidationError) as exc:
        BidLineItem(position_id="p-1", unit_rate="-9500")
    assert exc.value.errors()[0]["type"] == "amount_negative"
    with pytest.raises(ValidationError):
        BidCreate(company_name="X", line_items=[{"position_id": "p-1", "quantity": -1}])
    assert BidLineItem(position_id="p-1", quantity=20000, unit_rate="9500").unit_rate == Decimal("9500")


def test_a_malformed_email_is_refused_with_a_coded_error() -> None:
    with pytest.raises(ValidationError) as exc:
        RecipientCreate(company_name="Schuff Steel", email="abc@")
    assert ("invalid_email", ("email",)) in _error_types(exc.value)
    with pytest.raises(ValidationError) as exc:
        BidCreate(company_name="Schuff Steel", contact_email="abc@")
    assert ("invalid_email", ("contact_email",)) in _error_types(exc.value)


def test_bid_management_refuses_negative_money_too() -> None:
    from app.modules.bid_management.schemas import BidSubmissionCreate, BidSubmissionLineCreate

    with pytest.raises(ValidationError):
        BidSubmissionCreate(invitation_id=uuid.uuid4(), bidder_id=uuid.uuid4(), total_amount=Decimal("-5000"))
    with pytest.raises(ValidationError):
        BidSubmissionLineCreate(submission_id=uuid.uuid4(), line_item_id=uuid.uuid4(), unit_price=Decimal("-1"))


# ── Scope ────────────────────────────────────────────────────────────────────


class _Pos:
    def __init__(
        self,
        pid: str,
        *,
        parent: str | None = None,
        quantity: str = "0",
        unit_rate: str = "0",
        unit: str = "",
        description: str = "",
        ordinal: str = "",
    ) -> None:
        self.id = pid
        self.parent_id = parent
        self.quantity = quantity
        self.unit_rate = unit_rate
        self.total = str(Decimal(quantity) * Decimal(unit_rate))
        self.unit = unit
        self.description = description or pid
        self.ordinal = ordinal or pid


# A stadium bill: a structure section with the roof steel beside the concrete,
# and an earthworks section. The whole bill is 2,181,000,000.
_STRUCTURE = _Pos("00000000-0000-0000-0000-0000000000a3", ordinal="03")
_STEEL = _Pos(
    "00000000-0000-0000-0000-0000000000b1",
    parent="00000000-0000-0000-0000-0000000000a3",
    quantity="20000",
    unit_rate="9500",
    unit="t",
)
_CONCRETE = _Pos(
    "00000000-0000-0000-0000-0000000000b2",
    parent="00000000-0000-0000-0000-0000000000a3",
    quantity="1000000",
    unit_rate="1500",
    unit="m3",
)
_EARTH = _Pos("00000000-0000-0000-0000-0000000000a1", ordinal="01")
_DIG = _Pos(
    "00000000-0000-0000-0000-0000000000b3",
    parent="00000000-0000-0000-0000-0000000000a1",
    quantity="1000000",
    unit_rate="491",
    unit="m3",
)
_BILL = [_EARTH, _DIG, _STRUCTURE, _STEEL, _CONCRETE]
_NOT_IN_BILL = "00000000-0000-0000-0000-0000000000ff"


def test_one_bill_row_can_be_the_whole_scope_of_a_package() -> None:
    sections, rows, included = _collect_scope(_BILL, [], [_STEEL.id])
    assert sections == []
    assert rows == [_STEEL.id]
    assert [p.id for p in included] == [_STEEL.id]
    assert _scope_budget(included) == Decimal("190000000")


def test_sections_and_rows_are_unioned_and_a_section_brings_its_lines() -> None:
    _sections, _rows, included = _collect_scope(_BILL, [_EARTH.id], [_STEEL.id])
    assert [p.id for p in included] == [_EARTH.id, _DIG.id, _STEEL.id]


def test_nothing_picked_means_the_whole_bill() -> None:
    sections, rows, included = _collect_scope(_BILL, [], [])
    assert sections == [_EARTH.id, _STRUCTURE.id]
    assert rows == []
    assert len(included) == len(_BILL)
    assert _scope_budget(included) == Decimal("2181000000")


def test_a_pick_outside_the_bill_is_refused_with_a_coded_error() -> None:
    with pytest.raises(HTTPException) as exc:
        _collect_scope(_BILL, [], [_NOT_IN_BILL])
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "scope_position_not_in_bill"
    assert exc.value.detail["field"] == "position_ids"
    with pytest.raises(HTTPException) as exc:
        _collect_scope(_BILL, [_STEEL.id], [])
    assert exc.value.detail["code"] == "scope_section_not_in_bill"


def test_a_new_scope_replaces_the_demo_installers_list_rather_than_widening_it() -> None:
    _s, _r, included = _collect_scope(_BILL, [], [_STEEL.id])
    meta = _with_scope({"scope_position_ids": [_DIG.id], "recipients": [1]}, [], [_STEEL.id], included)
    assert "scope_position_ids" not in meta
    assert meta["recipients"] == [1]
    assert [row["position_id"] for row in meta["line_item_template"]] == [_STEEL.id]
    assert meta["included_position_count"] == 1


# ── The service, on stubs ────────────────────────────────────────────────────


def _service(package: SimpleNamespace, *, bids: list | None = None):
    from app.modules.tendering.service import TenderingService

    service = TenderingService.__new__(TenderingService)
    writes: list[dict] = []

    class _Repo:
        async def list_bids_for_package(self, _pid: object) -> list:
            return list(bids or [])

        async def update_package_fields(self, _pid: object, **fields: object) -> None:
            writes.append(fields)
            if "metadata_" in fields:
                package.metadata_ = fields["metadata_"]

    async def _get_package(_pid: object) -> SimpleNamespace:
        return package

    service.repo = _Repo()
    service.session = SimpleNamespace()
    service.get_package = _get_package
    return service, writes


def _stub_bill(monkeypatch: pytest.MonkeyPatch) -> None:
    class _StubBOQService:
        def __init__(self, _session: object) -> None:
            pass

        async def get_boq_with_positions(self, _boq_id: object) -> SimpleNamespace:
            return SimpleNamespace(name="SoFi BOQ", positions=list(_BILL), project_id=None)

    monkeypatch.setattr("app.modules.boq.service.BOQService", _StubBOQService)


def _package(**overrides: object) -> SimpleNamespace:
    base = {
        "id": uuid.UUID("11111111-0000-0000-0000-000000000001"),
        "project_id": uuid.UUID("22222222-0000-0000-0000-000000000002"),
        "boq_id": uuid.UUID("33333333-0000-0000-0000-000000000003"),
        "name": "Roof steel",
        "description": "",
        "status": "collecting",
        "deadline": None,
        "metadata_": {},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


async def test_narrowing_the_scope_puts_the_comparison_on_the_packages_own_budget(monkeypatch) -> None:
    _stub_bill(monkeypatch)
    bid = SimpleNamespace(
        id=uuid.uuid4(),
        company_name="Schuff Steel",
        total_amount="190000000",
        currency="USD",
        status="submitted",
        line_items=[],
    )
    package = _package()
    service, writes = _service(package, bids=[bid])

    before = await service.compare_bids(package.id)
    assert before.budget_total == Decimal("2181000000.00")
    assert before.bid_totals[0]["deviation_pct"] == pytest.approx(-91.3, abs=0.1)

    scope = await service.set_package_scope(package.id, PackageScopeUpdate(position_ids=[]))
    assert scope.covers_whole_bill is True

    scope = await service.set_package_scope(package.id, PackageScopeUpdate(position_ids=[uuid.UUID(_STEEL.id)]))
    assert scope.position_ids == [_STEEL.id]
    assert scope.budget_total == Decimal("190000000.00")
    assert writes, "the scope was not stored"

    after = await service.compare_bids(package.id)
    assert after.budget_total == Decimal("190000000.00")
    assert after.bid_totals[0]["deviation_pct"] == 0.0


async def test_a_decided_package_keeps_its_scope(monkeypatch) -> None:
    _stub_bill(monkeypatch)
    package = _package(status="awarded")
    service, writes = _service(package)
    with pytest.raises(HTTPException) as exc:
        await service.set_package_scope(package.id, PackageScopeUpdate())
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "package_scope_locked"
    assert writes == []
