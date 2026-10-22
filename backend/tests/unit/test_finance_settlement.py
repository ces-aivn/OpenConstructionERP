# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""What is settled and open on an invoice, how markups spread over a budget, and how a run amount is read."""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.core.validation.engine import Severity, ValidationContext
from app.modules.finance.boq_budget import spread
from app.modules.finance.payment_run_service import parse_run_amount
from app.modules.finance.settlement import SettlementPayment, settle
from app.modules.payment_release.claim_rules import ClaimAmountPositiveRule

# ── settle ────────────────────────────────────────────────────────────────


def test_a_partial_payment_leaves_the_rest_open_and_marks_the_invoice_partially_paid() -> None:
    position = settle(
        total="54750109.50",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="20000000.00")],
    )
    assert position.paid == Decimal("20000000.00")
    assert position.open == Decimal("34750109.50")
    assert position.payment_status == "partially_paid"
    assert position.cash_to_settle == Decimal("34750109.50")


def test_an_invoice_with_no_payment_is_open_in_full() -> None:
    position = settle(total="1000", status="approved", currency_code="USD")
    assert position.open == Decimal("1000.00")
    assert position.payment_status == "unpaid"


def test_a_refund_reopens_what_it_gives_back() -> None:
    position = settle(
        total="1000",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="1000"), SettlementPayment(amount="250", is_refund=True)],
    )
    assert position.paid == Decimal("750.00")
    assert position.open == Decimal("250.00")
    assert position.payment_status == "partially_paid"


def test_withheld_retention_is_no_longer_open_and_only_the_rest_is_still_to_withhold() -> None:
    position = settle(
        total="1000",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="570", withholding="30")],
        retention="50",
    )
    assert position.settled == Decimal("600.00")
    assert position.open == Decimal("400.00")
    assert position.retention_to_withhold == Decimal("20.00")
    assert position.cash_to_settle == Decimal("380.00")


def test_overpaying_leaves_nothing_open_and_records_the_excess() -> None:
    position = settle(total="100", status="approved", currency_code="USD", payments=[SettlementPayment(amount="120")])
    assert position.open == Decimal("0.00")
    assert position.overpaid == Decimal("20.00")
    assert position.payment_status == "paid"


@pytest.mark.parametrize("status", ["paid", "cancelled", "credit_note_issued"])
def test_a_closed_invoice_has_nothing_open_whatever_was_paid(status: str) -> None:
    position = settle(total="100", status=status, currency_code="USD")
    assert position.open == Decimal("0.00")
    assert position.retention_to_withhold == Decimal("0.00")


def test_dong_amounts_are_rounded_to_whole_dong() -> None:
    position = settle(
        total="1000000.4", status="approved", currency_code="VND", payments=[SettlementPayment(amount="0.6")]
    )
    # The total is a whole-dong 1,000,000 before the payment is taken off it.
    assert position.total == Decimal("1000000")
    assert position.open == Decimal("999999")
    assert position.open.as_tuple().exponent == 0


def test_a_dong_total_with_a_fraction_is_settled_exactly_by_the_whole_dong_amount() -> None:
    position = settle(
        total="1234567.40", status="approved", currency_code="VND", payments=[SettlementPayment(amount="1234567")]
    )
    assert position.open == Decimal("0")
    assert position.overpaid == Decimal("0")
    assert position.payment_status == "paid"


def test_a_payment_in_another_currency_counts_at_its_exchange_rate() -> None:
    # A USD 10,000 invoice paid with VND 250,000,000 at 0.00004 USD per dong.
    position = settle(
        total="10000",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="250000000", currency_code="VND", exchange_rate="0.00004")],
    )
    assert position.paid == Decimal("10000.00")
    assert position.open == Decimal("0.00")
    assert position.payment_status == "paid"


def test_a_part_payment_in_another_currency_leaves_the_rest_open_in_the_invoice_currency() -> None:
    position = settle(
        total="10000",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="125000000", currency_code="vnd", exchange_rate="0.00004")],
    )
    assert position.paid == Decimal("5000.00")
    assert position.open == Decimal("5000.00")
    assert position.payment_status == "partially_paid"


def test_a_payment_in_the_invoice_currency_ignores_its_rate() -> None:
    position = settle(
        total="100",
        status="approved",
        currency_code="USD",
        payments=[SettlementPayment(amount="40", currency_code="USD", exchange_rate="25000")],
    )
    assert position.paid == Decimal("40.00")


