# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""An unrealistic rate is judged per unit, not by the size of the line.

``boq_quality.unrealistic_rate`` warned on every line whose total passed
10,000,000 EUR converted into the bill's currency ("total 240,000,000.00 USD >
10,800,000.00 USD"), so a one-billion-dollar hospital collected twelve warnings
for having large quantities, and it held every unit rate to one flat
100,000 EUR whatever the unit, so an operating theatre fitted out at
1,500,000 USD each was "unrealistic". The rule now compares the rate with a
ceiling for its unit and leaves line totals alone. The four bills the
acceptance test priced, two in USD and two in VND, raise no warning; a rate
typed a thousand times too high still does.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest

from app.core.validation.engine import ValidationContext
from app.core.validation.rules import UnrealisticRate

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uat_boq"


def _amount(text: str, currency: str) -> float:
    # The VND bills group thousands with "." and the USD bills with ",".
    if currency == "VND":
        return float(text.replace(".", "").replace(",", "."))
    return float(text.replace(",", ""))


def _bill(name: str) -> tuple[str, list[dict[str, Any]]]:
    with (_FIXTURES / name).open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    currency = rows[0][4].split("(")[1].rstrip(")")
    positions = [
        {
            "id": row[0],
            "ordinal": row[0],
            "description": row[1],
            "unit": row[2],
            "quantity": _amount(row[3], currency),
            "unit_rate": _amount(row[4], currency),
            "total": _amount(row[5], currency),
            "metadata": {"currency": currency},
        }
        for row in rows[1:]
        if row and row[0].strip()
    ]
    return currency, positions


def _ctx(positions: list[dict[str, Any]]) -> ValidationContext:
    return ValidationContext(data={"positions": positions}, metadata={"locale": "en"})


def _pos(rate: float, unit: str, *, currency: str = "EUR", qty: float = 1.0) -> dict[str, Any]:
    return {
        "id": "p",
        "ordinal": "01",
        "description": "line",
        "unit": unit,
        "quantity": qty,
        "unit_rate": rate,
        "total": rate * qty,
        "metadata": {"currency": currency},
    }


@pytest.mark.parametrize(
    "name",
    [
        "BOQ_CS-US01_SoFi.csv",
        "BOQ_CS-US02_Penn.csv",
        "BOQ_CS-VN01_Landmark81.csv",
        "BOQ_CS-VN02_LEGO.csv",
    ],
)
async def test_a_real_bill_raises_no_unrealistic_rate(name: str) -> None:
    currency, positions = _bill(name)

    results = await UnrealisticRate().validate(_ctx(positions))

    assert len(results) == len(positions)
    assert not [r for r in results if r.is_engine_error], f"{currency} must be priced by the FX register"
    flagged = {r.element_ref: r.message for r in results if not r.passed}
    assert flagged == {}


async def test_a_rate_typed_a_thousand_times_too_high_still_fires_in_vnd() -> None:
    _, positions = _bill("BOQ_CS-VN01_Landmark81.csv")
    # "m2 sàn" at 4,200,000 VND typed as 4,200,000,000.
    slip = dict(positions[5], id="slip", unit_rate=positions[5]["unit_rate"] * 1_000)

    (row,) = await UnrealisticRate().validate(_ctx([slip]))

    assert row.passed is False
    assert row.details["currency"] == "VND"
    assert row.details["unit_dimension"] == "area"
    assert "total_threshold" not in row.details
    assert "unit_rate" in row.message and "total" not in row.message


async def test_the_ceiling_follows_the_size_of_the_unit() -> None:
    per_kg, per_tonne = await UnrealisticRate().validate(_ctx([_pos(300, "kg"), _pos(300, "t")]))

    assert per_kg.passed is False
    assert per_kg.details["rate_threshold"] == pytest.approx(250)
    assert per_tonne.passed is True


async def test_a_fitted_out_room_is_priced_per_piece() -> None:
    room, finish = await UnrealisticRate().validate(
        _ctx([_pos(1_500_000, "EA"), _pos(1_500_000, "m2")]),
    )

    assert room.passed is True
    assert finish.passed is False


@pytest.mark.parametrize(
    ("unit", "dimension"),
    [("m2 sàn", "area"), ("m2 GFA", "area"), ("tấn", "mass"), ("md", "length"), ("LF", "length"), ("bộ", "count")],
)
async def test_the_units_written_on_vietnamese_and_us_bills_are_understood(unit: str, dimension: str) -> None:
    (row,) = await UnrealisticRate().validate(_ctx([_pos(10, unit)]))

    assert row.details["unit_dimension"] == dimension


async def test_a_unit_nobody_knows_is_judged_as_one_item() -> None:
    ordinary, slip = await UnrealisticRate().validate(_ctx([_pos(400, "kWp"), _pos(50_000_000, "kWp")]))

    assert ordinary.passed is True
    assert ordinary.details["unit_dimension"] is None
    assert slip.passed is False
