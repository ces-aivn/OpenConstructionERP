"""Vendor register input: coded refusals and ISO 4217 currencies.

A duplicate vendor code or catalogue SKU answers 409 with a machine code and
the offending value, so the screen states it in the reader's language. A
vendor's currency is an ISO 4217 code: "dollar" is refused rather than stored
as "dol".
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.supplier_catalogs.schemas import CatalogItemCreate, VendorCreate, VendorUpdate
from app.modules.supplier_catalogs.service import SupplierCatalogsService, vendor_currency
from tests._pg import transactional_session


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with transactional_session(disable_fks=True) as s:
        yield s


def test_currency_is_normalised_to_its_iso_code() -> None:
    assert vendor_currency(" vnd ") == "VND"
    assert vendor_currency("USD") == "USD"


@pytest.mark.parametrize("raw", ["dollar", "dol", "", "US$"])
def test_non_iso_currency_is_refused_with_a_code(raw: str) -> None:
    with pytest.raises(HTTPException) as exc:
        vendor_currency(raw)
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "currency_not_iso4217"  # type: ignore[index]
    assert exc.value.detail["field"] == "currency"  # type: ignore[index]


@pytest.mark.asyncio
async def test_duplicate_vendor_code_is_a_coded_409(session: AsyncSession) -> None:
    svc = SupplierCatalogsService(session)
    code = f"NCC-{uuid.uuid4().hex[:6]}"
    created = await svc.create_vendor(VendorCreate(code=code, name="Thep Hoa Phat", currency="vnd"))
    assert created.currency == "VND"
    with pytest.raises(HTTPException) as exc:
        await svc.create_vendor(VendorCreate(code=code, name="Another", currency="VND"))
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "vendor_code_taken"  # type: ignore[index]
    assert exc.value.detail["params"] == {"code": code}  # type: ignore[index]


@pytest.mark.asyncio
async def test_vendor_update_refuses_a_non_iso_currency(session: AsyncSession) -> None:
    svc = SupplierCatalogsService(session)
    vendor = await svc.create_vendor(VendorCreate(code=f"NCC-{uuid.uuid4().hex[:6]}", name="Xi mang", currency="USD"))
    with pytest.raises(HTTPException) as exc:
        await svc.update_vendor(vendor.id, VendorUpdate(currency="dollar"))
    assert exc.value.detail["code"] == "currency_not_iso4217"  # type: ignore[index]


@pytest.mark.asyncio
async def test_duplicate_sku_is_a_coded_409(session: AsyncSession) -> None:
    svc = SupplierCatalogsService(session)
    sku = f"VT-{uuid.uuid4().hex[:6]}"
    await svc.create_catalog_item(CatalogItemCreate(sku=sku, name="Thep D10", unit_of_measure="kg"))
    with pytest.raises(HTTPException) as exc:
        await svc.create_catalog_item(CatalogItemCreate(sku=sku, name="Thep D10", unit_of_measure="kg"))
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "catalog_item_sku_taken"  # type: ignore[index]
