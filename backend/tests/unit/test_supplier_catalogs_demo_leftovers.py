"""Demo suppliers do not outlive the demo.

The demo seed writes five German sample vendors and a numbered catalogue into
company-wide registers. Once no demo project is installed they are removed at
boot, except a vendor somebody has started to use.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.supplier_catalogs.demo_leftovers import remove_demo_supplier_catalogue
from app.modules.supplier_catalogs.models import CatalogItem, ItemCategory, PurchaseOrder, Vendor
from app.modules.supplier_catalogs.seed import seed_supplier_catalogs
from tests._pg import transactional_session


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with transactional_session(disable_fks=True) as s:
        yield s


async def _count(session: AsyncSession, stmt) -> int:  # noqa: ANN001
    return int((await session.execute(stmt)).scalar_one())


@pytest.mark.asyncio
async def test_leftover_demo_catalogue_is_removed_when_no_demo_project_exists(session: AsyncSession) -> None:
    # The project the seed is handed no longer exists: the demo was purged.
    await seed_supplier_catalogs(session, uuid.uuid4())
    assert await _count(session, select(func.count()).select_from(Vendor).where(Vendor.code == "V001")) == 1

    removed = await remove_demo_supplier_catalogue(session)

    assert removed > 0
    assert await _count(session, select(func.count()).select_from(Vendor).where(Vendor.code.like("V00_"))) == 0
    assert await _count(session, select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.number.like("PO-S%"))) == 0
    assert await _count(session, select(func.count()).select_from(CatalogItem).where(CatalogItem.sku.like("SKU-0%"))) == 0
    # Idempotent: nothing left to do on the next boot.
    assert await remove_demo_supplier_catalogue(session) == 0


@pytest.mark.asyncio
async def test_a_demo_vendor_somebody_linked_is_kept(session: AsyncSession) -> None:
    await seed_supplier_catalogs(session, uuid.uuid4())
    used = (await session.execute(select(Vendor).where(Vendor.code == "V003"))).scalar_one()
    used.contact_id = str(uuid.uuid4())
    await session.flush()

    await remove_demo_supplier_catalogue(session)

    remaining = set((await session.execute(select(Vendor.code).where(Vendor.code.like("V00_")))).scalars().all())
    assert remaining == {"V003"}


@pytest.mark.asyncio
async def test_nothing_is_removed_while_a_demo_project_is_installed(session: AsyncSession, monkeypatch) -> None:  # noqa: ANN001
    async def _one_live_demo(_session, candidate_ids=None):  # noqa: ANN001, ARG001
        return [(uuid.uuid4(), "residential-berlin")]

    monkeypatch.setattr("app.modules.supplier_catalogs.demo_leftovers.live_demo_projects", _one_live_demo)
    await seed_supplier_catalogs(session, uuid.uuid4())

    assert await remove_demo_supplier_catalogue(session) == 0
    assert await _count(session, select(func.count()).select_from(Vendor).where(Vendor.code.like("V00_"))) == 5


@pytest.mark.asyncio
async def test_a_real_vendor_with_a_demo_like_code_is_not_touched(session: AsyncSession) -> None:
    session.add(Vendor(code="V001", name="Thep Hoa Phat", currency="VND", country_code="VN"))
    await session.flush()

    assert await remove_demo_supplier_catalogue(session) == 0
    assert await _count(session, select(func.count()).select_from(Vendor).where(Vendor.code == "V001")) == 1


@pytest.mark.asyncio
async def test_a_company_category_with_a_demo_code_is_not_touched(session: AsyncSession) -> None:
    session.add(ItemCategory(code="MATERIALS", name="Vật liệu xây dựng", level=0))
    await session.flush()

    await remove_demo_supplier_catalogue(session)

    names = (await session.execute(select(ItemCategory.name).where(ItemCategory.code == "MATERIALS"))).scalars().all()
    assert names == ["Vật liệu xây dựng"]


@pytest.mark.asyncio
async def test_a_demo_vendor_on_a_bidder_list_is_kept(session: AsyncSession) -> None:
    from app.modules.procurement_concept.models import BidderCandidate

    await seed_supplier_catalogs(session, uuid.uuid4())
    used = (await session.execute(select(Vendor).where(Vendor.code == "V002"))).scalar_one()
    session.add(BidderCandidate(project_id=uuid.uuid4(), package_id=uuid.uuid4(), vendor_id=used.id))
    await session.flush()

    await remove_demo_supplier_catalogue(session)

    remaining = set((await session.execute(select(Vendor.code).where(Vendor.code.like("V00_")))).scalars().all())
    assert remaining == {"V002"}
