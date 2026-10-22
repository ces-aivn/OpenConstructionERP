# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Inspections service - business logic for quality inspection management."""

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import publish_after_commit
from app.core.i18n import get_locale
from app.core.json_merge import merge_metadata
from app.modules.inspections.checklist_templates import TEMPLATE_META_KEY, checklist_from_template, get_template
from app.modules.inspections.models import QualityInspection
from app.modules.inspections.repository import InspectionRepository
from app.modules.inspections.schemas import (
    FAILED_RESPONSES,
    ChecklistItemResult,
    InspectionCreate,
    InspectionUpdate,
)

logger = logging.getLogger(__name__)


def _refuse(status_code: int, code: str, message: str, *, field: str | None = None, **params: Any) -> HTTPException:
    """A refusal the client can translate: a stable ``code`` plus an English fallback."""
    detail: dict[str, Any] = {"code": code, "message": message, "params": params}
    if field:
        detail["field"] = field
    return HTTPException(status_code=status_code, detail=detail)


def split_inspector(inspector_id: str | None, inspector_name: str | None) -> tuple[str | None, str | None]:
    """Separate the inspector reference from the inspector's name.

    ``inspector_id`` is a 36-character id column. Older clients typed the
    inspector's name straight into it, which failed as soon as the name was
    longer than an id ("J. Ramirez (Special Inspector, LADBS)"). A value that
    is not an id is therefore treated as the name, never stored as an id.

    Returns:
        ``(id, name)`` with the id canonicalised, or ``None`` for either part.
    """
    raw_id = (inspector_id or "").strip()
    name = (inspector_name or "").strip() or None
    if not raw_id:
        return None, name
    try:
        return str(uuid.UUID(raw_id)), name
    except ValueError:
        return None, name or raw_id


def item_failed(item: dict[str, Any]) -> bool:
    """Whether a checklist item carries an explicit failing verdict."""
    if "passed" in item:
        return item.get("passed") is False
    return str(item.get("response") or "").strip().lower() in FAILED_RESPONSES


