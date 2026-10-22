# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""A lump-sum line has no unit rate to judge.

``boq_quality.unrealistic_rate`` compared every unit rate against a ceiling
written per unit. A lump sum is priced as one unit whose rate is the whole
line, so a schedule of values made of lump-sum sections (preliminaries, the
mechanical services, commissioning) fired the rule on every line above the
ceiling. The contract signature gate runs this rule over the schedule of
values, so a lump-sum subcontract collected a warning per line for a rate
that is nothing but the line's own total.

The rule now leaves a unit the unit registry files as a lump alone, and it no
longer judges line totals at all, so a lump sum is not flagged for its size
either. A measured line is still judged by its rate.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.validation.engine import ValidationContext
from app.core.validation.rules import UnrealisticRate


def _pos(pid: str, rate: float, *, unit: str, qty: float = 1.0) -> dict[str, Any]:
    return {
        "id": pid,
        "ordinal": pid,
        "description": f"item {pid}",
        "unit": unit,
        "quantity": qty,
        "unit_rate": rate,
        "total": rate * qty,
        "metadata": {"currency": "EUR"},
    }


def _ctx(positions: list[dict[str, Any]]) -> ValidationContext:
    return ValidationContext(data={"positions": positions}, metadata={"locale": "en"})


@pytest.mark.parametrize("unit", ["lsum", "LS", "psch", "Pauschal", "lot", "item"])
async def test_a_lump_sum_line_above_the_rate_ceiling_passes(unit: str) -> None:
    (row,) = await UnrealisticRate().validate(_ctx([_pos("1", 450_000, unit=unit)]))

    assert row.passed is True


async def test_a_measured_line_at_the_same_rate_still_fires() -> None:
    (row,) = await UnrealisticRate().validate(_ctx([_pos("1", 450_000, unit="m3")]))

    assert row.passed is False


@pytest.mark.parametrize("unit", ["gói", "trọn gói", "LS"])
async def test_a_lump_sum_line_is_not_judged_by_its_size(unit: str) -> None:
    (row,) = await UnrealisticRate().validate(_ctx([_pos("1", 12_000_000, unit=unit)]))

    assert row.passed is True
