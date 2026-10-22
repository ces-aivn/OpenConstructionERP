"""Who may approve a purchase order, and up to what value.

Two controls sit in front of approval: the creator of an order cannot approve
it (four eyes), and an approver above their value ceiling in the order's
currency is refused. Both answer with a coded 403 so the screen can say it in
the reader's language. The pure rules are pinned first, then the two doors
into ``approved`` (the approve action and a PATCH of the status) against real
PostgreSQL.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.procurement.approval_policy import (
    DEFAULT_PO_APPROVAL_LIMITS,
    approval_limit,
    assert_not_self_approval,
    assert_within_approval_limit,
    effective_limits,
    validate_limit_overrides,
)
from app.modules.procurement.schemas import POCreate, POItemCreate, POUpdate
from app.modules.procurement.service import ProcurementService
from tests._pg import transactional_session

CREATOR = str(uuid.uuid4())
APPROVER = str(uuid.uuid4())


def _code(exc: pytest.ExceptionInfo[HTTPException]) -> str:
    detail = exc.value.detail
    assert isinstance(detail, dict), detail
    return str(detail["code"])


# ── Pure rules ──────────────────────────────────────────────────────────────


def test_defaults_cover_vnd_and_usd_for_managers() -> None:
    assert DEFAULT_PO_APPROVAL_LIMITS["manager"]["VND"] == Decimal("2500000000")
    assert DEFAULT_PO_APPROVAL_LIMITS["manager"]["USD"] == Decimal("100000")


def test_creator_is_refused_and_another_person_is_not() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_not_self_approval(creator_id=uuid.UUID(CREATOR), approver_id=CREATOR, po_number="PO-1")
    assert exc.value.status_code == 403
    assert _code(exc) == "po_self_approval"
    assert_not_self_approval(creator_id=CREATOR, approver_id=APPROVER, po_number="PO-1")
    # Nobody recorded as creator: nothing to compare against.
    assert_not_self_approval(creator_id=None, approver_id=APPROVER, po_number="PO-1")


def test_manager_within_limit_passes() -> None:
    assert_within_approval_limit(
        amount_total="99999.99",
        currency="USD",
        approver_role="manager",
        approver_permissions=[],
        overrides=None,
        po_number="PO-1",
    )


def test_manager_above_limit_is_refused_with_amount_and_limit() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_within_approval_limit(
            amount_total="82672665.35",
            currency="USD",
            approver_role="manager",
            approver_permissions=[],
            overrides=None,
            po_number="PO-001",
        )
    assert exc.value.status_code == 403
    assert _code(exc) == "po_approval_limit_exceeded"
    params = exc.value.detail["params"]  # type: ignore[index]
    assert params == {"po_number": "PO-001", "amount": "82672665.35", "limit": "100000.00", "currency": "USD"}


def test_vnd_limit_is_rounded_to_whole_dong() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_within_approval_limit(
            amount_total="2500000001",
            currency="vnd",
            approver_role="manager",
            approver_permissions=[],
            overrides=None,
            po_number="PO-2",
        )
    assert exc.value.detail["params"]["limit"] == "2500000000"  # type: ignore[index]


def test_admin_and_high_value_permission_are_not_capped() -> None:
    for role, perms in (("admin", []), ("manager", ["procurement.approve_high_value"])):
        assert_within_approval_limit(
            amount_total="999999999999",
            currency="USD",
            approver_role=role,
            approver_permissions=perms,
            overrides=None,
            po_number="PO-3",
        )


def test_currency_without_a_ceiling_is_refused_not_waved_through() -> None:
    with pytest.raises(HTTPException) as exc:
        assert_within_approval_limit(
            amount_total="1",
            currency="JPY",
            approver_role="manager",
            approver_permissions=[],
            overrides=None,
            po_number="PO-4",
        )
    assert _code(exc) == "po_approval_limit_missing"


def test_project_override_replaces_one_default_and_keeps_the_rest() -> None:
    overrides = {"manager": {"VND": "5000000000"}}
    assert approval_limit("manager", "VND", overrides) == Decimal("5000000000")
    assert approval_limit("manager", "USD", overrides) == Decimal("100000")
    # A custom role granted the approve permission stands in for the manager tier.
    assert approval_limit("site_lead", "USD", overrides) == Decimal("100000")
    assert effective_limits({"editor": {"USD": "5000"}})["editor"]["USD"] == Decimal("5000")


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"admin": {"USD": "1"}}, "po_approval_limit_role_invalid"),
        ({"manager": {"dollar": "1"}}, "po_approval_limit_currency_invalid"),
        ({"manager": {"USD": "-5"}}, "po_approval_limit_amount_invalid"),
        ({"manager": {"USD": "lots"}}, "po_approval_limit_amount_invalid"),
        ({"manager": {"USD": "1e30"}}, "po_approval_limit_amount_invalid"),
        ({"manager": {"VND": "1e40"}}, "po_approval_limit_amount_invalid"),
    ],
)
def test_bad_overrides_are_refused_with_a_code(overrides: dict, code: str) -> None:
    with pytest.raises(HTTPException) as exc:
        validate_limit_overrides(overrides)
    assert exc.value.status_code == 422
    assert _code(exc) == code


def test_overrides_are_normalised() -> None:
    assert validate_limit_overrides({"Manager": {"usd": "250000"}}) == {"manager": {"USD": "250000.00"}}


# ── Both doors into ``approved`` ────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _procurement_permissions() -> None:
    """The role checks read the live registry, which the app fills at module load."""
    from app.modules.procurement.permissions import register_procurement_permissions

    register_procurement_permissions()


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with transactional_session(disable_fks=True) as s:
        yield s


async def _draft_po(svc: ProcurementService, *, currency: str = "USD", amount: str = "1000"):
    return await svc.create_po(
        POCreate(
            project_id=uuid.uuid4(),
            vendor_contact_id=str(uuid.uuid4()),
            currency_code=currency,
            amount_subtotal=amount,
            tax_amount="0",
            status="draft",
            items=[
                POItemCreate(
                    description="Ready-mix concrete",
                    quantity="1",
                    unit="lot",
                    unit_rate=amount,
                    amount=amount,
                    cost_category="structure",
                ),
            ],
        ),
        user_id=CREATOR,
    )


@pytest.mark.asyncio
async def test_approve_action_refuses_the_creator(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await _draft_po(svc)
    with pytest.raises(HTTPException) as exc:
        await svc.approve_po(po.id, approver_id=CREATOR, approver_role="admin")
    assert _code(exc) == "po_self_approval"


@pytest.mark.asyncio
async def test_approve_action_refuses_a_manager_above_the_ceiling(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await _draft_po(svc, amount="250000")
    with pytest.raises(HTTPException) as exc:
        await svc.approve_po(po.id, approver_id=APPROVER, approver_role="manager", approver_permissions=[])
    assert _code(exc) == "po_approval_limit_exceeded"
    approved = await svc.approve_po(po.id, approver_id=APPROVER, approver_role="admin")
    assert approved.status == "approved"


@pytest.mark.asyncio
async def test_project_override_lets_a_manager_approve_more(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await _draft_po(svc, amount="250000")
    await svc.set_approval_limits(po.project_id, {"manager": {"USD": "300000"}}, user_id=APPROVER)
    limits = await svc.approval_limits(po.project_id)
    assert limits["effective"]["manager"]["USD"] == "300000.00"
    approved = await svc.approve_po(po.id, approver_id=APPROVER, approver_role="manager", approver_permissions=[])
    assert approved.status == "approved"


@pytest.mark.asyncio
async def test_patch_into_approved_holds_the_same_rules(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await _draft_po(svc)
    # An editor holds procurement.update but not procurement.approve.
    with pytest.raises(HTTPException) as exc:
        await svc.update_po(
            po.id, POUpdate(status="approved"), actor_id=APPROVER, actor_role="editor", actor_permissions=[]
        )
    assert _code(exc) == "po_approve_permission_required"
    # A refused PATCH is rolled back by the request; here each case takes a fresh order.
    po = await _draft_po(svc)
    with pytest.raises(HTTPException) as exc:
        await svc.update_po(
            po.id, POUpdate(status="approved"), actor_id=CREATOR, actor_role="manager", actor_permissions=[]
        )
    assert _code(exc) == "po_self_approval"
    po = await _draft_po(svc)
    updated = await svc.update_po(
        po.id, POUpdate(status="approved"), actor_id=APPROVER, actor_role="manager", actor_permissions=[]
    )
    assert updated.status == "approved"


@pytest.mark.asyncio
async def test_patch_cannot_clear_the_supplier(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await _draft_po(svc)
    with pytest.raises(HTTPException) as exc:
        await svc.update_po(po.id, POUpdate(vendor_contact_id=""))
    assert exc.value.status_code == 422
    assert _code(exc) == "po_vendor_required"


@pytest.mark.asyncio
async def test_validation_refusal_is_coded_and_lists_each_error(session: AsyncSession) -> None:
    svc = ProcurementService(session)
    po = await svc.create_po(
        POCreate(project_id=uuid.uuid4(), currency_code="USD", status="draft"),
        user_id=CREATOR,
    )
    with pytest.raises(HTTPException) as exc:
        await svc.approve_po(po.id, approver_id=APPROVER, approver_role="admin")
    assert exc.value.status_code == 422
    detail = exc.value.detail
    assert detail["code"] == "po_validation_failed"  # type: ignore[index]
    rule_ids = {e["rule_id"] for e in detail["errors"]}  # type: ignore[index]
    assert "procurement.po_vendor_assigned" in rule_ids
    assert detail["params"]["count"] == len(detail["errors"])  # type: ignore[index]
