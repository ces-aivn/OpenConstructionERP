# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Boot-path data repairs owned by the BOQ module.

Imported by :func:`app.core.data_repairs.discover_data_repairs`, which is what
makes the registration below take effect. Nothing else imports this file, and
nothing needs to.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.core.data_repairs import DataRepair, register_data_repair

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: Proposal status -> the ``Position.source`` the copilot writes for it today.
_SOURCE_FOR_STATUS = {
    "auto_applied": "ai_copilot_auto",
    "applied": "ai_copilot_accepted",
}


def copilot_provenance(actions_in_order: list[Any]) -> tuple[str, float | None] | None:
    """Return the source and confidence of the last proposal written to a line.

    ``actions_in_order`` is every ``actions`` list of the line's copilot
    thread, oldest message first. Only proposals that were actually written
    count; a dismissed or failed one left the line as it was.
    """
    found: tuple[str, float | None] | None = None
    for actions in actions_in_order:
        if not isinstance(actions, list):
            continue
        for action in actions:
            if not isinstance(action, dict):
                continue
            source = _SOURCE_FOR_STATUS.get(str(action.get("status") or ""))
            if source is None:
                continue
            raw = action.get("confidence")
            try:
                confidence = float(raw) if raw is not None else None
            except (TypeError, ValueError):
                confidence = None
            if confidence is not None and not 0.0 <= confidence <= 1.0:
                confidence = None
            found = (source, confidence)
    return found


async def _run_copilot_provenance(session: AsyncSession) -> int:
    """Restore the copilot as the author of lines it wrote as "manual".

    Until 16.3.0 a copilot edit went through the ordinary position update and
    kept the default ``source="manual"``, so a line the model wrote read as
    typed by the estimator. The copilot thread of each line still holds every
    proposal with its status and confidence, which is what this reads.
    Imported inside the function so that importing this module costs only the
    registration.
    """
    from sqlalchemy import select, update

    from app.modules.boq.copilot_models import PositionCopilotMessage
    from app.modules.boq.models import Position

    rows = (
        await session.execute(
            select(PositionCopilotMessage.position_id, PositionCopilotMessage.actions)
            .join(Position, Position.id == PositionCopilotMessage.position_id)
            .where(Position.source == "manual", PositionCopilotMessage.actions.is_not(None))
            .order_by(PositionCopilotMessage.position_id, PositionCopilotMessage.created_at)
        )
    ).all()

    threads: dict[Any, list[Any]] = {}
    for position_id, actions in rows:
        threads.setdefault(position_id, []).append(actions)

    changed = 0
    for position_id, actions_in_order in threads.items():
        provenance = copilot_provenance(actions_in_order)
        if provenance is None:
            continue
        source, confidence = provenance
        values: dict[str, Any] = {"source": source}
        if confidence is not None:
            # The column is String(10); the model's figure can carry many
            # digits, and three say all a reviewer needs.
            values["confidence"] = str(round(confidence, 3))
        # The "manual" guard lets a concurrent write win and makes a second
        # pass find nothing to do.
        result = await session.execute(
            update(Position)
            .where(Position.id == position_id, Position.source == "manual")
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        changed += result.rowcount or 0

    if changed:
        logger.info("Marked %d BOQ line(s) written by the copilot before 16.3.0 as AI-written.", changed)
    return changed


#: Nature ``always_wrong``: ``source="manual"`` claims a person typed the
#: line, and for these lines the copilot's own thread records that the model
#: wrote it. That was never a true state, only the one the old write path
#: left. Lines without such a record are not touched: every other AI path in
#: the BOQ writes its own source value, the copilot was the one that wrote
#: under "manual", and its thread is deleted only together with the line, so
#: a line still standing with no thread was not written by it. No edit path
#: writes "manual" back onto an existing line (only new lines start with it),
#: so a marked line is not marked again after a person edits it. One limit, stated rather than hidden: a line a person
#: rewrote after the copilot also gets the AI mark, because nothing recorded
#: that later edit apart from an ordinary one. Idempotent: it rewrites only
#: rows still on "manual".
BOQ_COPILOT_PROVENANCE = register_data_repair(
    DataRepair(
        repair_id="boq_copilot_provenance",
        revision="",
        summary="Mark BOQ lines the copilot wrote before 16.3.0, which still read as typed by hand, as AI-written",
        run=_run_copilot_provenance,
        nature="always_wrong",
    )
)


async def _run_stale_line_totals(session: AsyncSession) -> int:
    """Re-multiply line totals left at zero beside a filled quantity and rate.

    Two cell edits of one line in flight together (the quantity, then the rate
    a Tab later) each multiplied the other's old value, so the line was stored
    with quantity and rate filled in and a total of zero. The grid showed
    quantity x rate, every sum of the bill left the line out, and it stayed
    that way across reloads until somebody edited the rate again.

    Only that symptom is repaired: a total of exactly zero with a non-zero
    quantity and a non-zero rate. A total that merely differs from quantity x
    rate is left alone, because some writers store a different figure on
    purpose: an approved change order writes its cost delta (a line modified
    from 100 x 100 to 120 x 100 carries 2,000, not 12,000), and its lines are
    skipped outright whatever their total. Lines in locked bills are skipped
    too, because a locked bill keeps its figures until somebody unlocks or
    revises it. Idempotent: a repaired line no longer has a zero total and is
    not selected again.
    """
    from decimal import Decimal, InvalidOperation

    from sqlalchemy import select, update

    from app.modules.boq.models import BOQ, Position
    from app.modules.boq.service import _compute_total

    rows = (
        await session.execute(
            select(Position.id, Position.quantity, Position.unit_rate, Position.total, Position.metadata_)
            .join(BOQ, BOQ.id == Position.boq_id)
            .where(BOQ.is_locked.is_(False))
        )
    ).all()

    changed = 0
    for position_id, quantity, unit_rate, total, metadata in rows:
        if isinstance(metadata, dict) and metadata.get("origin") == "change_order":
            continue
        try:
            q = Decimal(str(quantity if quantity not in (None, "") else "0"))
            r = Decimal(str(unit_rate if unit_rate not in (None, "") else "0"))
            stored = Decimal(str(total if total not in (None, "") else "0"))
        except (InvalidOperation, ValueError):
            continue
        if not (q.is_finite() and r.is_finite() and stored.is_finite()):
            continue
        if stored != 0 or q == 0 or r == 0:
            continue
        expected = _compute_total(q, r)
        if Decimal(expected) == 0:
            continue
        # The total guard lets a concurrent edit that already settled the
        # line win.
        result = await session.execute(
            update(Position)
            .where(Position.id == position_id, Position.total == total)
            .values(total=expected)
            .execution_options(synchronize_session=False)
        )
        changed += result.rowcount or 0

    if changed:
        logger.info("Re-multiplied %d BOQ line total(s) left at zero beside a quantity and a unit rate.", changed)
    return changed


#: Nature ``always_wrong``: a hand-entered line with a non-zero quantity and a
#: non-zero rate is never worth zero; that state is what a lost concurrent
#: edit left behind. Change-order lines, which store their cost delta rather
#: than quantity x rate, are never selected.
BOQ_STALE_LINE_TOTALS = register_data_repair(
    DataRepair(
        repair_id="boq_stale_line_totals",
        revision="",
        summary="Re-multiply BOQ line totals left at zero by two concurrent cell edits of the same line",
        run=_run_stale_line_totals,
        nature="always_wrong",
    )
)
