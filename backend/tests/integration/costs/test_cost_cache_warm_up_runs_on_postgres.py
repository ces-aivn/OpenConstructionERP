"""The cost database warm-up runs to the end on PostgreSQL.

The warm-up fills the region list and category tree caches behind the cost
database page and the "Add from database" dialog. It is a background process
the processes center reports; when it raises, the center shows it in error.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio


@pytest_asyncio.fixture(scope="module")
async def app_instance():
    from app.config import get_settings

    get_settings.cache_clear()
    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        from app.database import Base, async_session_factory, engine
        from app.modules.costs.models import CostItem

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_session_factory() as s:
            for i, (region, col) in enumerate(
                [("VI_HANOI", "Bê tông"), ("VI_HANOI", "Cốt thép"), ("USA_USD", "Concrete"), ("USA_USD", None)]
            ):
                s.add(
                    CostItem(
                        id=uuid.uuid4(),
                        code=f"WARM-{i}-{uuid.uuid4().hex[:6]}",
                        description=f"warm-up row {i}",
                        unit="m3",
                        rate="100",
                        currency="VND" if region.startswith("VI") else "USD",
                        region=region,
                        source="cwicr",
                        classification={"collection": col, "department": "D1"} if col else {},
                        is_active=True,
                    )
                )
            await s.commit()
        yield app


@pytest.mark.asyncio
async def test_the_warm_up_fills_the_region_and_tree_caches(app_instance) -> None:
    from app.core.processes import builtin
    from app.modules.costs.router import _category_tree_cache, _region_cache

    await builtin.prewarm_cost_caches()

    assert {"VI_HANOI", "USA_USD"} <= set(_region_cache["regions"])
    assert {"Bê tông", "Concrete"} <= set(_region_cache["categories_all"])
    assert any(k.startswith("tree::VI_HANOI::") for k in _category_tree_cache)
