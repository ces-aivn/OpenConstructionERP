# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Who may approve a purchase order, and up to what value.

Approving a purchase order commits the project budget, so two internal
controls sit in front of it:

* **Four eyes.** The person who raised the order cannot approve it. An order
  whose creator is not recorded (older rows, system drafts) has nobody to
  compare against and is not refused on this ground.
* **Approval limits by value and role.** Each role that may approve carries a
  ceiling per currency. An order whose gross total is above the approver's
  ceiling needs somebody with a higher one: an administrator, or a holder of
  ``procurement.approve_high_value``. The ceilings are compared in the order's
  own currency; nothing is converted, because a limit that moves with an
  exchange rate is not a limit anybody signed off.

The defaults below apply to every project. A project may override them per
role and currency (``ProcurementProjectSettings.po_approval_limits``); only an
administrator may change that override, otherwise a manager could raise the
ceiling they are measured against.

A currency with no ceiling for the approver's role is refused rather than
waved through: an unconfigured limit is not an unlimited one. The refusal
names the currency so an administrator knows what to configure.

Every refusal is a coded ``HTTPException`` (``code``, ``message``, ``field``,
``params``) so the screen can say it in the reader's language; the English
sentence is the fallback for other API clients.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException, status

from app.core.currency_registry import money_quantum

#: The permission that lifts the value ceiling entirely.
HIGH_VALUE_PERMISSION = "procurement.approve_high_value"

#: Roles whose approvals are never capped by value. Administrators hold every
#: permission, including the high-value one, so this only spells that out.
UNLIMITED_ROLES: frozenset[str] = frozenset({"admin"})

#: Roles a project may configure a ceiling for. ``admin`` is unlimited and
#: ``viewer`` cannot approve at all, so neither is configurable.
CONFIGURABLE_ROLES: tuple[str, ...] = ("manager", "editor")

#: The role whose ceiling applies to an approver whose own role has none
#: configured (a tenant that granted ``procurement.approve`` to a custom
#: role). ``procurement.approve`` is pinned to MANAGER, so that is the tier
#: such an approver stands in for.
FALLBACK_ROLE = "manager"

#: Default ceilings, gross order value in the order's currency. VND and USD
#: are the markets the product ships for; EUR and GBP keep existing projects
#: in those currencies approvable without configuration. Roughly the same
#: purchasing power: 2.5 billion VND is about 100 000 USD.
DEFAULT_PO_APPROVAL_LIMITS: dict[str, dict[str, Decimal]] = {
    "manager": {
        "VND": Decimal("2500000000"),
        "USD": Decimal("100000"),
        "EUR": Decimal("100000"),
        "GBP": Decimal("100000"),
    },
}

_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def _decimal(raw: object) -> Decimal | None:
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite():
        return None
    return value


def validate_limit_overrides(raw: Mapping[str, Any] | None) -> dict[str, dict[str, str]]:
    """Normalise a project's override map, or raise a coded 422 naming the bad entry.

    Shape: ``{"manager": {"VND": "5000000000", "USD": "200000"}}``. Roles are
    limited to :data:`CONFIGURABLE_ROLES`, currencies to three upper-case
    letters, amounts to non-negative decimals. Stored as strings so the JSON
    column round-trips the exact figure.
    """
    out: dict[str, dict[str, str]] = {}
    for role_raw, per_currency in (raw or {}).items():
        role = str(role_raw).strip().lower()
        if role not in CONFIGURABLE_ROLES:
            raise _coded(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "po_approval_limit_role_invalid",
                f"Approval limits can be set for {', '.join(CONFIGURABLE_ROLES)}, not '{role_raw}'.",
                field="po_approval_limits",
                params={"role": str(role_raw)},
            )
        if not isinstance(per_currency, Mapping):
            raise _coded(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "po_approval_limit_amount_invalid",
                f"The approval limits for '{role}' must map currency codes to amounts.",
                field="po_approval_limits",
                params={"role": role, "currency": ""},
            )
        cleaned: dict[str, str] = {}
        for currency_raw, amount_raw in per_currency.items():
            currency = str(currency_raw).strip().upper()
            if not _CURRENCY_RE.match(currency):
                raise _coded(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "po_approval_limit_currency_invalid",
                    f"'{currency_raw}' is not an ISO 4217 currency code.",
                    field="po_approval_limits",
                    params={"role": role, "currency": str(currency_raw)},
                )
            amount = _decimal(amount_raw)
            rounded: Decimal | None = None
            if amount is not None and amount >= 0:
                try:
                    rounded = amount.quantize(money_quantum(currency))
                except InvalidOperation:
                    # More digits than a Decimal carries once rounded to the
                    # currency (1e30 and up): not an amount anyone can approve.
                    rounded = None
            if rounded is None:
                raise _coded(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "po_approval_limit_amount_invalid",
                    f"The approval limit for {role} in {currency} must be a non-negative amount.",
                    field="po_approval_limits",
                    params={"role": role, "currency": currency},
                )
            cleaned[currency] = str(rounded)
        out[role] = cleaned
    return out


