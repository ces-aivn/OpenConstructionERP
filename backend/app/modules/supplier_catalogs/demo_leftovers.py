# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Recognise and remove the demo seed's supplier-catalogue rows once no demo project is installed.

Run on every boot by the repair registered in ``repairs.py``; see that module
for what is removed and what is kept.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.demo_marker import live_demo_projects
from app.modules.procurement.models import MaterialRequisition, MaterialRequisitionItem
from app.modules.projects.models import Project
from app.modules.supplier_catalogs.models import (
    CatalogEntry,
    CatalogItem,
    GRLine,
    ItemCategory,
    KYCDocument,
    POLine,
    PriceList,
    PRLine,
    PurchaseRequisition,
    StockBalance,
    StockMovement,
    SupplierGoodsReceipt,
    SupplierPurchaseOrder,
    ThreeWayMatchRecord,
    Vendor,
    VendorInvoice,
    VendorInvoiceLine,
    VendorScorecard,
    Warehouse,
)
from app.modules.supplier_catalogs.seed import (
    DEMO_CATEGORY_CODES,
    DEMO_CATEGORY_SPECS,
    DEMO_COUNTRY,
    DEMO_CURRENCY,
    DEMO_GR_NUMBERS,
    DEMO_INVOICE_NUMBERS,
    DEMO_ITEM_COUNT,
    DEMO_PO_NUMBERS,
    DEMO_PR_NUMBERS,
    DEMO_VENDOR_SPECS,
    DEMO_WAREHOUSE,
    demo_item_description,
    demo_item_sku,
)

logger = logging.getLogger(__name__)

#: A vendor changed this long after the seed wrote it was worked on by a person.
_EDITED_AFTER = timedelta(minutes=10)


def _edited(row: Any) -> bool:
    created, updated = getattr(row, "created_at", None), getattr(row, "updated_at", None)
    if created is None or updated is None:
        return False
    if (created.tzinfo is None) != (updated.tzinfo is None):
        created, updated = created.replace(tzinfo=None), updated.replace(tzinfo=None)
    return updated - created > _EDITED_AFTER


async def _delete(session: AsyncSession, model: Any, column: Any, ids: list[uuid.UUID]) -> int:
    if not ids:
        return 0
    result = await session.execute(delete(model).where(column.in_(ids)).execution_options(synchronize_session=False))
    return result.rowcount or 0


async def _ids(session: AsyncSession, stmt: Any) -> list[uuid.UUID]:
    return list((await session.execute(stmt)).scalars().all())


def _vendor_reference_columns() -> list[Any]:
    """Every column outside the catalogue's own tables that can name a supplier vendor.

    A vendor any of them names is in use and stays. Imported here so the
    module costs nothing until the repair runs.
    """
    from app.modules.plant_register.models import LeadTimeQuote, PlantItem, SlotReservation
    from app.modules.procurement.models import MaterialRequisitionItemSource
    from app.modules.procurement_concept.models import BidderCandidate, FrameworkAgreement
    from app.modules.site_logistics.models import MediaConnection

    return [
        MaterialRequisition.vendor_id,
        MaterialRequisitionItem.suggested_vendor_id,
        MaterialRequisitionItemSource.suggested_vendor_id,
        BidderCandidate.vendor_id,
        FrameworkAgreement.vendor_id,
        PlantItem.vendor_id,
        LeadTimeQuote.vendor_id,
        SlotReservation.vendor_id,
        MediaConnection.provider_vendor_id,
    ]


