"""The RFI register's "open" count always contains its "overdue" count.

A past-due draft used to read as "Open 0, Overdue 1" on the register. The
server rule is that an RFI is open while it is ``draft`` or ``open``, and is
overdue only while open and past its response due date, so overdue is a
subset of open and an answered or closed RFI is never overdue. The stats
endpoint and the per-row ``is_overdue`` flag must apply that one rule.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.rfi.models import RFI
from app.modules.rfi.router import _compute_rfi_fields
from app.modules.rfi.service import RFIService
from tests.modules.rfi.test_rfi_overdue_and_distribution import (  # noqa: F401
    _make_project,
    _make_user,
    db_session,
)


@pytest.mark.asyncio
async def test_a_past_due_draft_is_open_and_overdue_and_an_answered_one_is_neither(db_session) -> None:
    owner_id = await _make_user(db_session)
    project_id = await _make_project(db_session, owner_id)
    today = datetime.now(UTC)
    past_due = (today - timedelta(days=30)).strftime("%Y-%m-%d")

    rows: dict[str, RFI] = {}
    for subject, status in (("Draft past due", "draft"), ("Answered past due", "answered"), ("Closed past due", "closed")):
        rfi = RFI(
            project_id=project_id,
            rfi_number=f"RFI-{uuid.uuid4().hex[:4]}",
            subject=subject,
            question="?",
            status=status,
            response_due_date=past_due,
            raised_by=owner_id,
        )
        if status != "draft":
            rfi.official_response = "Answer."
            rfi.responded_at = today.isoformat()
        db_session.add(rfi)
        rows[status] = rfi
    await db_session.commit()

    stats = await RFIService(db_session).get_stats(project_id)
    assert stats.open == 1
    assert stats.overdue == 1
    assert stats.overdue <= stats.open

    assert _compute_rfi_fields(rows["draft"])[0] is True
    assert _compute_rfi_fields(rows["answered"])[0] is False
    assert _compute_rfi_fields(rows["closed"])[0] is False
