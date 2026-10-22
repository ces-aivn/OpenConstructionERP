"""A transmittal sent for approval must say by when the answer is due.

Without a response due date nobody can be chased for the approval it asks for.
The register's own routes refuse it with a coded error the screen translates;
another module building transmittals from its own plan keeps its contract.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.transmittals.logic import response_due_missing
from app.modules.transmittals.schemas import TransmittalCreate, TransmittalUpdate
from app.modules.transmittals.service import TransmittalService


def test_only_a_purpose_that_asks_for_an_answer_needs_a_due_date() -> None:
    assert response_due_missing("for_approval", None) is True
    assert response_due_missing("for_approval", "  ") is True
    assert response_due_missing("for_approval", "2018-03-01") is False
    assert response_due_missing("for_information", None) is False


def _service(row: object | None = None) -> TransmittalService:
    service = TransmittalService.__new__(TransmittalService)
    service.session = None  # type: ignore[assignment]

    class _Repo:
        async def get(self, _id: uuid.UUID) -> object | None:
            return row

    service.repo = _Repo()  # type: ignore[assignment]
    return service


@pytest.mark.asyncio
async def test_creating_one_for_approval_without_a_due_date_is_refused_with_a_code() -> None:
    data = TransmittalCreate(project_id=uuid.uuid4(), subject="ETFE shop drawings", purpose_code="for_approval")
    with pytest.raises(HTTPException) as exc_info:
        await _service().create_transmittal(data, require_response_due=True)
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "transmittal_response_due_required"
    assert exc_info.value.detail["field"] == "response_due_date"


@pytest.mark.asyncio
async def test_switching_a_draft_to_for_approval_needs_the_date_too() -> None:
    row = SimpleNamespace(
        id=uuid.uuid4(),
        is_locked=False,
        purpose_code="for_information",
        issued_date=None,
        response_due_date=None,
        metadata_={},
    )
    service = _service(row)
    with pytest.raises(HTTPException) as exc_info:
        await service.update_transmittal(
            row.id, TransmittalUpdate(purpose_code="for_approval"), require_response_due=True
        )
    assert exc_info.value.detail["code"] == "transmittal_response_due_required"


@pytest.mark.asyncio
async def test_issuing_one_for_approval_without_a_due_date_is_refused() -> None:
    row = SimpleNamespace(
        id=uuid.uuid4(),
        is_locked=False,
        purpose_code="for_approval",
        response_due_date=None,
        recipients=[object()],
        items=[object()],
    )
    with pytest.raises(HTTPException) as exc_info:
        await _service(row).issue_transmittal(row.id, require_response_due=True)
    assert exc_info.value.detail["code"] == "transmittal_response_due_required"
