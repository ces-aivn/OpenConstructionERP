# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Draw a contract's schedule of values from the bill of quantities it prices.

A payment application is billed line by line against the schedule of values,
and "Populate from progress" bills a schedule line at the latest progress
reading of the BOQ position it is linked to. A contract whose schedule had to
be typed in line by line, and then linked line by line, was in practice never
billed from progress at all. This module picks the priced positions of a bill
and turns each into one schedule line linked to its position.

Pure: no database and no HTTP. The service reads the positions and writes the
lines; everything decided in between is decided here so it can be tested on
plain objects.

Which positions become lines:

* a section header carries no money and never does;
* a row with nothing to bill (quantity times rate is zero) does not either;
* a priced row with priced rows under it is a roll-up of them, so its children
  are billed and it is not, or the same work would be scheduled twice;
* when the caller names positions, a named row brings every row under it, the
  way a package scope is picked in tendering.

A position priced in another currency than the contract is converted into the
contract currency through the project's FX table (units of the project
currency per one unit of the other), the table the bill's own totals use. A
currency the table has no rate for is refused rather than scheduled at the
foreign figure.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.core.currency_registry import money_quantum

#: Where the drawn line records the bill it came from. The position link itself
#: lives under ``boq_position_id`` (``service.BOQ_POSITION_META_KEY``), which is
#: what the progress bridge reads.
SOURCE_META_KEY = "sov_source"
SOURCE_BOQ = "boq"
BOQ_ID_META_KEY = "boq_id"

#: Longest description a schedule line takes (``ContractLineCreate.description``).
_DESCRIPTION_MAX = 2000
#: Longest code and unit the line columns take.
_CODE_MAX = 80
_UNIT_MAX = 20
#: Decimal places of ``ContractLine.unit_rate``.
_RATE_QUANTUM = Decimal("0.0001")


def to_decimal(value: Any) -> Decimal:
    """A stored BOQ number (kept as text) as a Decimal; blank or unreadable is zero."""
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        return Decimal("0")


@dataclass(frozen=True)
class SovLineSpec:
    """One schedule line to be written, linked to the position it measures."""

    position_id: Any
    code: str
    description: str
    unit: str | None
    quantity: Decimal
    unit_rate: Decimal
    total_value: Decimal
    classification: dict[str, str]


def _children_index(positions: Sequence[Any]) -> dict[Any, list[Any]]:
    index: dict[Any, list[Any]] = {}
    for pos in positions:
        parent = getattr(pos, "parent_id", None)
        if parent is not None:
            index.setdefault(parent, []).append(pos)
    return index


def _descendants(root_ids: Iterable[Any], children: dict[Any, list[Any]]) -> set[Any]:
    """The named ids and every id under them."""
    seen: set[Any] = set()
    stack = list(root_ids)
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(child.id for child in children.get(current, []))
    return seen


def position_value(position: Any) -> Decimal:
    """Quantity times rate, the figure a BOQ row carries as its total."""
    return to_decimal(getattr(position, "quantity", None)) * to_decimal(getattr(position, "unit_rate", None))


def billable_positions(
    positions: Sequence[Any],
    *,
    is_section: Callable[[Any], bool],
    position_ids: Iterable[Any] | None = None,
) -> list[Any]:
    """The positions that become schedule lines, in the order given.

    ``positions`` is the whole bill, so a named row can bring its children and
    a parent can be recognised as a roll-up even when only it was named.
    """
    children = _children_index(positions)
    scope: set[Any] | None = None
    if position_ids is not None:
        scope = _descendants(position_ids, children)

    def priced(pos: Any) -> bool:
        return not is_section(pos) and position_value(pos) != 0

    def has_priced_descendant(pos: Any) -> bool:
        stack = list(children.get(pos.id, []))
        while stack:
            child = stack.pop()
            if priced(child):
                return True
            stack.extend(children.get(child.id, []))
        return False

    return [
        pos
        for pos in positions
        if (scope is None or pos.id in scope) and priced(pos) and not has_priced_descendant(pos)
    ]


def _classification(position: Any) -> dict[str, str]:
    raw = getattr(position, "classification", None)
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if isinstance(k, str) and isinstance(v, str | int) and str(v)}


class MissingExchangeRate(ValueError):
    """A position's currency cannot be converted into the contract currency."""

    def __init__(self, from_currency: str, to_currency: str) -> None:
        super().__init__(f"No exchange rate between {from_currency} and {to_currency}")
        self.from_currency = from_currency
        self.to_currency = to_currency


def currency_factor(
    from_currency: str | None,
    to_currency: str | None,
    *,
    base_currency: str | None,
    fx_rates: Mapping[str, Any] | None,
) -> Decimal:
    """What one unit of ``from_currency`` is worth in ``to_currency``.

    A blank code is the project (base) currency. Rates are units of the base
    currency per one unit of the other currency; converting between two
    foreign currencies goes through the base. Raises
    :class:`MissingExchangeRate` when a needed rate is absent or not positive.
    """
    base = (base_currency or "").strip().upper()
    source = (from_currency or "").strip().upper() or base
    target = (to_currency or "").strip().upper() or base
    if not source or not target or source == target:
        return Decimal("1")
    rates = fx_rates or {}

    def in_base(code: str) -> Decimal:
        if code == base:
            return Decimal("1")
        rate = to_decimal(rates.get(code))
        if rate <= 0:
            raise MissingExchangeRate(source, target)
        return rate

    return in_base(source) / in_base(target)


def sov_line_specs(
    positions: Iterable[Any],
    currency: str | None,
    *,
    currency_of: Callable[[Any], str] | None = None,
    base_currency: str | None = None,
    fx_rates: Mapping[str, Any] | None = None,
) -> list[SovLineSpec]:
    """One schedule line per position, in the contract's currency, the value rounded once.

    ``currency_of`` gives a position's own currency (blank for the project
    currency); without it every position is taken to be in the contract
    currency. Raises :class:`MissingExchangeRate` for a currency the project's
    FX table cannot convert.
    """
    quantum = money_quantum(currency)
    specs: list[SovLineSpec] = []
    for pos in positions:
        quantity = to_decimal(getattr(pos, "quantity", None))
        factor = (
            currency_factor(currency_of(pos), currency, base_currency=base_currency, fx_rates=fx_rates)
            if currency_of is not None
            else Decimal("1")
        )
        priced_rate = to_decimal(getattr(pos, "unit_rate", None))
        rate = priced_rate * factor
        if factor != 1:
            # The line column keeps four places; the value below is taken from
            # the unrounded rate so it matches the bill.
            rate = rate.quantize(_RATE_QUANTUM, rounding=ROUND_HALF_UP)
        unit = (getattr(pos, "unit", None) or "").strip()[:_UNIT_MAX] or None
        specs.append(
            SovLineSpec(
                position_id=pos.id,
                code=(getattr(pos, "ordinal", None) or "").strip()[:_CODE_MAX],
                description=(getattr(pos, "description", None) or "").strip()[:_DESCRIPTION_MAX],
                unit=unit,
                quantity=quantity,
                unit_rate=rate,
                total_value=(quantity * priced_rate * factor).quantize(quantum, rounding=ROUND_HALF_UP),
                classification=_classification(pos),
            )
        )
    return specs


__all__ = [
    "BOQ_ID_META_KEY",
    "MissingExchangeRate",
    "SOURCE_BOQ",
    "SOURCE_META_KEY",
    "SovLineSpec",
    "billable_positions",
    "currency_factor",
    "position_value",
    "sov_line_specs",
    "to_decimal",
]
