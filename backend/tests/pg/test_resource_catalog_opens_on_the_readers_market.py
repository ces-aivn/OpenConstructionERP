# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The resource catalogue opens on the reader's market, not on Europe.

The catalogue used to hold one set of thirty-three European resources priced
in euro and open on it for everyone. It now carries a Vietnamese set in VND
and an American set in USD, and ``/catalog/regions/preferred/`` names the one
for the reader: the project's currency first, the interface language second.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.modules.catalog import router as catalog_router
from app.modules.catalog.models import CatalogResource
from app.modules.catalog.seed import MARKET_SETS, seed_catalog

pytestmark = pytest.mark.asyncio


async def _preferred(session, monkeypatch, language: str) -> dict[str, str]:
    monkeypatch.setattr(catalog_router, "get_locale", lambda: language)
    return await catalog_router.preferred_catalog_region(session=session, user_id=str(uuid.uuid4()), project_id=None)


async def test_the_market_sets_are_priced_in_their_own_currency(pg_session) -> None:
    await seed_catalog(pg_session, [uuid.uuid4()])
    for region, currency, rows in MARKET_SETS:
        found = (
            await pg_session.execute(
                select(CatalogResource.currency, func.count())
                .where(CatalogResource.region == region)
                .group_by(CatalogResource.currency)
            )
        ).all()
        assert found == [(currency, len(rows))], (region, found)


async def test_a_second_run_adds_no_second_market_set(pg_session) -> None:
    await seed_catalog(pg_session, [uuid.uuid4()])
    again = await seed_catalog(pg_session, [uuid.uuid4()])
    assert again == {}
    vn = (
        await pg_session.execute(
            select(func.count()).select_from(CatalogResource).where(CatalogResource.region == "VN")
        )
    ).scalar_one()
    assert vn == len(MARKET_SETS[0][2])


async def test_a_vietnamese_reader_opens_on_vn_and_an_english_one_on_us(pg_session, monkeypatch) -> None:
    await seed_catalog(pg_session, [uuid.uuid4()])
    assert await _preferred(pg_session, monkeypatch, "vi") == {"region": "VN", "currency": "VND", "source": "language"}
    assert await _preferred(pg_session, monkeypatch, "en") == {"region": "US", "currency": "USD", "source": "language"}


async def test_no_answer_when_nothing_in_the_market_currency_is_loaded(pg_session, monkeypatch) -> None:
    pg_session.add(
        CatalogResource(
            resource_code=f"X-{uuid.uuid4().hex[:6]}",
            name="Tower crane",
            resource_type="equipment",
            category="Cranes",
            unit="day",
            base_price="100",
            min_price="90",
            max_price="110",
            currency="EUR",
            region="EU",
            source="manual",
        )
    )
    await pg_session.flush()
    assert await _preferred(pg_session, monkeypatch, "vi") == {"region": "", "currency": "VND", "source": "none"}
