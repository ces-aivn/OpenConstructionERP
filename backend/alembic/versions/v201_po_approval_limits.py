# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""procurement: per-project purchase-order approval ceilings

Additive column only:

* ``oe_procurement_project_settings.po_approval_limits`` JSON NULL - the
  project's override of the default approval ceilings, ``{role: {currency:
  amount}}``. NULL keeps the defaults in ``procurement.approval_policy``.

Inspector-guarded: on a real install the boot heal has already added the
column through ``create_all`` / the auto-migrator.

Revision ID: v201_po_approval_limits
Revises: v200_records_quality_party_columns
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "v201_po_approval_limits"
down_revision: str | Sequence[str] | None = "v200_records_quality_party_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "oe_procurement_project_settings"
_COLUMN = "po_approval_limits"


def _has_column(insp: sa.engine.reflection.Inspector) -> bool:
    return _TABLE in insp.get_table_names() and any(col["name"] == _COLUMN for col in insp.get_columns(_TABLE))


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _TABLE in insp.get_table_names() and not _has_column(insp):
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp):
        op.drop_column(_TABLE, _COLUMN)
