# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Which rows of a bill become schedule of values lines, and at what value.

Pure: the selection and the rounding are decided on plain objects, without a
database, so every rule is pinned here and the PostgreSQL test only has to
show the lines are written and linked.
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.modules.contracts.sov_from_boq import billable_positions, sov_line_specs, to_decimal


def _pos(pid: str, *, parent: str | None = None, unit: str = "m3", qty: str = "0", rate: str = "0", **kw):
    return SimpleNamespace(
        id=pid,
        parent_id=parent,
        ordinal=kw.get("ordinal", pid),
        description=kw.get("description", f"Row {pid}"),
        unit=unit,
        quantity=qty,
        unit_rate=rate,
        classification=kw.get("classification", {}),
    )


def _is_section(pos) -> bool:
    return (pos.unit or "").strip().lower() in ("", "section") and to_decimal(pos.quantity) == 0


BILL = [
    _pos("S1", unit=""),  # section header
    _pos("P1", parent="S1", qty="10", rate="100"),
    _pos("P2", parent="S1", qty="2.5", rate="333333.33"),
    _pos("R1", parent="S1", qty="1", rate="5000"),  # priced roll-up of R1a and R1b
    _pos("R1a", parent="R1", qty="1", rate="3000"),
    _pos("R1b", parent="R1", qty="1", rate="2000"),
    _pos("E1", parent="S1", qty="0", rate="0", unit="m2"),  # nothing filled in yet
    _pos("S2", unit="section"),
    _pos("P3", parent="S2", qty="4", rate="50"),
]


def _ids(rows) -> list[str]:
    return [r.id for r in rows]


def test_only_priced_rows_with_nothing_priced_under_them_become_lines() -> None:
    picked = billable_positions(BILL, is_section=_is_section)
    # Sections carry no money, an empty row bills nothing, and a priced row
    # whose children are priced is their roll-up: scheduling it as well would
    # schedule the same work twice.
    assert _ids(picked) == ["P1", "P2", "R1a", "R1b", "P3"]


def test_a_named_row_brings_every_row_under_it() -> None:
    assert _ids(billable_positions(BILL, is_section=_is_section, position_ids=["S1"])) == ["P1", "P2", "R1a", "R1b"]
    # Naming only the roll-up still schedules its children, not the roll-up.
    assert _ids(billable_positions(BILL, is_section=_is_section, position_ids=["R1"])) == ["R1a", "R1b"]
    assert _ids(billable_positions(BILL, is_section=_is_section, position_ids=["P3"])) == ["P3"]


def test_the_scheduled_value_is_rounded_once_in_the_contract_currency() -> None:
    picked = billable_positions(BILL, is_section=_is_section, position_ids=["P2"])
    (vnd,) = sov_line_specs(picked, "VND")
    (usd,) = sov_line_specs(picked, "USD")
    # 2.5 x 333,333.33 = 833,333.325: a whole dong in VND, cents in USD.
    assert vnd.total_value == Decimal("833333")
    assert usd.total_value == Decimal("833333.33")
    assert vnd.quantity == Decimal("2.5")
    assert vnd.unit_rate == Decimal("333333.33")


def test_a_line_carries_its_position_code_text_unit_and_classification() -> None:
    row = _pos(
        "P9",
        qty="3",
        rate="1,000",
        ordinal="02.01.0010",
        description="  Bê tông móng M300  ",
        classification={"vn_tt12": "AF.11213", "bad": None},
    )
    (spec,) = sov_line_specs([row], "VND")
    assert spec.position_id == "P9"
    assert spec.code == "02.01.0010"
    assert spec.description == "Bê tông móng M300"
    assert spec.unit == "m3"
    # A thousands separator in a stored rate is read, not refused.
    assert spec.total_value == Decimal("3000")
    assert spec.classification == {"vn_tt12": "AF.11213"}


def test_unreadable_numbers_read_as_zero_and_the_row_is_not_scheduled() -> None:
    rows = [_pos("X", qty="abc", rate="10")]
    assert billable_positions(rows, is_section=_is_section) == []


def test_a_rate_between_two_foreign_currencies_goes_through_the_project_currency() -> None:
    from app.modules.contracts.sov_from_boq import currency_factor

    rates = {"USD": "25000", "EUR": "27500"}
    assert currency_factor("", "USD", base_currency="VND", fx_rates=rates) == Decimal("0.00004")
    assert currency_factor("USD", "", base_currency="VND", fx_rates=rates) == Decimal("25000")
    assert currency_factor("EUR", "USD", base_currency="VND", fx_rates=rates) == Decimal("1.1")
    assert currency_factor("usd", "USD", base_currency="VND", fx_rates={}) == Decimal("1")


def test_a_currency_without_a_rate_cannot_be_converted() -> None:
    from app.modules.contracts.sov_from_boq import MissingExchangeRate, currency_factor

    with pytest.raises(MissingExchangeRate) as missing:
        currency_factor("JPY", "USD", base_currency="VND", fx_rates={"USD": "25000"})
    assert (missing.value.from_currency, missing.value.to_currency) == ("JPY", "USD")
