"""A subcontractor is not prequalified as approved while it holds no valid insurance.

The register shows "No insurance" beside a firm and tells the reader an
expired certificate blocks the award; letting the same firm be marked
approved contradicted both. Every path that can approve - creating the firm,
editing it, and approving its prequalification application - now refuses
unless a valid insurance certificate is on file, or the person approving
states why it is approved anyway, and that reason is kept.
"""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.modules.subcontractors.schemas import (
    CertificateCreate,
    PrequalificationCreate,
    SubcontractorCreate,
    SubcontractorUpdate,
)
from app.modules.subcontractors.service import (
    PREQUAL_NEEDS_INSURANCE_CODE,
    PREQUAL_OVERRIDE_METADATA_KEY,
    insurance_cover_state,
)
from tests.unit.test_subcontractors import _make_service

TODAY = date(2026, 10, 22)


def _cert(cert_type: str, valid_until: date | None, *, revoked: bool = False) -> Any:
    return SimpleNamespace(cert_type=cert_type, valid_until=valid_until, revoked=revoked)


# ── The insurance state ─────────────────────────────────────────────────


def test_a_firm_with_nothing_on_file_has_no_insurance() -> None:
    assert insurance_cover_state(None, [], as_at=TODAY) == "missing"
    assert insurance_cover_state(SimpleNamespace(insurance_expiry_date=None), [], as_at=TODAY) == "missing"


def test_a_live_insurance_certificate_is_cover() -> None:
    certs = [_cert("insurance", TODAY + timedelta(days=10))]
    assert insurance_cover_state(SimpleNamespace(insurance_expiry_date=None), certs, as_at=TODAY) == "valid"


def test_a_certificate_valid_until_today_still_covers_today() -> None:
    assert insurance_cover_state(None, [_cert("insurance", TODAY)], as_at=TODAY) == "valid"


def test_a_lapsed_or_revoked_certificate_is_not_cover() -> None:
    assert insurance_cover_state(None, [_cert("insurance", TODAY - timedelta(days=1))], as_at=TODAY) == "expired"
    assert insurance_cover_state(None, [_cert("insurance", None, revoked=True)], as_at=TODAY) == "revoked"


def test_another_certificate_type_is_not_insurance() -> None:
    assert insurance_cover_state(None, [_cert("license", None)], as_at=TODAY) == "missing"


def test_the_vendor_row_date_answers_only_where_the_register_is_silent() -> None:
    future = SimpleNamespace(insurance_expiry_date=TODAY + timedelta(days=30))
    past = SimpleNamespace(insurance_expiry_date=TODAY - timedelta(days=1))
    assert insurance_cover_state(future, [], as_at=TODAY) == "valid"
    assert insurance_cover_state(past, [], as_at=TODAY) == "expired"
    # The register holds a lapsed policy, so a hopeful date on the row does not cover it.
    assert insurance_cover_state(future, [_cert("insurance", TODAY - timedelta(days=5))], as_at=TODAY) == "expired"


# ── Every path that can approve ─────────────────────────────────────────


@pytest.fixture
def svc() -> Any:
    service = _make_service()
    with (
        patch("app.modules.subcontractors.service.event_bus.publish_detached"),
        patch("app.core.audit_log.log_activity", AsyncMock()) as audit,
    ):
        service.audit = audit
        yield service


def _refusal(exc: pytest.ExceptionInfo[HTTPException], field: str) -> None:
    assert exc.value.status_code == 422
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == PREQUAL_NEEDS_INSURANCE_CODE
    assert detail["field"] == field
    assert detail["params"] == {"insurance_state": "missing"}


@pytest.mark.asyncio
async def test_a_firm_cannot_be_created_approved_without_a_reason(svc: Any) -> None:
    with pytest.raises(HTTPException) as exc:
        await svc.create_subcontractor(SubcontractorCreate(legal_name="Schuff Steel", prequalification_status="approved"))
    _refusal(exc, "prequal_override_reason")
    assert svc.subs.rows == {}


@pytest.mark.asyncio
async def test_a_firm_created_approved_with_a_reason_keeps_the_reason(svc: Any) -> None:
    sub = await svc.create_subcontractor(
        SubcontractorCreate(
            legal_name="Schuff Steel",
            prequalification_status="approved",
            prequal_override_reason="  Policy renewal in transit, broker letter on file  ",
        ),
        user_id="u1",
    )
    assert sub.prequalification_status == "approved"
    record = sub.metadata_[PREQUAL_OVERRIDE_METADATA_KEY]
    assert record["reason"] == "Policy renewal in transit, broker letter on file"
    assert record["insurance_state"] == "missing"
    assert record["by"] == "u1"
    svc.audit.assert_awaited_once()
    assert svc.audit.await_args.kwargs["reason"] == record["reason"]