def test_unreadable_amounts_count_as_zero() -> None:
    position = settle(total="abc", status="approved", currency_code="USD", payments=[SettlementPayment(amount=None)])
    assert position.total == Decimal("0.00")
    assert position.payment_status == "unpaid"


# ── spread ────────────────────────────────────────────────────────────────


def test_markups_spread_in_proportion_and_add_up_to_the_cent() -> None:
    shares = spread({"a": Decimal("100"), "b": Decimal("200")}, Decimal("100.00"), "USD")
    assert shares == {"a": Decimal("33.33"), "b": Decimal("66.67")}
    assert sum(shares.values()) == Decimal("100.00")


def test_markups_over_rows_with_no_direct_cost_land_on_the_first_row() -> None:
    shares = spread({"a": Decimal("0"), "b": Decimal("0")}, Decimal("10"), "VND")
    assert shares == {"a": Decimal("10"), "b": Decimal("0")}


def test_nothing_to_spread_gives_zero_shares() -> None:
    assert spread({"a": Decimal("5")}, Decimal("0"), "USD") == {"a": Decimal("0")}
    assert spread({}, Decimal("5"), "USD") == {}


# ── parse_run_amount ──────────────────────────────────────────────────────


def test_a_run_amount_accepts_a_comma_decimal_and_rounds_to_the_currency() -> None:
    assert parse_run_amount("20000000,505", "USD") == Decimal("20000000.51")
    assert parse_run_amount(" 1500.4 ", "VND") == Decimal("1500")


@pytest.mark.parametrize("raw", ["20,000", "1,500", "-2,500", " 999,000 "])
def test_a_run_amount_with_a_comma_that_could_be_a_thousands_separator_is_refused(raw: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_run_amount(raw, "VND")
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "payment_amount_ambiguous"
    assert exc_info.value.detail["field"] == "amount"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("20,5", Decimal("20.50")),
        ("20,50", Decimal("20.50")),
        ("1234,567", Decimal("1234.57")),
        ("20000", Decimal("20000.00")),
    ],
)
def test_a_run_amount_whose_comma_can_only_be_a_decimal_is_read(raw: str, expected: Decimal) -> None:
    assert parse_run_amount(raw, "USD") == expected


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("abc", "payment_amount_invalid"),
        ("", "payment_amount_invalid"),
        ("NaN", "payment_amount_invalid"),
        ("0", "payment_amount_not_positive"),
        ("-5", "payment_amount_not_positive"),
    ],
)
def test_a_run_amount_that_is_not_a_positive_number_is_refused_with_a_code(raw: str, code: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        parse_run_amount(raw, "USD")
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == code
    assert exc_info.value.detail["field"] == "amount"


# ── a payment application must ask for something ──────────────────────────


def _claim_ctx(gross: str, net_due: str, *, has_schedule: bool, locale: str = "en") -> ValidationContext:
    return ValidationContext(
        data={
            "claim": {"id": "c1", "number": "PA-001"},
            "totals": {"gross_amount": gross, "net_due": net_due, "has_lines": has_schedule},
            "schedule": {"has_lines": has_schedule},
            "currency": "VND",
        },
        metadata={"locale": locale},
    )


@pytest.mark.asyncio
async def test_a_claim_for_nothing_is_blocked_and_points_at_the_schedule_of_values() -> None:
    (result,) = await ClaimAmountPositiveRule().validate(_claim_ctx("0", "0", has_schedule=False))
    assert result.passed is False
    assert result.severity == Severity.ERROR
    assert "PA-001" in result.message
    assert result.suggestion


@pytest.mark.asyncio
async def test_a_claim_for_nothing_is_worded_in_vietnamese_for_a_vietnamese_reader() -> None:
    (en,) = await ClaimAmountPositiveRule().validate(_claim_ctx("0", "0", has_schedule=True))
    (vi,) = await ClaimAmountPositiveRule().validate(_claim_ctx("0", "0", has_schedule=True, locale="vi"))
    assert vi.message != en.message
    assert vi.suggestion != en.suggestion


@pytest.mark.asyncio
@pytest.mark.parametrize(("gross", "net_due"), [("100", "90"), ("0", "500")])
async def test_a_claim_that_asks_for_money_passes(gross: str, net_due: str) -> None:
    (result,) = await ClaimAmountPositiveRule().validate(_claim_ctx(gross, net_due, has_schedule=True))
    assert result.passed is True


@pytest.mark.asyncio
async def test_the_rule_is_silent_without_a_claim() -> None:
    assert await ClaimAmountPositiveRule().validate(ValidationContext(data={}, metadata={})) == []
