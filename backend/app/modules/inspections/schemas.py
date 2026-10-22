# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Inspections Pydantic schemas - request/response models."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChecklistEntry(BaseModel):
    """A single checklist item within an inspection."""

    id: str | None = None
    category: str | None = Field(default=None, max_length=100)
    question: str = Field(..., min_length=1, max_length=500)
    response_type: str = Field(default="yes_no", max_length=50)
    response: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    critical: bool = False


ITEM_VERDICTS: tuple[str, ...] = ("pass", "fail", "na")

# Responses that count as a failed checklist item, whichever response type the
# item uses. Shared by the result rule, the punch/NCR bridges and the export.
FAILED_RESPONSES: frozenset[str] = frozenset({"no", "fail", "false", "0", "failed"})


class ChecklistItemResult(BaseModel):
    """The verdict on one checklist item, recorded with the inspection result.

    The item is addressed by its ``id`` when it has one, else by its position
    in the checklist.
    """

    id: str | None = Field(default=None, max_length=64)
    index: int | None = Field(default=None, ge=0)
    result: str = Field(..., pattern=r"^(pass|fail|na)$")
    notes: str | None = Field(default=None, max_length=2000)


class InspectionCreate(BaseModel):
    """Create a new quality inspection."""

    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    inspection_type: str = Field(
        ...,
        pattern=(
            r"^(concrete_pour|waterproofing|mep|fire_stopping|handover|general"
            r"|structural|electrical|plumbing|fire_safety|concrete|finishes)$"
        ),
    )
    title: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=500)
    wbs_id: str | None = Field(default=None, max_length=36)
    # A user or contact id. A typed name sent here by an older client is moved
    # to ``inspector_name`` by the service instead of being refused, so the
    # length limit is the name's, not the id's.
    inspector_id: str | None = Field(default=None, max_length=255)
    inspector_name: str | None = Field(default=None, max_length=255)
    inspection_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: str = Field(
        default="scheduled",
        pattern=r"^(scheduled|in_progress|completed|failed|cancelled)$",
    )
    result: str | None = Field(default=None, pattern=r"^(pass|fail|partial)$")
    checklist_data: list[ChecklistEntry] = Field(default_factory=list)
    # A checklist template code (``checklist_templates.TEMPLATES``). With no
    # checklist sent, the inspection starts with the template's items in the
    # request's language; either way the code is recorded in the metadata.
    checklist_template: str | None = Field(default=None, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class InspectionUpdate(BaseModel):
    """Partial update for a quality inspection."""

    model_config = ConfigDict(str_strip_whitespace=True)

    inspection_type: str | None = Field(
        default=None,
        pattern=(
            r"^(concrete_pour|waterproofing|mep|fire_stopping|handover|general"
            r"|structural|electrical|plumbing|fire_safety|concrete|finishes)$"
        ),
    )
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=500)
    wbs_id: str | None = Field(default=None, max_length=36)
    # A user or contact id. A typed name sent here by an older client is moved
    # to ``inspector_name`` by the service instead of being refused, so the
    # length limit is the name's, not the id's.
    inspector_id: str | None = Field(default=None, max_length=255)
    inspector_name: str | None = Field(default=None, max_length=255)
    inspection_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: str | None = Field(
        default=None,
        pattern=r"^(scheduled|in_progress|completed|failed|cancelled)$",
    )
    result: str | None = Field(default=None, pattern=r"^(pass|fail|partial)$")
    checklist_data: list[ChecklistEntry] | None = None
    metadata: dict[str, Any] | None = None


class InspectionResponse(BaseModel):
    """Inspection returned from the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    inspection_number: str
    inspection_type: str
    title: str
    description: str | None = None
    location: str | None = None
    wbs_id: str | None = None
    inspector_id: str | None = None
    # Who the inspector is, in words: the referenced user or contact's current
    # name when the id resolves, else the name stored with the inspection. A
    # bare id is never the answer - a register that printed it raw put a UUID
    # in the inspector column. Absent only when there is nothing to show.
    inspector_name: str | None = None
    inspection_date: str | None = None
    status: str = "scheduled"
    result: str | None = None
    checklist_data: list[dict[str, Any]] = Field(default_factory=list)
    created_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime


class InspectionListResponse(BaseModel):
    """One page of inspections plus the size of the whole set.

    ``total`` is the row count matching the filters, not the length of
    ``items``. A quality register that shows a page and calls it the register
    hides exactly the inspections nobody has looked at yet.
    """

    items: list[InspectionResponse] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 50


class ChecklistTemplateItemResponse(BaseModel):
    """One item of a checklist template, worded in the request's language."""

    key: str
    # The message key the text is read from, so a client can word it itself.
    text_key: str
    text: str
    critical: bool = False


class ChecklistTemplateResponse(BaseModel):
    """A checklist template as offered for an inspection type."""

    code: str
    name_key: str
    name: str
    inspection_types: list[str] = Field(default_factory=list)
    # True for the template loaded when the requested type is picked.
    is_default: bool = False
    items: list[ChecklistTemplateItemResponse] = Field(default_factory=list)