async def remove_demo_supplier_catalogue(session: AsyncSession) -> int:
    """Delete the demo seed's supplier-catalogue rows when no demo project is installed."""
    if await live_demo_projects(session):
        return 0

    removed = 0
    existing_projects = select(Project.id)

    # ── Vendors the seed wrote, as it wrote them ────────────────────────────
    specs = {code: (name, region) for code, name, region, _cats, _rating in DEMO_VENDOR_SPECS}
    seeded_vendors = [
        v
        for v in (await session.execute(select(Vendor).where(Vendor.code.in_(list(specs))))).scalars().all()
        if (v.name, v.region) == specs.get(v.code)
        and v.currency == DEMO_CURRENCY
        and v.country_code == DEMO_COUNTRY
        and not v.contact_id
        and not _edited(v)
    ]
    vendor_ids = [v.id for v in seeded_vendors]

    # ── The seed's orders, receipts and invoices against those vendors ──────
    po_ids = await _ids(
        session,
        select(SupplierPurchaseOrder.id).where(
            SupplierPurchaseOrder.number.in_(DEMO_PO_NUMBERS),
            SupplierPurchaseOrder.vendor_id.in_(vendor_ids or [uuid.uuid4()]),
        ),
    )
    invoice_ids = await _ids(
        session,
        select(VendorInvoice.id).where(
            VendorInvoice.number.in_(DEMO_INVOICE_NUMBERS),
            VendorInvoice.vendor_id.in_(vendor_ids or [uuid.uuid4()]),
        ),
    )
    gr_ids = await _ids(
        session,
        select(SupplierGoodsReceipt.id).where(
            SupplierGoodsReceipt.number.in_(DEMO_GR_NUMBERS),
            SupplierGoodsReceipt.po_id.in_(po_ids or [uuid.uuid4()]),
        ),
    )
    removed += await _delete(session, ThreeWayMatchRecord, ThreeWayMatchRecord.invoice_id, invoice_ids)
    removed += await _delete(session, ThreeWayMatchRecord, ThreeWayMatchRecord.po_id, po_ids)
    removed += await _delete(session, VendorInvoiceLine, VendorInvoiceLine.invoice_id, invoice_ids)
    removed += await _delete(session, VendorInvoice, VendorInvoice.id, invoice_ids)
    removed += await _delete(session, GRLine, GRLine.gr_id, gr_ids)
    removed += await _delete(session, SupplierGoodsReceipt, SupplierGoodsReceipt.id, gr_ids)
    removed += await _delete(session, POLine, POLine.po_id, po_ids)
    removed += await _delete(session, SupplierPurchaseOrder, SupplierPurchaseOrder.id, po_ids)

    # ── Requisitions and the warehouse of a demo project that is gone ───────
    pr_ids = await _ids(
        session,
        select(PurchaseRequisition.id).where(
            PurchaseRequisition.number.in_(DEMO_PR_NUMBERS),
            PurchaseRequisition.currency == DEMO_CURRENCY,
            PurchaseRequisition.project_id.not_in(existing_projects),
        ),
    )
    removed += await _delete(session, PRLine, PRLine.pr_id, pr_ids)
    removed += await _delete(session, PurchaseRequisition, PurchaseRequisition.id, pr_ids)

    wh_code, wh_name = DEMO_WAREHOUSE
    warehouse_ids = await _ids(
        session,
        select(Warehouse.id).where(
            Warehouse.code == wh_code,
            Warehouse.name == wh_name,
            Warehouse.project_id.is_not(None),
            Warehouse.project_id.not_in(existing_projects),
        ),
    )
    if warehouse_ids:
        still_received = await _ids(
            session,
            select(SupplierGoodsReceipt.warehouse_id).where(SupplierGoodsReceipt.warehouse_id.in_(warehouse_ids)),
        )
        warehouse_ids = [w for w in warehouse_ids if w not in set(still_received)]
    removed += await _delete(session, StockMovement, StockMovement.warehouse_id, warehouse_ids)
    removed += await _delete(session, StockBalance, StockBalance.warehouse_id, warehouse_ids)
    removed += await _delete(session, Warehouse, Warehouse.id, warehouse_ids)

    # ── The vendors themselves, unless something real still names them ──────
    if vendor_ids:
        held = set(
            await _ids(
                session, select(SupplierPurchaseOrder.vendor_id).where(SupplierPurchaseOrder.vendor_id.in_(vendor_ids))
            )
        )
        held |= set(await _ids(session, select(VendorInvoice.vendor_id).where(VendorInvoice.vendor_id.in_(vendor_ids))))
        for column in _vendor_reference_columns():
            held |= set(await _ids(session, select(column).where(column.in_(vendor_ids))))
        vendor_ids = [v for v in vendor_ids if v not in held]
        demo_price_lists = await _ids(
            session,
            select(PriceList.id).where(
                PriceList.vendor_id.in_(vendor_ids or [uuid.uuid4()]),
                PriceList.name.like("V00_ 2026-Q1"),
            ),
        )
        other_price_lists = await _ids(
            session,
            select(PriceList.id).where(
                PriceList.vendor_id.in_(vendor_ids or [uuid.uuid4()]),
                PriceList.id.not_in(demo_price_lists or [uuid.uuid4()]),
            ),
        )
        # A price list somebody added to a seeded vendor means the vendor is in use.
        if other_price_lists:
            owners = set(await _ids(session, select(PriceList.vendor_id).where(PriceList.id.in_(other_price_lists))))
            vendor_ids = [v for v in vendor_ids if v not in owners]
            demo_price_lists = await _ids(
                session,
                select(PriceList.id).where(
                    PriceList.vendor_id.in_(vendor_ids or [uuid.uuid4()]),
                    PriceList.name.like("V00_ 2026-Q1"),
                ),
            )
        removed += await _delete(session, CatalogEntry, CatalogEntry.price_list_id, demo_price_lists)
        removed += await _delete(session, PriceList, PriceList.id, demo_price_lists)
        removed += await _delete(session, KYCDocument, KYCDocument.vendor_id, vendor_ids)
        removed += await _delete(session, VendorScorecard, VendorScorecard.vendor_id, vendor_ids)
        removed += await _delete(session, Vendor, Vendor.id, vendor_ids)

    # ── Numbered demo catalogue items nothing points at any more ────────────
    skus = [demo_item_sku(i) for i in range(DEMO_ITEM_COUNT)]
    candidates = [
        item
        for item in (await session.execute(select(CatalogItem).where(CatalogItem.sku.in_(skus)))).scalars().all()
        if item.name == f"Item {int(item.sku.split('-')[1])}"
        and item.description == demo_item_description(item.sku)
        and not _edited(item)
    ]
    item_ids = [i.id for i in candidates]
    if item_ids:
        referenced: set[uuid.UUID] = set()
        for model, column in (
            (CatalogEntry, CatalogEntry.catalog_item_id),
            (POLine, POLine.catalog_item_id),
            (PRLine, PRLine.catalog_item_id),
            (StockBalance, StockBalance.catalog_item_id),
            (StockMovement, StockMovement.catalog_item_id),
        ):
            referenced |= set(await _ids(session, select(column).where(column.in_(item_ids))))
        item_ids = [i for i in item_ids if i not in referenced]
        removed += await _delete(session, CatalogItem, CatalogItem.id, item_ids)

    # ── The seed's three-level category tree, leaves first ──────────────────
    # A code alone is not the seed's: "MATERIALS" or "CONCRETE" is what a
    # company would call its own category too. Only a row with the seed's
    # name and level, never edited since, is the seed's row.
    for code in DEMO_CATEGORY_CODES:
        name, level = DEMO_CATEGORY_SPECS[code]
        cat_ids = [
            c.id
            for c in (await session.execute(select(ItemCategory).where(ItemCategory.code == code))).scalars().all()
            if c.name == name and c.level == level and not _edited(c)
        ]
        if not cat_ids:
            continue
        in_use = set(await _ids(session, select(CatalogItem.category_id).where(CatalogItem.category_id.in_(cat_ids))))
        in_use |= set(await _ids(session, select(ItemCategory.parent_id).where(ItemCategory.parent_id.in_(cat_ids))))
        removed += await _delete(session, ItemCategory, ItemCategory.id, [c for c in cat_ids if c not in in_use])

    if removed:
        logger.info("Removed %d leftover demo supplier-catalogue row(s): no demo project is installed.", removed)
    return removed
