"""A fixed snag is neither open work nor overdue, and it can belong to a subcontractor.

The register counted a resolved item (fixed, waiting for a second pair of eyes)
as overdue once its due date passed, so the KPI strip read "Overdue 1" next to
an item the subcontractor had already put right. And an item assigned to
someone dropped out of the open count, because only ``open`` and
``in_progress`` were live. Pinned here, against PostgreSQL:

* overdue counts live work only: open, assigned and in progress;
* the pure overdue rule agrees, so the server and the screen read one rule;
* an item handed to a subcontractor from the subcontractor register shows the
  firm's name, not "Unknown".
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.projects.models import Project
from app.modules.punchlist.intl import is_overdue
from app.modules.punchlist.models import PunchItem
from app.modules.punchlist.service import PunchListService
from app.modules.subcontractors.models import Subcontractor
from app.modules.users.models import User
from tests._pg import transactional_session


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with transactional_session() as s:
        yield s


async def _project(session: AsyncSession) -> uuid.UUID:
    user = User(email=f"punchdue{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    session.add(user)
    await session.flush()
    project = Project(name="SoFi", owner_id=user.id, currency="USD")
    session.add(project)
    await session.flush()
    return project.id


def test_the_pure_rule_treats_a_resolved_item_as_met() -> None:
    due = "2026-06-01T00:00:00+00:00"
    ref = "2026-07-01T00:00:00+00:00"
    assert is_overdue(due, ref, status="resolved") is False
    assert is_overdue(due, ref, status="assigned") is True


async def test_only_live_items_count_as_overdue_or_open(session: AsyncSession) -> None:
    pid = await _project(session)
    past = datetime.now(UTC) - timedelta(days=10)
    for status in ("open", "assigned", "in_progress", "resolved", "verified", "closed"):
        session.add(PunchItem(project_id=pid, title=f"Snag {status}", status=status, due_date=past))
    await session.flush()

    summary = await PunchListService(session).get_summary(pid)

    assert summary["overdue"] == 3
    assert summary["by_status"]["resolved"] == 1


async def test_a_subcontractor_assignee_is_named(session: AsyncSession) -> None:
    sub = Subcontractor(legal_name="Schuff Steel Company", trade_name="Schuff Steel")
    session.add(sub)
    await session.flush()
    names = await PunchListService(session).resolve_party_names([str(sub.id), "Typed Name", None])
    assert names == {str(sub.id): "Schuff Steel"}
