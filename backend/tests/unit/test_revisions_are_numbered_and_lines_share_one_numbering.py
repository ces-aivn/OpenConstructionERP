"""Revisions are numbered after their original; every line gets one numbering.

A revision used to be made on one click as ``<name> (Copy)``, so the second
and third revisions of a bill could not be told apart and the reason for them
was lost. Rows pasted or bulk-added without a number were numbered ``001``,
``002`` at the top level of the bill, beside lines typed by hand as ``01.10``
or ``0010``, and a pasted block landed outside the section it was meant for.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.modules.boq.schemas import BOQCopyRequest
from app.modules.boq.service import BOQService, next_position_ordinals, ordinals_for_unnumbered
from tests._pg import transactional_session

OWNER_ID = uuid.uuid4()


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        from app.modules.users.models import User

        s.add(User(id=OWNER_ID, email=f"r-{uuid.uuid4().hex[:6]}@test.io", hashed_password="x", full_name="R"))
        await s.flush()
        await s.commit()
        yield s


async def _bill(session, name: str):
    from app.modules.boq.models import BOQ
    from app.modules.projects.models import Project

    project_id = uuid.uuid4()
    session.add(Project(id=project_id, name=name, owner_id=OWNER_ID, currency="USD"))
    await session.flush()
    boq = BOQ(id=uuid.uuid4(), project_id=project_id, name=name)
    session.add(boq)
    await session.commit()
    return boq.id


async def _revise(service: BOQService, boq_id: uuid.UUID, reason: str | None = None):
    """What the create-revision endpoint does with an unnamed request."""
    name, number, root = await service.next_revision(boq_id)
    lineage = {"revision_root_id": root, "revision_number": number}
    if reason:
        lineage["revision_reason"] = reason
    return await service.duplicate_boq(boq_id, name=name, extra_metadata=lineage)


@pytest.mark.asyncio
async def test_unnamed_revisions_count_up_from_the_original(session):
    service = BOQService(session)
    original = await _bill(session, "SoFi")

    v2 = await _revise(service, original, reason="Owner added a level")
    assert v2.name == "SoFi v2"
    assert v2.metadata_["revision_number"] == 2
    assert v2.metadata_["revision_root_id"] == str(original)
    assert v2.metadata_["revision_reason"] == "Owner added a level"

    # A revision of the revision is still counted against the original.
    v3 = await _revise(service, v2.id)
    assert v3.name == "SoFi v3"
    assert v3.metadata_["revision_number"] == 3
    assert "revision_reason" not in v3.metadata_


@pytest.mark.asyncio
async def test_a_plain_copy_is_not_a_revision(session):
    service = BOQService(session)
    original = await _bill(session, "Penn")
    v2 = await _revise(service, original, reason="re-priced")

    copy = await service.duplicate_boq(v2.id)
    assert copy.name == "Penn v2 (Copy)"
    for key in ("revision_root_id", "revision_number", "revision_reason"):
        assert key not in (copy.metadata_ or {})
    # ...so it does not take a version number from the line of revisions.
    name, number, _ = await service.next_revision(original)
    assert (name, number) == ("Penn v3", 3)


def test_blank_revision_name_falls_back_to_the_numbered_default():
    assert BOQCopyRequest(name="   ", reason="  ").name == ""
    assert not BOQCopyRequest(name="   ").name


def test_numbers_continue_in_the_gap_of_ten_scheme():
    assert next_position_ordinals([], None, 3) == ["0010", "0020", "0030"]
    assert next_position_ordinals(["01", "01.10", "01.20"], "01", 2) == ["01.30", "01.40"]
    assert next_position_ordinals(["01", "01.15"], "01", 1) == ["01.20"]
    assert next_position_ordinals(["0010", "0030"], None, 2) == ["0040", "0050"]


def test_unnumbered_rows_of_a_batch_are_numbered_under_their_section():
    section = uuid.uuid4()
    existing = [(section, "01"), (uuid.uuid4(), "01.10")]
    items = [
        {"description": "a", "parent_id": str(section)},
        {"description": "b", "ordinal": "01.20", "parent_id": str(section)},
        {"description": "c", "parent_id": str(section)},
        {"description": "d"},
    ]
    assert ordinals_for_unnumbered(items, existing) == {0: "01.30", 2: "01.40", 3: "0010"}
