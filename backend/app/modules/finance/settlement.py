# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""How much of an invoice is settled and how much is still open - pure arithmetic.

One definition for every reader that asks "what is still owed on this
invoice": the invoice list, the finance dashboard (unpaid and overdue), the
"mark as paid" action and the cost-control readers in other modules. Before it
existed the dashboard summed every unpaid invoice at its full total, so a
partial payment changed nothing on screen and the mark-paid action could be
read as paying the whole invoice a second time.

For one invoice:

* ``paid`` is the net cash of its payments: forward payments minus refunds.
* ``withheld`` is the retainage those payments held back (a refund gives back
  the retainage it carries as well). Withheld retainage is still a liability,
  tracked in the retention ledger, but it is no longer open on the invoice: it
  has been dealt with by the payment that held it.
* ``settled`` is ``paid + withheld``; ``open`` is ``total - settled``, never
  below zero. Anything paid beyond the total is ``overpaid``.
* ``retention_to_withhold`` is the invoice's scheduled retention not yet held
  back by any payment, capped at what is open, so settling the rest of the
  invoice holds back exactly what is left of the retention.
* ``payment_status`` is ``unpaid`` (nothing settled), ``partially_paid``
  (something settled, something open) or ``paid`` (nothing open, or the
  invoice was closed as paid).

An invoice that is ``paid``, ``cancelled`` or ``credit_note_issued`` has
nothing open whatever its payments say: the status wins, the same rule the
ageing report applies.

A payment made in another currency than the invoice counts at its stored
exchange rate: ``amount x exchange_rate`` in the invoice currency, the same
"target units per one unit of the other currency" convention the project FX
table uses. A payment with no currency code is in the invoice currency.

The invoice total is rounded to the currency's own minor units (0 decimals for
VND, 2 for USD) before anything is compared with it, so a VND total stored as
1,234,567.40 is settled exactly by a payment of 1,234,567. Every other amount is
rounded once, at the end, to the same minor units.

This module imports nothing from SQLAlchemy or FastAPI.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.core.currency_registry import money_quantum

_ZERO = Decimal("0")

#: Statuses after which nothing is open on an invoice, whatever was paid.
CLOSED_STATUSES = frozenset({"paid", "cancelled", "credit_note_issued"})

UNPAID = "unpaid"
PARTIALLY_PAID = "partially_paid"
PAID = "paid"


def to_decimal(value: object) -> Decimal:
    """A finite Decimal, or zero for anything that is not one."""
    if isinstance(value, Decimal):
        return value if value.is_finite() else _ZERO
    if value is None or isinstance(value, bool):
        return _ZERO
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        return _ZERO
    return parsed if parsed.is_finite() else _ZERO


def round_money(value: Decimal, currency_code: str | None) -> Decimal:
    """``value`` rounded half-up to the minor units of ``currency_code``."""
    return value.quantize(money_quantum(currency_code), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class SettlementPayment:
    """One payment row as the arithmetic reads it."""

    amount: object = _ZERO
    withholding: object = _ZERO
    is_refund: bool = False
    #: The payment's own currency; blank means the invoice currency.
    currency_code: str | None = None
    #: Units of the invoice currency per one unit of the payment currency.
    exchange_rate: object = Decimal("1")


def in_invoice_currency(
    value: object,
    *,
    payment_currency: str | None,
    exchange_rate: object,
    invoice_currency: str | None,
) -> Decimal:
    """``value`` of a payment expressed in the invoice currency.

    Unchanged when the payment is in the invoice currency (or either code is
    blank); otherwise multiplied by the payment's stored exchange rate. A
    missing or non-positive rate leaves the amount as it is: the write paths
    refuse a cross-currency payment without a rate, so such a row predates them.
    """
    amount = to_decimal(value)
    pay = (payment_currency or "").strip().upper()
    inv = (invoice_currency or "").strip().upper()
    if not pay or not inv or pay == inv:
        return amount
    rate = to_decimal(exchange_rate)
    return amount * rate if rate > _ZERO else amount


@dataclass(frozen=True)
class InvoiceSettlement:
    """The settled and open position of one invoice, in its own currency."""

    currency_code: str
    status: str
    total: Decimal
    paid: Decimal
    withheld: Decimal
    settled: Decimal
    open: Decimal
    overpaid: Decimal
    retention_to_withhold: Decimal
    payment_status: str

    @property
    def cash_to_settle(self) -> Decimal:
        """The cash that pays off what is open, after the retention still to hold back."""
        return self.open - self.retention_to_withhold


def settle(
    *,
    total: object,
    status: str,
    currency_code: str | None,
    payments: Iterable[SettlementPayment] = (),
    retention: object = _ZERO,
) -> InvoiceSettlement:
    """The settled and open position of one invoice."""
    currency = (currency_code or "").strip().upper()
    gross = round_money(to_decimal(total), currency)
    paid = _ZERO
    withheld = _ZERO
    for pay in payments:
        sign = -1 if pay.is_refund else 1
        paid += sign * in_invoice_currency(
            pay.amount, payment_currency=pay.currency_code, exchange_rate=pay.exchange_rate, invoice_currency=currency
        )
        withheld += sign * in_invoice_currency(
            pay.withholding,
            payment_currency=pay.currency_code,
            exchange_rate=pay.exchange_rate,
            invoice_currency=currency,
        )
    settled = paid + withheld
    remainder = gross - settled
    arithmetic_open = remainder if remainder > _ZERO else _ZERO
    overpaid = -remainder if remainder < _ZERO else _ZERO

    closed = status in CLOSED_STATUSES
    open_amount = _ZERO if closed else arithmetic_open
    to_withhold = max(to_decimal(retention) - max(withheld, _ZERO), _ZERO)
    to_withhold = min(to_withhold, open_amount)

    if status == "paid" or (settled > _ZERO and arithmetic_open == _ZERO):
        payment_status = PAID
    elif settled > _ZERO:
        payment_status = PARTIALLY_PAID
    else:
        payment_status = UNPAID

    return InvoiceSettlement(
        currency_code=currency,
        status=status,
        total=round_money(gross, currency),
        paid=round_money(paid, currency),
        withheld=round_money(withheld, currency),
        settled=round_money(settled, currency),
        open=round_money(open_amount, currency),
        overpaid=round_money(overpaid, currency),
        retention_to_withhold=round_money(to_withhold, currency),
        payment_status=payment_status,
    )


__all__ = [
    "CLOSED_STATUSES",
    "PAID",
    "PARTIALLY_PAID",
    "UNPAID",
    "InvoiceSettlement",
    "SettlementPayment",
    "in_invoice_currency",
    "round_money",
    "settle",
    "to_decimal",
]
