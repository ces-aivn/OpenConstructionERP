# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""What a locked bill puts into the budget beyond its direct cost.

A bill's budget is its total before VAT: the direct cost of its positions
plus the markups on top of them (general conditions, overheads, profit,
insurance, bond, contingency). Budgeting the direct cost alone left a third of
a stadium's price out of the budget, so every later "remaining budget" and
variance read against a figure the contract never had.

VAT is not a cost to the project's budget: it is charged on and recovered, so
a markup of category ``tax`` stays out. Every other active markup line is
taken at the amount the bill's own markup cascade gives it
(:meth:`BOQService.calculate_markups`, the same arithmetic as the bill's
grand total), so the budget and the bill agree to the cent.

Both budget writers use this module: the finance budget, one row per WBS
group, spreads the markups over its rows in proportion to their direct cost
(:func:`spread`), and the 5D cost model adds one budget line per markup.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Hashable, Mapping
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.finance.settlement import round_money

logger = logging.getLogger(__name__)

_ZERO = Decimal("0")

#: The markup category that is VAT, kept out of the budget.
TAX_CATEGORY = "tax"


@dataclass(frozen=True)
class BillMarkup:
    """One markup line of a bill and what it adds."""

    markup_id: uuid.UUID
    name: str
    category: str
    amount: Decimal


async def bill_markups(session: AsyncSession, boq_id: uuid.UUID) -> list[BillMarkup]:
    """The bill's active, non-VAT markup lines with a non-zero amount, in cascade order."""
    from app.modules.boq.service import BOQService  # noqa: PLC0415 - boq is optional for finance

    _, calculated = await BOQService(session).calculate_markups(boq_id)
    out: list[BillMarkup] = []
    for markup, amount in calculated:
        if not getattr(markup, "is_active", True):
            continue
        category = (getattr(markup, "category", "") or "").strip().lower()
        if category == TAX_CATEGORY:
            continue
        value = Decimal(str(amount or 0))
        if value == _ZERO:
            continue
        out.append(BillMarkup(markup_id=markup.id, name=markup.name or "", category=category or "other", amount=value))
    return out


def spread[K: Hashable](
    direct_by_key: Mapping[K, Decimal],
    extra: Decimal,
    currency_code: str | None,
) -> dict[K, Decimal]:
    """Share ``extra`` over the keys in proportion to their direct amounts.

    Each share is rounded to the currency, and the rounding remainder goes to
    the largest key, so the shares add up to ``extra`` exactly. When the direct
    amounts sum to zero the whole of ``extra`` goes to the first key.
    """
    keys = list(direct_by_key)
    if not keys or extra == _ZERO:
        return dict.fromkeys(keys, _ZERO)
    base = sum(direct_by_key.values(), _ZERO)
    if base == _ZERO:
        shares = dict.fromkeys(keys, _ZERO)
        shares[keys[0]] = round_money(extra, currency_code)
        return shares
    shares = {key: round_money(extra * direct_by_key[key] / base, currency_code) for key in keys}
    remainder = round_money(extra, currency_code) - sum(shares.values(), _ZERO)
    if remainder:
        largest = max(keys, key=lambda k: direct_by_key[k])
        shares[largest] += remainder
    return shares


__all__ = ["TAX_CATEGORY", "BillMarkup", "bill_markups", "spread"]
