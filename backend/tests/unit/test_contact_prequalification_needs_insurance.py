"""A contact's prequalification is not approved without insurance or a stated reason.

The subcontractor register already refuses that approval; the contacts module
let it through on create and on update. Both paths now apply the same rule:
valid insurance on the contact, or a reason recorded on its metadata.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.schemas import ContactCreate, ContactUpdate
from app.modules.contacts.service import (
    PREQUAL_NEEDS_INSURANCE_CODE,
    PREQUAL_OVERRIDE_METADATA_KEY,
    ContactService,
    contact_insurance_state,
)
from tests._pg import transactional_session

TODAY = date(2026, 10, 22)


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with transactional_session() as s:
        yield s


class TestInsuranceState:
    def test_no_entries_is_missing(self) -> None:
        assert contact_insurance_state([], as_at=TODAY) == "missing"
        assert contact_insurance_state(None, as_at=TODAY) == "missing"

    def test_a_policy_running_past_today_is_valid(self) -> None:
        cover = [{"policy_number": "P-1", "expiry_date": (TODAY + timedelta(days=30)).isoformat()}]
        assert contact_insurance_state(cover, as_at=TODAY) == "valid"

    def test_a_lapsed_policy_is_expired(self) -> None:
        cover = [{"policy_number": "P-1", "valid_until": "2026-01-31"}]
        assert contact_insurance_state(cover, as_at=TODAY) == "expired"

    def test_a_revoked_policy_is_not_cover(self) -> None:
        cover = [{"policy_number": "P-1", "status": "revoked"}]
        assert contact_insurance_state(cover, as_at=TODAY) == "expired"

    def test_a_policy_without_a_date_counts_as_cover_on_file(self) -> None:
        assert contact_insurance_state([{"insurer": "Bảo Việt"}], as_at=TODAY) == "valid"


class TestApprovalOnCreate:
    @pytest.mark.asyncio
    async def test_approval_without_insurance_is_refused_with_a_code(self, session: AsyncSession) -> None:
        with pytest.raises(HTTPException) as caught:
            await ContactService(session).create_contact(
                ContactCreate(contact_type="subcontractor", company_name="Thép Việt", prequalification_status="approved"),
                user_id=str(uuid.uuid4()),
            )
        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == PREQUAL_NEEDS_INSURANCE_CODE
        assert caught.value.detail["field"] == "prequal_override_reason"

    @pytest.mark.asyncio
    async def test_approval_with_a_reason_is_recorded(self, session: AsyncSession) -> None:
        user_id = str(uuid.uuid4())
        created = await ContactService(session).create_contact(
            ContactCreate(
                contact_type="subcontractor",
                company_name="Thép Việt",
                prequalification_status="approved",
                prequal_override_reason="Policy renewal in progress, certificate due Friday",
            ),
            user_id=user_id,
        )
        record = created.metadata_[PREQUAL_OVERRIDE_METADATA_KEY]
        assert record["reason"].startswith("Policy renewal")
        assert record["insurance_state"] == "missing"
        assert record["by"] == user_id

    @pytest.mark.asyncio
    async def test_approval_with_valid_insurance_needs_no_reason(self, session: AsyncSession) -> None:
        expiry = (date.today() + timedelta(days=90)).isoformat()
        created = await ContactService(session).create_contact(
            ContactCreate(
                contact_type="subcontractor",
                company_name="Thép Việt",
                prequalification_status="approved",
                insurance=[{"policy_number": "BV-01", "expiry_date": expiry}],
            ),
            user_id=str(uuid.uuid4()),
        )
        assert created.prequalification_status == "approved"
        assert PREQUAL_OVERRIDE_METADATA_KEY not in (created.metadata_ or {})


class TestApprovalOnUpdate:
    @pytest.mark.asyncio
    async def test_moving_to_approved_without_insurance_is_refused(self, session: AsyncSession) -> None:
        service = ContactService(session)
        user_id = str(uuid.uuid4())
        created = await service.create_contact(
            ContactCreate(contact_type="subcontractor", company_name="Điện Nam", prequalification_status="pending"),
            user_id=user_id,
        )
        with pytest.raises(HTTPException) as caught:
            await service.update_contact(created.id, ContactUpdate(prequalification_status="approved"), user_id=user_id)
        assert caught.value.detail["code"] == PREQUAL_NEEDS_INSURANCE_CODE

    @pytest.mark.asyncio
    async def test_insurance_sent_in_the_same_update_counts(self, session: AsyncSession) -> None:
        service = ContactService(session)
        user_id = str(uuid.uuid4())
        created = await service.create_contact(
            ContactCreate(contact_type="subcontractor", company_name="Điện Nam"),
            user_id=user_id,
        )
        expiry = (date.today() + timedelta(days=10)).isoformat()
        updated = await service.update_contact(
            created.id,
            ContactUpdate(prequalification_status="approved", insurance=[{"expiry_date": expiry}]),
            user_id=user_id,
        )
        assert updated.prequalification_status == "approved"

    @pytest.mark.asyncio
    async def test_override_reason_is_kept_with_the_other_metadata(self, session: AsyncSession) -> None:
        service = ContactService(session)
        user_id = str(uuid.uuid4())
        created = await service.create_contact(
            ContactCreate(contact_type="subcontractor", company_name="Điện Nam", metadata={"tags": ["mep"]}),
            user_id=user_id,
        )
        updated = await service.update_contact(
            created.id,
            ContactUpdate(prequalification_status="approved", prequal_override_reason="Owner-supplied insurance"),
            user_id=user_id,
        )
        assert updated.metadata_["tags"] == ["mep"]
        assert updated.metadata_[PREQUAL_OVERRIDE_METADATA_KEY]["reason"] == "Owner-supplied insurance"