def effective_limits(overrides: Mapping[str, Any] | None) -> dict[str, dict[str, Decimal]]:
    """The defaults with a project's overrides laid over them, per role and currency.

    An override replaces the default for its role and currency only; every
    other default stays. Malformed stored entries are skipped rather than
    trusted (the write path validates, so this only guards hand-edited rows).
    """
    merged: dict[str, dict[str, Decimal]] = {role: dict(limits) for role, limits in DEFAULT_PO_APPROVAL_LIMITS.items()}
    for role_raw, per_currency in (overrides or {}).items():
        role = str(role_raw).strip().lower()
        if role not in CONFIGURABLE_ROLES or not isinstance(per_currency, Mapping):
            continue
        for currency_raw, amount_raw in per_currency.items():
            currency = str(currency_raw).strip().upper()
            amount = _decimal(amount_raw)
            if not _CURRENCY_RE.match(currency) or amount is None or amount < 0:
                continue
            merged.setdefault(role, {})[currency] = amount
    return merged


def limits_as_strings(limits: Mapping[str, Mapping[str, Decimal]]) -> dict[str, dict[str, str]]:
    """JSON-friendly copy of a limit table, each amount rounded for its currency."""
    return {
        role: {cur: str(amount.quantize(money_quantum(cur))) for cur, amount in sorted(per.items())}
        for role, per in sorted(limits.items())
    }


def has_high_value_authority(role: str | None, permissions: Iterable[str] | None) -> bool:
    """True for an approver whose approvals are not capped by value."""
    normalised = (role or "").strip().lower()
    if normalised in UNLIMITED_ROLES:
        return True
    if HIGH_VALUE_PERMISSION in set(permissions or ()):
        return True
    from app.core.permissions import permission_registry

    return bool(normalised) and permission_registry.role_has_permission(normalised, HIGH_VALUE_PERMISSION)


def approval_limit(
    role: str | None,
    currency: str,
    overrides: Mapping[str, Any] | None,
) -> Decimal | None:
    """The ceiling for ``role`` in ``currency``; None when none is configured."""
    table = effective_limits(overrides)
    normalised = (role or "").strip().lower()
    per_currency = table.get(normalised) or table.get(FALLBACK_ROLE) or {}
    return per_currency.get(currency.strip().upper())


def assert_not_self_approval(*, creator_id: object, approver_id: object, po_number: str) -> None:
    """Refuse an approval by the person who raised the order (403, ``po_self_approval``)."""
    if creator_id is None or approver_id is None:
        return
    if str(creator_id).strip().lower() != str(approver_id).strip().lower():
        return
    raise _coded(
        status.HTTP_403_FORBIDDEN,
        "po_self_approval",
        (
            f"You raised purchase order {po_number}, so you cannot approve it yourself "
            "(four-eyes principle). Ask another approver."
        ),
        field="created_by",
        params={"po_number": po_number},
    )


def assert_within_approval_limit(
    *,
    amount_total: object,
    currency: str | None,
    approver_role: str | None,
    approver_permissions: Iterable[str] | None,
    overrides: Mapping[str, Any] | None,
    po_number: str,
) -> None:
    """Refuse an approval above the approver's ceiling (403, coded).

    ``po_approval_limit_exceeded`` when the order is above the ceiling,
    ``po_approval_limit_missing`` when the approver's role has no ceiling in
    the order's currency.
    """
    if has_high_value_authority(approver_role, approver_permissions):
        return
    code = (currency or "").strip().upper()
    amount = _decimal(amount_total) or Decimal("0")
    limit = approval_limit(approver_role, code, overrides)
    if limit is None:
        raise _coded(
            status.HTTP_403_FORBIDDEN,
            "po_approval_limit_missing",
            (
                f"No approval limit is configured for your role in {code or 'this currency'}, so purchase "
                f"order {po_number} needs an administrator's approval or a configured limit."
            ),
            field="currency_code",
            params={"currency": code, "po_number": po_number},
        )
    if amount > limit:
        quantum = money_quantum(code) if code else Decimal("0.01")
        raise _coded(
            status.HTTP_403_FORBIDDEN,
            "po_approval_limit_exceeded",
            (
                f"Purchase order {po_number} totals {amount.quantize(quantum)} {code}, above your approval "
                f"limit of {limit.quantize(quantum)} {code}. An approver with a higher limit must approve it."
            ),
            field="amount_total",
            params={
                "po_number": po_number,
                "amount": str(amount.quantize(quantum)),
                "limit": str(limit.quantize(quantum)),
                "currency": code,
            },
        )


def _coded(
    status_code: int,
    code: str,
    message: str,
    *,
    field: str,
    params: dict[str, Any],
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "field": field, "params": params},
    )