@pytest.mark.asyncio
async def test_a_pending_firm_needs_no_insurance(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="FabriTec"))
    assert sub.prequalification_status == "pending"
    assert PREQUAL_OVERRIDE_METADATA_KEY not in (sub.metadata_ or {})
    svc.audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_editing_a_firm_to_approved_is_refused_without_insurance(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="Unicons"))
    with pytest.raises(HTTPException) as exc:
        await svc.update_subcontractor(sub.id, SubcontractorUpdate(prequalification_status="approved"))
    _refusal(exc, "prequal_override_reason")
    assert (await svc.subs.get_by_id(sub.id)).prequalification_status == "pending"


@pytest.mark.asyncio
async def test_a_blank_reason_is_no_reason(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="Unicons"))
    with pytest.raises(HTTPException):
        await svc.update_subcontractor(
            sub.id,
            SubcontractorUpdate(prequalification_status="approved", prequal_override_reason="   "),
        )


@pytest.mark.asyncio
async def test_editing_a_firm_to_approved_with_a_reason_records_it(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="Unicons"))
    updated = await svc.update_subcontractor(
        sub.id,
        SubcontractorUpdate(prequalification_status="approved", prequal_override_reason="Owner-controlled insurance"),
        user_id="u2",
    )
    assert updated.prequalification_status == "approved"
    assert updated.metadata_[PREQUAL_OVERRIDE_METADATA_KEY]["reason"] == "Owner-controlled insurance"
    assert svc.audit.await_args.kwargs["from_status"] == "pending"


@pytest.mark.asyncio
async def test_an_insured_firm_is_approved_without_a_reason(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="SolarBK"))
    await svc.record_certificate(
        CertificateCreate(subcontractor_id=sub.id, cert_type="insurance", valid_until=date.today() + timedelta(days=90)),
    )
    updated = await svc.update_subcontractor(sub.id, SubcontractorUpdate(prequalification_status="approved"))
    assert updated.prequalification_status == "approved"
    assert PREQUAL_OVERRIDE_METADATA_KEY not in (updated.metadata_ or {})
    svc.audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_expired_policy_does_not_let_a_firm_be_approved(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="SolarBK"))
    await svc.record_certificate(
        CertificateCreate(subcontractor_id=sub.id, cert_type="insurance", valid_until=date.today() - timedelta(days=1)),
    )
    with pytest.raises(HTTPException) as exc:
        await svc.update_subcontractor(sub.id, SubcontractorUpdate(prequalification_status="approved"))
    assert exc.value.detail["params"] == {"insurance_state": "expired"}


@pytest.mark.asyncio
async def test_other_edits_to_an_uninsured_approved_firm_still_save(svc: Any) -> None:
    sub = await svc.create_subcontractor(
        SubcontractorCreate(legal_name="Schuff Steel", prequalification_status="approved", prequal_override_reason="x"),
    )
    updated = await svc.update_subcontractor(sub.id, SubcontractorUpdate(notes="New site contact"))
    assert updated.notes == "New site contact"


@pytest.mark.asyncio
async def test_approving_the_application_is_refused_and_leaves_it_as_it_was(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="FabriTec"))
    prequal = await svc.create_prequalification(PrequalificationCreate(subcontractor_id=sub.id))
    await svc.submit_prequalification(prequal.id)
    with pytest.raises(HTTPException) as exc:
        await svc.approve_prequalification(prequal.id, reviewer_id="r1")
    _refusal(exc, "override_reason")
    assert (await svc.prequal.get_by_id(prequal.id)).status == "submitted"
    assert (await svc.subs.get_by_id(sub.id)).prequalification_status == "pending"


@pytest.mark.asyncio
async def test_approving_the_application_with_a_reason_records_it_on_the_firm(svc: Any) -> None:
    sub = await svc.create_subcontractor(SubcontractorCreate(legal_name="FabriTec"))
    prequal = await svc.create_prequalification(PrequalificationCreate(subcontractor_id=sub.id))
    await svc.submit_prequalification(prequal.id)
    approved = await svc.approve_prequalification(prequal.id, reviewer_id="r1", override_reason="Wrap-up policy (OCIP)")
    assert approved.status == "approved"
    firm = await svc.subs.get_by_id(sub.id)
    assert firm.prequalification_status == "approved"
    assert firm.metadata_[PREQUAL_OVERRIDE_METADATA_KEY]["by"] == "r1"
    override_calls = [
        c for c in svc.audit.await_args_list if c.kwargs.get("action") == "prequal_approved_without_insurance"
    ]
    assert len(override_calls) == 1
    assert override_calls[0].kwargs["reason"] == "Wrap-up policy (OCIP)"


@pytest.mark.asyncio
async def test_the_page_reads_every_firms_insurance_in_one_query(svc: Any) -> None:
    a = await svc.create_subcontractor(SubcontractorCreate(legal_name="A"))
    b = await svc.create_subcontractor(SubcontractorCreate(legal_name="B"))
    svc.certs.list_for_subcontractors = AsyncMock(
        return_value=[SimpleNamespace(subcontractor_id=a.id, cert_type="insurance", valid_until=None, revoked=False)],
    )
    states = await svc.insurance_states([a, b])
    assert states == {a.id: "valid", b.id: "missing"}
    svc.certs.list_for_subcontractors.assert_awaited_once()
    assert await svc.insurance_states([]) == {}
