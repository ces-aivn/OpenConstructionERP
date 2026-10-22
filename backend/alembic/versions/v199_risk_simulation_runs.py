# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""risk - one stored row per Monte Carlo run.

One new table, nothing changed in an existing one:

* ``oe_risk_simulation_run``: a Monte Carlo run over a project's risk register
  (project, who ran it, iterations, mode, the seed that reproduces it and the
  full result as JSON). Rows cascade with their project. The risk tab reopens
  on the newest row instead of an empty state.

Purely additive, so an installed base gets the table from ``create_all`` on
boot as well. Every step is inspector-guarded, so a database whose table
``create_all`` already built reaches this revision and does nothing.

Revision ID: v199_risk_simulation_runs
Revises: v198_requisition_over_allocation_reason
Create Date: 2026-10-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.database import GUID

revision: str = "v199_risk_simulation_runs"
down_revision: str | Sequence[str] | None = "v198_requisition_over_allocation_reason"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "oe_risk_simulation_run"
_INDEX = "ix_risk_simulation_run_project_created"


def upgrade() -> None:
    """Create the run table and its project/created index, each only when missing."""
    bind = op.get_bind()
    if _TABLE not in sa.inspect(bind).get_table_names():
        op.create_table(
            _TABLE,
            sa.Column("id", GUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                "project_id",
                GUID(),
                sa.ForeignKey(
                    "oe_projects_project.id",
                    ondelete="CASCADE",
                    name="fk_oe_risk_simulation_run_project_id_oe_projects_project",
                ),
                nullable=False,
            ),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("iterations", sa.Integer(), nullable=False),
            sa.Column("mode", sa.String(length=10), nullable=False),
            sa.Column("seed", sa.BigInteger(), nullable=False),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_risk_simulation_run"),
        )
    if _INDEX not in {ix["name"] for ix in sa.inspect(bind).get_indexes(_TABLE)}:
        op.create_index(_INDEX, _TABLE, ["project_id", "created_at"])


def downgrade() -> None:
    """Drop the run table (its index goes with it)."""
    if _TABLE in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table(_TABLE)
