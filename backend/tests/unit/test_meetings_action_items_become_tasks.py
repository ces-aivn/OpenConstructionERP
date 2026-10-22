"""A meeting's tracked action items appear on the task board.

An action recorded in a meeting used to reach the Tasks module only when the
meeting was formally completed, so the owner of an action from a meeting that
stayed "scheduled" never saw it as a task. Every saved action now has a task,
kept in step with the action and never duplicated by a later save.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.meetings.models import Meeting
from app.modules.meetings.schemas import ActionRegisterItemCreate, ActionRegisterItemUpdate
from app.modules.meetings.service import MeetingService
from app.modules.projects.models import Project
from app.modules.tasks.models import Task
from app.modules.users.models import User
from tests._pg import transactional_session


@pytest_asyncio.fixture
async def session() -> AsyncIterator:
    async with transactional_session() as s:
        yield s


async def _meeting(session) -> tuple[Meeting, uuid.UUID]:
    user = User(email=f"u{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    session.add(user)
    await session.flush()
    project = Project(name="SoFi Stadium", owner_id=user.id)
    session.add(project)
    await session.flush()
    meeting = Meeting(
        project_id=project.id,
        meeting_number="MTG-001",
        meeting_type="progress",
        title="OAC #112",
        meeting_date="2018-03-14",
        status="scheduled",
        attendees=[],
        agenda_items=[],
        action_items=[],
        document_ids=[],
        metadata_={},
    )
    session.add(meeting)
    await session.flush()
    return meeting, user.id


async def _tasks(session, meeting: Meeting) -> list[Task]:
    rows = await session.execute(select(Task).where(Task.meeting_id == str(meeting.id)))
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_an_action_on_a_scheduled_meeting_is_a_task_with_its_owner_and_date(session) -> None:
    meeting, user_id = await _meeting(session)
    service = MeetingService(session)
    action = await service.add_action(
        meeting,
        ActionRegisterItemCreate(
            description="Schuff Steel to fix NCR-001 and call for re-inspection",
            owner_id=str(user_id),
            owner_name="Schuff Steel",
            due_date="2018-03-21",
        ),
        user_id=str(user_id),
    )
    (task,) = await _tasks(session, meeting)
    assert action["task_id"] == str(task.id)
    assert task.title.startswith("Schuff Steel to fix NCR-001")
    assert str(task.responsible_id) == str(user_id)
    assert task.due_date == "2018-03-21"
    assert task.status == "open"
    assert task.metadata_["source"] == "meeting_action_item"
    assert task.metadata_["meeting_number"] == "MTG-001"
    assert task.metadata_["assignee_name"] == "Schuff Steel"


@pytest.mark.asyncio
async def test_saving_the_action_again_updates_the_same_task(session) -> None:
    meeting, user_id = await _meeting(session)
    service = MeetingService(session)
    action = await service.add_action(
        meeting,
        ActionRegisterItemCreate(description="Submit ETFE samples", owner_name="FabriTec", due_date="2018-04-01"),
    )
    row = await service.get_action(uuid.UUID(action["id"]))
    await service.update_action(row, ActionRegisterItemUpdate(due_date="2018-04-15"))
    await service.update_action(row, ActionRegisterItemUpdate(status="done"))

    (task,) = await _tasks(session, meeting)
    assert task.due_date == "2018-04-15"
    assert task.status == "completed"
    # A typed name is not a user id, so the task is not assigned to a user.
    assert task.responsible_id is None


@pytest.mark.asyncio
async def test_deleting_the_action_removes_the_task_it_created(session) -> None:
    meeting, _ = await _meeting(session)
    service = MeetingService(session)
    action = await service.add_action(
        meeting,
        ActionRegisterItemCreate(description="Issue revised RFI log", owner_name="Turner", due_date="2018-03-30"),
    )
    row = await service.get_action(uuid.UUID(action["id"]))
    await service.delete_action(row)
    assert await _tasks(session, meeting) == []
