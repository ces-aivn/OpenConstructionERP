"""The inspector-name backfill also runs where SQL has no regular expressions.

The migration moves a typed inspector name out of ``inspector_id``. PostgreSQL
matches the UUID shape with ``!~*``, which SQLite (the desktop build) does not
know, so there the rows are matched in Python with the same result.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa

_MIGRATION = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "v200_records_quality_party_columns.py"
_UUID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"


def _migration():
    spec = importlib.util.spec_from_file_location("v200_records_quality_party_columns", _MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_typed_name_moves_to_the_name_column_and_an_id_stays() -> None:
    migration = _migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE oe_inspections_inspection "
                "(id INTEGER PRIMARY KEY, inspector_id VARCHAR(36), inspector_name VARCHAR(255))"
            )
        )
        conn.execute(
            sa.text("INSERT INTO oe_inspections_inspection (id, inspector_id, inspector_name) VALUES (:i, :a, :n)"),
            [
                {"i": 1, "a": "Nguyễn Văn An", "n": None},
                {"i": 2, "a": _UUID.upper(), "n": None},
                {"i": 3, "a": "Trần Bình", "n": "Already named"},
                {"i": 4, "a": None, "n": None},
            ],
        )

        migration._backfill_inspector_name(conn)
        migration._backfill_inspector_name(conn)

        rows = conn.execute(
            sa.text("SELECT id, inspector_id, inspector_name FROM oe_inspections_inspection ORDER BY id")
        ).all()
    assert [tuple(r) for r in rows] == [
        (1, None, "Nguyễn Văn An"),
        (2, _UUID.upper(), None),
        (3, "Trần Bình", "Already named"),
        (4, None, None),
    ]
