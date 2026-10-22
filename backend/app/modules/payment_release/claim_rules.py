# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Payment application rules this module adds to the ``pay_application`` rule set.

The contracts module runs ``pay_application`` before a progress claim is
submitted and blocks on every ERROR in it, including the ones other modules
register. The rule here is about money leaving for payment, which is this
module's concern: a payment application that asks for nothing is not a
payment application.

* ``pay_application.amount_positive``: a claim whose gross this period and net
  due are both zero (no lines, or lines with no work done) cannot be
  submitted. A retention release claim has a gross of zero and a net due above
  it, so it passes. The suggestion points at the schedule of values when the
  contract has none, because a claim is generated from it.

Reads only the plain context the contracts module builds
(``ContractsService.claim_rule_context``): ``claim``, ``totals``, ``schedule``
and ``currency``. Silent on any other data.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation

from app.core.currency_registry import sentence_amount
from app.core.validation.engine import (
    RuleCategory,
    RuleResult,
    Severity,
    ValidationContext,
    ValidationRule,
    rule_registry,
)
from app.modules.payment_release.messages import translate

logger = logging.getLogger(__name__)

#: Spelled as ``contracts.validators.PAY_APPLICATION_RULE_SET``; the import is
#: preferred so a rename there carries over here.
_PAY_APPLICATION_RULE_SET_FALLBACK = "pay_application"


def pay_application_rule_set() -> str:
    """The name of the rule set claim submission runs, asked of the contracts module."""
    try:
        from app.modules.contracts.validators import PAY_APPLICATION_RULE_SET  # noqa: PLC0415
    except ModuleNotFoundError as exc:
        if exc.name not in ("app.modules.contracts", "app.modules.contracts.validators"):
            raise
        return _PAY_APPLICATION_RULE_SET_FALLBACK
    return PAY_APPLICATION_RULE_SET


def _dec(raw: object) -> Decimal:
    try:
        value = Decimal(str(raw if raw not in (None, "") else "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")
    return value if value.is_finite() else Decimal("0")


def _locale(context: ValidationContext) -> str:
    meta = getattr(context, "metadata", None) or {}
    return str(meta.get("locale") or "en")


class ClaimAmountPositiveRule(ValidationRule):
    """A payment application must ask for something."""

    rule_id = "pay_application.amount_positive"
    name = "Payment application asks for an amount"
    standard = _PAY_APPLICATION_RULE_SET_FALLBACK
    severity = Severity.ERROR
    category = RuleCategory.COMPLETENESS
    description = "Blocks submitting a progress claim whose gross this period and net due are both zero"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        data = context.data if isinstance(context.data, dict) else {}
        claim = data.get("claim")
        totals = data.get("totals")
        if not isinstance(claim, dict) or not isinstance(totals, dict):
            return []
        locale = _locale(context)
        gross = _dec(totals.get("gross_amount"))
        net_due = _dec(totals.get("net_due"))
        if gross > 0 or net_due > 0:
            return [
                RuleResult(
                    rule_id=self.rule_id,
                    rule_name=self.name,
                    severity=self.severity,
                    category=self.category,
                    passed=True,
                    message=translate("common.ok", locale=locale),
                )
            ]
        schedule = data.get("schedule") if isinstance(data.get("schedule"), dict) else {}
        suggestion_key = (
            "pay_application.amount_positive.suggestion"
            if schedule.get("has_lines")
            else "pay_application.amount_positive.suggestion_no_schedule"
        )
        currency = str(data.get("currency") or "")
        number = str(claim.get("number") or claim.get("id") or "")
        return [
            RuleResult(
                rule_id=self.rule_id,
                rule_name=self.name,
                severity=self.severity,
                category=self.category,
                passed=False,
                message=translate(
                    "pay_application.amount_positive.fail",
                    locale=locale,
                    claim=number,
                    amount=sentence_amount(max(gross, net_due), currency),
                ),
                element_ref=number,
                details={
                    "problem": "amount_not_positive",
                    "gross_amount": str(gross),
                    "net_due": str(net_due),
                    "has_lines": bool(totals.get("has_lines")),
                    "has_schedule": bool(schedule.get("has_lines")),
                },
                suggestion=translate(suggestion_key, locale=locale),
            )
        ]


CLAIM_RULES: tuple[type[ValidationRule], ...] = (ClaimAmountPositiveRule,)


def register_claim_rules() -> str:
    """Register this module's rules into the payment application set. Idempotent."""
    rule_set = pay_application_rule_set()
    for rule_cls in CLAIM_RULES:
        rule_registry.register(rule_cls(), [rule_set])
    logger.debug("payment_release: registered %d rules into %s", len(CLAIM_RULES), rule_set)
    return rule_set


__all__ = ["CLAIM_RULES", "ClaimAmountPositiveRule", "pay_application_rule_set", "register_claim_rules"]