def _ensure_item_ids(checklist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give every checklist item a stable id so its verdict can be addressed."""
    for item in checklist:
        if not item.get("id"):
            item["id"] = uuid.uuid4().hex[:12]
    return checklist


def apply_item_results(
    checklist: list[dict[str, Any]],
    item_results: list[ChecklistItemResult],
) -> list[dict[str, Any]]:
    """Write per-item verdicts into a copy of the checklist.

    Raises:
        HTTPException 422 (``inspection_checklist_item_unknown``) when a verdict
        names an item the checklist does not have.
    """
    merged = [dict(item) for item in checklist if isinstance(item, dict)]
    by_id = {str(item.get("id")): pos for pos, item in enumerate(merged) if item.get("id")}
    for verdict in item_results:
        pos = by_id.get(verdict.id) if verdict.id else None
        if pos is None and verdict.index is not None and verdict.index < len(merged):
            pos = verdict.index
        if pos is None:
            raise _refuse(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "inspection_checklist_item_unknown",
                "A recorded verdict refers to a checklist item this inspection does not have.",
                field="item_results",
            )
        item = merged[pos]
        item["response"] = verdict.result
        item["response_type"] = "pass_fail"
        item.pop("passed", None)
        if verdict.notes is not None:
            item["notes"] = verdict.notes
    return merged


def _validate_checklist_structure(checklist: list[dict[str, Any]]) -> None:
    """Validate checklist_data JSON structure.

    Each item must have at minimum a ``question`` field (non-empty string).
    ``response_type`` must be one of the known types if provided.

    Raises:
        HTTPException 422 if structure is invalid.
    """
    valid_response_types = {"yes_no", "pass_fail", "numeric", "text", "rating"}
    for idx, item in enumerate(checklist):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Checklist item {idx} must be a dict, got {type(item).__name__}",
            )
        question = item.get("question", "")
        if not question or not isinstance(question, str) or len(question.strip()) < 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Checklist item {idx} must have a non-empty 'question' field",
            )
        resp_type = item.get("response_type", "yes_no")
        if resp_type and resp_type not in valid_response_types:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Checklist item {idx} has invalid response_type '{resp_type}'. "
                    f"Valid types: {sorted(valid_response_types)}"
                ),
            )


# ── Allowed inspection status transitions ─────────────────────────────────────

_INSPECTION_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "scheduled": {"in_progress", "cancelled"},
    "in_progress": {"completed", "failed", "cancelled"},
    "completed": set(),  # terminal
    "failed": {"scheduled"},  # allow re-inspection
    "cancelled": {"scheduled"},  # allow rescheduling
}


class InspectionService:
    """Business logic for inspection operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = InspectionRepository(session)

    async def create_inspection(
        self,
        data: InspectionCreate,
        user_id: str | None = None,
    ) -> QualityInspection:
        """Create a new inspection with auto-generated number.

        Validates checklist_data structure before persisting.
        """
        metadata = dict(data.metadata or {})
        entries = [entry.model_dump() for entry in data.checklist_data]
        if data.checklist_template:
            template = get_template(data.checklist_template)
            if template is None:
                raise _refuse(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "inspection_template_unknown",
                    "There is no checklist template with this code.",
                    field="checklist_template",
                    template=data.checklist_template,
                )
            # A checklist sent with the template is the one the inspector
            # edited from it, and wins; with none, the template's items start it.
            if not entries:
                entries = checklist_from_template(template, get_locale())
            metadata[TEMPLATE_META_KEY] = template.code
        checklist = _ensure_item_ids(entries)
        if checklist:
            _validate_checklist_structure(checklist)
        inspector_id, inspector_name = split_inspector(data.inspector_id, data.inspector_name)

        inspection = QualityInspection(
            project_id=data.project_id,
            inspection_type=data.inspection_type,
            title=data.title,
            description=data.description,
            location=data.location,
            wbs_id=data.wbs_id,
            inspector_id=inspector_id,
            inspector_name=inspector_name,
            inspection_date=data.inspection_date,
            status=data.status,
            result=data.result,
            checklist_data=checklist,
            created_by=user_id,
            metadata_=metadata,
        )
        inspection = await self.repo.create(inspection)
        # The repository assigns inspection_number (with a collision retry) at
        # insert time, so read the committed value back for logging.
        inspection_number = inspection.inspection_number
        logger.info(
            "Inspection created: %s (%s) for project %s",
            inspection_number,
            data.inspection_type,
            data.project_id,
        )
        if inspection.status == "scheduled":
            self._announce_scheduled(inspection, user_id)
        return inspection

    def _announce_scheduled(self, inspection: QualityInspection, user_id: str | None) -> None:
        """Tell the inspector an inspection is booked for them, once it commits.

        ``core.event_handlers._notify_inspection_due`` turns this into a
        notification for ``inspector_id``. An inspection with no inspector has
        nobody to tell, and the handler skips an inspector who booked it.
        """
        if not inspection.inspector_id:
            return
        publish_after_commit(
            self.session,
            "inspection.scheduled",
            data={
                "project_id": str(inspection.project_id),
                "inspection_id": str(inspection.id),
                "inspection_number": inspection.inspection_number,
                "title": inspection.title,
                "inspector_id": str(inspection.inspector_id),
                "inspection_date": inspection.inspection_date,
                "scheduled_by": str(user_id) if user_id else None,
            },
            source_module="inspections",
        )

    async def get_inspection(self, inspection_id: uuid.UUID) -> QualityInspection:
        """Get inspection by ID. Raises 404 if not found."""
        inspection = await self.repo.get_by_id(inspection_id)
        if inspection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Inspection not found",
            )
        return inspection

    async def list_inspections(
        self,
        project_id: uuid.UUID,
        *,
        offset: int = 0,
        limit: int = 50,
        inspection_type: str | None = None,
        status_filter: str | None = None,
    ) -> tuple[list[QualityInspection], int]:
        """List inspections for a project."""
        return await self.repo.list_for_project(
            project_id,
            offset=offset,
            limit=limit,
            inspection_type=inspection_type,
            status=status_filter,
        )

    async def update_inspection(
        self,
        inspection_id: uuid.UUID,
        data: InspectionUpdate,
        user_id: str | None = None,
    ) -> QualityInspection:
        """Update inspection fields.

        Scheduling it again (``failed`` back to ``scheduled``), moving its date
        or handing it to another inspector tells the inspector, the same way
        creating a scheduled inspection does.
        """
        inspection = await self.get_inspection(inspection_id)
        before = (inspection.status, str(inspection.inspector_id or ""), inspection.inspection_date)

        # ``completed`` is terminal (see _INSPECTION_STATUS_TRANSITIONS) so it
        # stays locked. ``failed`` is NOT terminal: the FSM allows
        # failed → scheduled for re-inspection, so edits must be permitted and
        # the transition validator below enforces that only valid status
        # changes go through.
        if inspection.status == "completed":
            raise _refuse(
                status.HTTP_400_BAD_REQUEST,
                "inspection_completed_locked",
                f"Cannot edit an inspection with status '{inspection.status}'",
            )

        fields: dict[str, Any] = data.model_dump(exclude_unset=True)
        # Merge a partial metadata patch into the existing column instead of
        # replacing it wholesale, so a PATCH touching one key keeps the rest.
        if "metadata" in fields:
            incoming_meta = fields.pop("metadata")
            if isinstance(incoming_meta, dict):
                fields["metadata_"] = merge_metadata(getattr(inspection, "metadata_", None), incoming_meta)
            else:
                fields["metadata_"] = incoming_meta

        # Validate status transition if status is being changed
        new_status = fields.get("status")
        if new_status is not None and new_status != inspection.status:
            allowed = _INSPECTION_STATUS_TRANSITIONS.get(inspection.status, set())
            if new_status not in allowed:
                raise _refuse(
                    status.HTTP_400_BAD_REQUEST,
                    "inspection_transition_not_allowed",
                    (
                        f"Cannot transition inspection from '{inspection.status}' to "
                        f"'{new_status}'. Allowed transitions: "
                        f"{', '.join(sorted(allowed)) or 'none'}"
                    ),
                    field="status",
                    from_status=inspection.status,
                    to_status=new_status,
                )

        if "checklist_data" in fields and fields["checklist_data"] is not None:
            fields["checklist_data"] = _ensure_item_ids(
                [entry.model_dump() if hasattr(entry, "model_dump") else entry for entry in fields["checklist_data"]]
            )
            _validate_checklist_structure(fields["checklist_data"])

        if "inspector_id" in fields or "inspector_name" in fields:
            # Changing the reference without a name drops the old name, which
            # belonged to whoever was referenced before.
            name_in = fields.get("inspector_name") if "inspector_name" in fields else None
            if "inspector_id" not in fields:
                fields["inspector_id"] = inspection.inspector_id
            new_id, new_name = split_inspector(
                str(fields["inspector_id"]) if fields["inspector_id"] else None,
                name_in,
            )
            fields["inspector_id"] = new_id
            fields["inspector_name"] = new_name

        if not fields:
            return inspection

        await self.repo.update_fields(inspection_id, **fields)
        await self.session.refresh(inspection)
        logger.info("Inspection updated: %s (fields=%s)", inspection_id, list(fields.keys()))
        after = (inspection.status, str(inspection.inspector_id or ""), inspection.inspection_date)
        if inspection.status == "scheduled" and after != before:
            self._announce_scheduled(inspection, user_id)
        return inspection

    async def delete_inspection(self, inspection_id: uuid.UUID) -> None:
        """Delete an inspection that has not been completed.

        A completed inspection is the quality record: update_inspection locks
        it, a failed result has already raised punch items from it, and NCRs
        point at it by ``linked_inspection_id``. A scheduled one that will not
        happen is cancelled instead.
        """
        inspection = await self.get_inspection(inspection_id)
        if inspection.status == "completed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete a completed inspection: it is the quality record and is kept.",
            )
        await self.repo.delete(inspection_id)
        logger.info("Inspection deleted: %s", inspection_id)

    async def complete_inspection(
        self,
        inspection_id: uuid.UUID,
        result: str,
        item_results: list[ChecklistItemResult] | None = None,
    ) -> QualityInspection:
        """Mark an inspection as completed with a required result.

        Args:
            inspection_id: Inspection to complete.
            result: Must be one of ``pass``, ``fail``, or ``partial``.
            item_results: Per-item verdicts recorded with the result. When any
                checklist item ends up failed the overall result is ``fail``
                whatever was asked for: an inspection with a failed hold point
                cannot be signed off as passed or partially passed.

        Emits ``inspection.completed.failed`` event when result is ``fail``
        or ``partial`` to trigger punchlist item creation flow, and
        ``inspection.completed.passed`` on a pass.
        """
        if result not in ("pass", "fail", "partial"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Result must be 'pass', 'fail', or 'partial', got '{result}'",
            )

        inspection = await self.get_inspection(inspection_id)
        # FSM gate: ``complete`` is the scheduled → in_progress → completed
        # capstone transition. We accept it from ``in_progress`` (normal
        # path) and from ``scheduled`` (one-step shortcut for short
        # inspections - auto-walks through in_progress). Anything else
        # (completed / cancelled / failed) is a 400.
        if inspection.status == "completed":
            raise _refuse(
                status.HTTP_400_BAD_REQUEST,
                "inspection_already_completed",
                "Inspection is already completed",
            )
        if inspection.status == "cancelled":
            raise _refuse(
                status.HTTP_400_BAD_REQUEST,
                "inspection_cancelled_cannot_complete",
                "Cannot complete a cancelled inspection",
            )
        if inspection.status == "failed":
            raise _refuse(
                status.HTTP_400_BAD_REQUEST,
                "inspection_failed_reschedule_first",
                "Inspection is in 'failed' state - reschedule it first (failed → scheduled) before completing again.",
            )
        if inspection.status not in ("scheduled", "in_progress"):
            raise _refuse(
                status.HTTP_400_BAD_REQUEST,
                "inspection_cannot_complete_from_status",
                (
                    f"Cannot complete inspection from status "
                    f"'{inspection.status}'. Must be 'scheduled' or 'in_progress'."
                ),
                from_status=inspection.status,
            )

        checklist = list(inspection.checklist_data or [])
        fields: dict[str, Any] = {"status": "completed"}
        if item_results:
            checklist = apply_item_results(checklist, item_results)
            fields["checklist_data"] = checklist
        if any(isinstance(item, dict) and item_failed(item) for item in checklist):
            result = "fail"
        fields["result"] = result

        await self.repo.update_fields(inspection_id, **fields)
        await self.session.refresh(inspection)
        logger.info("Inspection completed: %s (result=%s)", inspection_id, result)

        # Emit event for failed/partial inspections -> punchlist creation flow
        if result in ("fail", "partial"):
            # Collect failed checklist items for the event payload
            checklist = inspection.checklist_data or []
            failed_items = [item for item in checklist if isinstance(item, dict) and item_failed(item)]
            # Deferred to the commit: the punchlist bridge inserts
            # PunchItem(project_id=...) from its own session.
            publish_after_commit(
                self.session,
                "inspection.completed.failed",
                data={
                    "project_id": str(inspection.project_id),
                    "inspection_id": str(inspection_id),
                    "inspection_number": inspection.inspection_number,
                    "result": result,
                    "failed_items": failed_items,
                },
                source_module="inspections",
            )
        else:
            # A pass is closure evidence too: closeout marks a built handover
            # package stale on it, the same as on a failure.
            publish_after_commit(
                self.session,
                "inspection.completed.passed",
                data={
                    "project_id": str(inspection.project_id),
                    "inspection_id": str(inspection_id),
                    "inspection_number": inspection.inspection_number,
                    "result": result,
                },
                source_module="inspections",
            )

        return inspection
