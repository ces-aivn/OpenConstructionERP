"""A line total is quantity x rate even when two cell edits of it overlap.

Typing a new line in the bill editor sends one PATCH per cell: the quantity,
then the rate a Tab later. When the first request is still in flight the
second one reads the line with the old quantity. Each request used to
multiply what it had read, so the line ended with quantity and rate stored
and a total of zero: the grid (which shows quantity x rate) read 127.5 bn,
the direct cost and the grand total left the line out, also after a reload.

The race is reproduced with two real PostgreSQL connections: the quantity
edit is written but not committed, the rate edit reads the stale row and
blocks on the row lock, then the quantity edit commits.

The boot repair for lines stored that way before the fix is covered too.
"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.boq.repairs import _run_stale_line_totals
from app.modules.boq.schemas import PositionUpdate
from app.modules.boq.service import BOQService
from tests._pg import isolated_engine


async def _seed(factory, *, locked: bool = False, rows: list[dict] | None = None):
    from app.modules.boq.models import BOQ, Position
    from app.modules.projects.models import Project
    from app.modules.users.models import User

    owner_id = uuid.uuid4()
    async with factory() as s:
        s.add(User(id=owner_id, email=f"o-{uuid.uuid4().hex[:6]}@test.io", hashed_password="x", full_name="O"))
        await s.flush()
        project_id = uuid.uuid4()
        s.add(Project(id=project_id, name="Landmark 81", owner_id=owner_id, currency="VND"))
        await s.flush()
        boq = BOQ(id=uuid.uuid4(), project_id=project_id, name="BOQ", is_locked=locked)
        s.add(boq)
        await s.flush()
        ids = []
        for i, row in enumerate(rows or [{"quantity": "0", "unit_rate": "0", "total": "0"}]):
            pos = Position(
                id=uuid.uuid4(),
                boq_id=boq.id,
                ordinal=f"{(i + 1) * 10:04d}",
                description=row.get("description", "Cọc barrette BTCT"),
                unit=row.get("unit", "m3"),
                quantity=row["quantity"],
                unit_rate=row["unit_rate"],
                total=row["total"],
                metadata_=row.get("metadata", {}),
                sort_order=i + 1,
            )
            s.add(pos)
            ids.append(pos.id)
        await s.commit()
    return owner_id, ids


async def _stored(factory, position_id):
    from app.modules.boq.models import Position

    async with factory() as s:
        row = (
            await s.execute(
                select(Position.quantity, Position.unit_rate, Position.total).where(Position.id == position_id)
            )
        ).one()
    return Decimal(row.quantity), Decimal(row.unit_rate), Decimal(row.total)


@pytest.mark.asyncio
async def test_rate_edit_that_read_a_stale_quantity_still_stores_quantity_times_rate():
    async with isolated_engine() as engine:
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        owner_id, (position_id,) = await _seed(factory)

        async with factory() as quantity_session, factory() as rate_session:
            await BOQService(quantity_session).update_position(
                position_id, PositionUpdate(quantity=15000), actor_id=owner_id
            )

            rate_edit = asyncio.create_task(
                BOQService(rate_session).update_position(
                    position_id, PositionUpdate(unit_rate=8500000), actor_id=owner_id
                )
            )
            # Let the rate edit read the uncommitted row and block on the lock.
            await asyncio.sleep(1.0)
            assert not rate_edit.done()
            await quantity_session.commit()

            updated = await asyncio.wait_for(rate_edit, timeout=30)
            await rate_session.commit()

        assert Decimal(str(updated.total)) == Decimal("127500000000")
        assert await _stored(factory, position_id) == (
            Decimal("15000"),
            Decimal("8500000"),
            Decimal("127500000000"),
        )


@pytest.mark.asyncio
async def test_sequential_cell_edits_of_a_new_line_store_its_total():
    async with isolated_engine() as engine:
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        owner_id, (position_id,) = await _seed(factory)
        for patch in (PositionUpdate(description="Tường vây"), PositionUpdate(unit="m3"),
                      PositionUpdate(quantity=22000), PositionUpdate(unit_rate=7500000)):
            async with factory() as s:
                await BOQService(s).update_position(position_id, patch, actor_id=owner_id)
                await s.commit()

        assert (await _stored(factory, position_id))[2] == Decimal("165000000000")


@pytest.mark.asyncio
async def test_boot_repair_re_multiplies_a_stale_total_and_leaves_headers_and_locked_bills():
    async with isolated_engine() as engine:
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        _, (stale, good, header) = await _seed(
            factory,
            rows=[
                {"quantity": "15000", "unit_rate": "8500000", "total": "0"},
                {"quantity": "22000", "unit_rate": "7500000", "total": "165000000000.0000"},
                # A change-order section header carries the sum of its lines.
                {"quantity": "0", "unit_rate": "0", "total": "500", "unit": "section"},
            ],
        )
        _, (locked_stale,) = await _seed(
            factory, locked=True, rows=[{"quantity": "2", "unit_rate": "3", "total": "0"}]
        )

        async with factory() as s:
            assert await _run_stale_line_totals(s) == 1
            await s.commit()
        async with factory() as s:
            assert await _run_stale_line_totals(s) == 0

        assert (await _stored(factory, stale))[2] == Decimal("127500000000")
        assert (await _stored(factory, good))[2] == Decimal("165000000000")
        assert (await _stored(factory, header))[2] == Decimal("500")
        assert (await _stored(factory, locked_stale))[2] == Decimal("0")


@pytest.mark.asyncio
async def test_boot_repair_leaves_change_order_lines_and_deliberate_totals_alone():
    async with isolated_engine() as engine:
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        change_order = {"origin": "change_order", "change_type": "modified"}
        _, (modified, unchanged_scope, mismatch) = await _seed(
            factory,
            rows=[
                # Modified from 100 x 100 to 120 x 100: the line carries the
                # cost delta of 2,000, not the gross 12,000.
                {"quantity": "120", "unit_rate": "100", "total": "2000", "metadata": change_order},
                # A modified item whose delta is zero is still a change-order line.
                {"quantity": "100", "unit_rate": "100", "total": "0", "metadata": change_order},
                # A total that differs without being zero is not the lost-edit symptom.
                {"quantity": "2", "unit_rate": "3", "total": "5"},
            ],
        )

        async with factory() as s:
            assert await _run_stale_line_totals(s) == 0
            await s.commit()

        assert (await _stored(factory, modified))[2] == Decimal("2000")
        assert (await _stored(factory, unchanged_scope))[2] == Decimal("0")
        assert (await _stored(factory, mismatch))[2] == Decimal("5")
