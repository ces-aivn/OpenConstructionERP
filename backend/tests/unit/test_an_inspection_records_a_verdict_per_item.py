"""An inspection names its inspector properly and records a verdict per item.

The inspector field used to be a free-text box wired to ``inspector_id``, a
36-character id column, so a real name such as "J. Ramirez (Special
Inspector, LADBS)" came back as an English Pydantic error. And the result was
one overall word: a failed inspection still showed every checklist item with a
green tick because nothing recorded which item failed.

Pinned here:

* a name sent in the id slot is kept as the inspector's name, never as an id,
  and an id stays an id;
* every checklist item gets an id so its verdict can be addressed;
* verdicts recorded with the result are written onto the items, and any failed
  item makes the overall result ``fail`` whatever was asked for;
* a verdict for an item the checklist does not have is refused with a stable
  code the client translates.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.modules.inspections.schemas import ChecklistEntry, ChecklistItemResult, InspectionCreate, InspectionUpdate
from app.modules.inspections.service import apply_item_results, item_failed, split_inspector
from tests.unit.test_inspections import _make_service

LONG_NAME = "J. Ramirez (Special Inspector, LADBS)"


def test_a_long_typed_name_is_the_inspectors_name_not_an_id() -> None:
    assert len(LONG_NAME) > 36
    assert split_inspector(LONG_NAME, None) == (None, LONG_NAME)


def test_an_id_stays_an_id_and_keeps_the_picked_name() -> None:
    uid = uuid.uuid4()
    assert split_inspector(str(uid).upper(), "Jane Roe") == (str(uid), "Jane Roe")


def test_nothing_in_means_nothing_stored() -> None:
    assert split_inspector("  ", "  ") == (None, None)


async def _inspection(service, checklist: list[str]):
    return await service.create_inspection(
        InspectionCreate(
            project_id=uuid.uuid4(),
            inspection_type="structural",
            title="High-strength bolt connections, ETFE roof grid 12-18",
            inspector_id=LONG_NAME,
            checklist_data=[ChecklistEntry(question=q) for q in checklist],
        )
    )


async def test_create_moves_the_typed_name_out_of_the_id_column() -> None:
    service = _make_service()
    inspection = await _inspection(service, ["Bolts torqued"])
    assert inspection.inspector_id is None
    assert inspection.inspector_name == LONG_NAME


async def test_every_checklist_item_gets_an_addressable_id() -> None:
    service = _make_service()
    inspection = await _inspection(service, ["A", "B"])
    ids = [item["id"] for item in inspection.checklist_data]
    assert all(ids) and len(set(ids)) == 2


async def test_update_to_a_picked_user_replaces_the_typed_name() -> None:
    service = _make_service()
    inspection = await _inspection(service, [])
    uid = str(uuid.uuid4())
    updated = await service.update_inspection(inspection.id, InspectionUpdate(inspector_id=uid))
    assert updated.inspector_id == uid
    assert updated.inspector_name is None


async def test_a_failed_item_fails_the_inspection_even_when_pass_was_asked() -> None:
    service = _make_service()
    inspection = await _inspection(service, ["A490 bolts turn-of-nut", "CJP welds UT 100%", "Fireproofing thickness"])
    ids = [item["id"] for item in inspection.checklist_data]
    done = await service.complete_inspection(
        inspection.id,
        "pass",
        item_results=[
            ChecklistItemResult(id=ids[0], result="pass"),
            ChecklistItemResult(id=ids[1], result="fail", notes="Lack of fusion at G14"),
            ChecklistItemResult(index=2, result="na"),
        ],
    )
    assert done.result == "fail"
    assert [item["response"] for item in done.checklist_data] == ["pass", "fail", "na"]
    assert done.checklist_data[1]["notes"] == "Lack of fusion at G14"
    assert [item_failed(item) for item in done.checklist_data] == [False, True, False]


async def test_all_items_passed_keeps_the_requested_result() -> None:
    service = _make_service()
    inspection = await _inspection(service, ["A"])
    done = await service.complete_inspection(
        inspection.id, "pass", item_results=[ChecklistItemResult(index=0, result="pass")]
    )
    assert done.result == "pass"


def test_a_verdict_for_an_unknown_item_is_refused_with_a_code() -> None:
    with pytest.raises(HTTPException) as exc:
        apply_item_results([{"id": "a", "question": "Q"}], [ChecklistItemResult(id="zzz", result="fail")])
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "inspection_checklist_item_unknown"
