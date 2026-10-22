# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""records: named parties beside their ids, and a change order on a letter

Additive columns only:

* ``oe_correspondence_correspondence.from_name`` VARCHAR(255) NULL - the
  sender as people read it (a typed name or the picked contact's name). The
  36-character ``from_contact_id`` received display names from the form, so a
  longer one failed the insert and every create answered 500.
* ``oe_correspondence_correspondence.linked_change_order_id`` VARCHAR(36) NULL
  - the change order a delay or claim notice concerns.
* ``oe_inspections_inspection.inspector_name`` VARCHAR(255) NULL - an
  inspector who is neither a platform user nor a directory contact.
* ``oe_ncr_ncr.responsible_party_id`` VARCHAR(36) NULL (indexed),
  ``responsible_party_name`` VARCHAR(255) NULL and ``responsible_party_kind``
  VARCHAR(20) NULL - who must put a non-conformance right, a subcontractor
  included.

One backfill: an inspection whose ``inspector_id`` holds a typed name rather
than a UUID gets that name in ``inspector_name`` and an empty id, which is
the shape the application writes now. Only rows whose name is still empty are
touched, so a second run changes nothing.

Every DDL step is inspector-guarded: on a real install the boot heal has
already added the columns through ``create_all`` / the auto-migrator.

Revision ID: v200_records_quality_party_columns
Revises: v199_risk_simulation_runs
Create Date: 2026-10-22
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "v200_records_quality_party_columns"
down_revision: str | Sequence[str] | None = "v199_risk_simulation_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept in step with the module models; repeated as literals because a
# migration has to keep meaning what it meant on the day it ran.
_CORRESPONDENCE = "oe_correspondence_correspondence"
_INSPECTION = "oe_inspections_inspection"
_NCR = "oe_ncr_ncr"
_NCR_PARTY_INDEX = "ix_oe_ncr_ncr_responsible_party_id"

_COLUMNS: tuple[tuple[str, str, int], ...] = (
    (_CORRESPONDENCE, "from_name", 255),
    (_CORRESPONDENCE, "linked_change_order_id", 36),
    (_INSPECTION, "inspector_name", 255),
    (_NCR, "responsible_party_id", 36),
    (_NCR, "responsible_party_name", 255),
    (_NCR, "responsible_party_kind", 20),
)

_BACKFILL_INSPECTOR_NAME_SQL = f"""
UPDATE {_INSPECTION}
SET inspector_name = inspector_id,
    inspector_id = NULL
WHERE inspector_id IS NOT NULL
  AND inspector_name IS NULL
  AND inspector_id !~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
"""


_UUID_TEXT = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def _backfill_inspector_name(bind: sa.engine.Connection) -> None:
    """Move a typed inspector name out of ``inspector_id``.

    PostgreSQL matches the UUID shape in SQL. Other dialects (SQLite has no
    ``!~*``) read the candidate rows and match in Python, with the same result.
    """
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text(_BACKFILL_INSPECTOR_NAME_SQL))
        return
    rows = bind.execute(
        sa.text(f"SELECT id, inspector_id FROM {_INSPECTION} WHERE inspector_id IS NOT NULL AND inspector_name IS NULL")
    ).all()
    for row_id, inspector_id in rows:
        if _UUID_TEXT.match(str(inspector_id)):
            continue
        bind.execute(
            sa.text(
                f"UPDATE {_INSPECTION} SET inspector_name = inspector_id, inspector_id = NULL "
                "WHERE id = :id AND inspector_name IS NULL"
            ),
            {"id": row_id},
        )


def _has_table(insp: sa.engine.reflection.Inspector, table: str) -> bool:
    return table in insp.get_table_names()


def _has_column(insp: sa.engine.reflection.Inspector, table: str, column: str) -> bool:
    return _has_table(insp, table) and any(col["name"] == column for col in insp.get_columns(table))


# data-rewrite-ack: table=oe_inspections_inspection growth=tenure rows=one per inspection a project records, a few hundred to a few thousand on a busy site over its life; the statement touches only rows whose inspector id is a typed name, and each row change is two short strings
# boot-repair: gap - the product never runs `alembic upgrade`; the boot heal adds `inspector_name` empty, so a legacy inspection keeps its typed name in `inspector_id`. The read side already tolerates that: the API resolves an id through the people lookup and otherwise falls back to the stored text, and the inspections page shows `inspector_id` when no name is present, so the name is still displayed; the next edit of the inspector writes the new shape.
def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table, column, length in _COLUMNS:
        if _has_table(insp, table) and not _has_column(insp, table, column):
            op.add_column(table, sa.Column(column, sa.String(length=length), nullable=True))

    insp = sa.inspect(bind)
    if _has_column(insp, _NCR, "responsible_party_id") and _NCR_PARTY_INDEX not in {
        ix["name"] for ix in insp.get_indexes(_NCR)
    }:
        op.create_index(_NCR_PARTY_INDEX, _NCR, ["responsible_party_id"])

    if _has_column(insp, _INSPECTION, "inspector_name"):
        _backfill_inspector_name(bind)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    # Put typed inspector names that fit back where older code reads them.
    if _has_column(insp, _INSPECTION, "inspector_name"):
        bind.execute(
            sa.text(
                f"UPDATE {_INSPECTION} SET inspector_id = inspector_name "
                "WHERE inspector_id IS NULL AND inspector_name IS NOT NULL AND length(inspector_name) <= 36"
            )
        )
    if _has_table(insp, _NCR) and _NCR_PARTY_INDEX in {ix["name"] for ix in insp.get_indexes(_NCR)}:
        op.drop_index(_NCR_PARTY_INDEX, table_name=_NCR)
    for table, column, _length in reversed(_COLUMNS):
        if _has_column(insp, table, column):
            op.drop_column(table, column)
