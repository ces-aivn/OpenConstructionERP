# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Demo seed data for the catalog module.

Loads a curated set of global catalog resources (labor, material, equipment,
and operator entries) with realistic base rates, price ranges, and units.

The CatalogResource table has no project_id column: resources are GLOBAL and
shared across all projects. The project_ids argument is therefore accepted for
signature compatibility with the demo seeder framework but is not used to scope
rows. Idempotency is keyed on a marker resource_code: if that row already
exists the function returns immediately.

Installs seeded before the codes were renamed carry the old ``DEMO-`` prefix.
Those rows are recoded in place rather than deleted and reinserted, see
``_recode_legacy_rows`` for why.

Safe to call repeatedly.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import CatalogResource

logger = logging.getLogger(__name__)

# Marker code used for the idempotency guard. If this row exists the whole
# seed is assumed to have run already.
_MARKER_CODE = "EU-LAB-001"

# The prefix these resources shipped under before the rename, and the marker
# that identifies an install still carrying it. An install seeded by an older
# build has 33 rows under the old prefix; without this the new marker would not
# match, the seed would run again, and the estate would end up with 66 rows and
# two of every resource. ``resource_code`` is indexed but NOT unique
# (see models.py), so nothing at the database level would stop that.
_LEGACY_PREFIX = "DEMO-"
_CODE_PREFIX = "EU-"
_LEGACY_MARKER_CODE = _LEGACY_PREFIX + _MARKER_CODE.removeprefix(_CODE_PREFIX)

# (code, name, resource_type, category, unit, base_price, min_price, max_price)
# base_price stays inside the min/max band. Prices in EUR.
_RESOURCES: tuple[tuple[str, str, str, str, str, str, str, str], ...] = (
    # --- Labor ---
    ("EU-LAB-001", "General construction laborer", "labor", "Labor - General", "h", "38.00", "32.00", "46.00"),
    ("EU-LAB-002", "Skilled carpenter", "labor", "Labor - Carpentry", "h", "52.00", "44.00", "62.00"),
    ("EU-LAB-003", "Steel fixer", "labor", "Labor - Reinforcement", "h", "49.00", "42.00", "58.00"),
    ("EU-LAB-004", "Bricklayer", "labor", "Labor - Masonry", "h", "47.00", "40.00", "55.00"),
    ("EU-LAB-005", "Electrician", "labor", "Labor - Electrical", "h", "58.00", "50.00", "70.00"),
    ("EU-LAB-006", "Plumber", "labor", "Labor - Plumbing", "h", "56.00", "48.00", "68.00"),
    ("EU-LAB-007", "Site foreman", "labor", "Labor - Supervision", "h", "72.00", "62.00", "85.00"),
    ("EU-LAB-008", "Painter and decorator", "labor", "Labor - Finishing", "h", "44.00", "37.00", "53.00"),
    # --- Material ---
    ("EU-MAT-001", "Ready-mix concrete C25/30", "material", "Concrete & Cement", "m3", "118.00", "98.00", "140.00"),
    ("EU-MAT-002", "Ready-mix concrete C30/37", "material", "Concrete & Cement", "m3", "132.00", "112.00", "158.00"),
    (
        "EU-MAT-003",
        "Reinforcement steel bar B500B",
        "material",
        "Reinforcement",
        "ton",
        "920.00",
        "820.00",
        "1080.00",
    ),
    (
        "EU-MAT-004",
        "Structural steel section S355",
        "material",
        "Structural Steel",
        "ton",
        "1450.00",
        "1280.00",
        "1690.00",
    ),
    ("EU-MAT-005", "Common clay brick", "material", "Masonry", "pcs", "0.65", "0.48", "0.92"),
    ("EU-MAT-006", "Aerated concrete block", "material", "Masonry", "pcs", "2.40", "1.90", "3.10"),
    (
        "EU-MAT-007",
        "Portland cement CEM I 42.5",
        "material",
        "Concrete & Cement",
        "ton",
        "165.00",
        "140.00",
        "195.00",
    ),
    ("EU-MAT-008", "Gypsum plasterboard 12.5 mm", "material", "Drywall & Boards", "m2", "6.80", "5.40", "8.60"),
    ("EU-MAT-009", "Mineral wool insulation 100 mm", "material", "Insulation", "m2", "11.20", "9.00", "14.50"),
    ("EU-MAT-010", "Interior emulsion paint", "material", "Paints & Coatings", "l", "8.90", "6.50", "12.00"),
    ("EU-MAT-011", "Sawn softwood timber", "material", "Timber", "m3", "420.00", "360.00", "510.00"),
    ("EU-MAT-012", "PVC drainage pipe DN110", "material", "Pipes & Drainage", "m", "9.40", "7.20", "12.80"),
    ("EU-MAT-013", "Copper electrical cable NYM 3x2.5", "material", "Electrical", "m", "3.20", "2.40", "4.60"),
    ("EU-MAT-014", "Ceramic floor tile", "material", "Tiling", "m2", "28.00", "18.00", "44.00"),
    # --- Equipment ---
    ("EU-EQP-001", "Tower crane (hire)", "equipment", "Cranes", "week", "3200.00", "2700.00", "3900.00"),
    ("EU-EQP-002", "Mobile crane 50 t (hire)", "equipment", "Cranes", "day", "980.00", "820.00", "1180.00"),
    ("EU-EQP-003", "Crawler excavator 20 t (hire)", "equipment", "Earthmoving", "day", "540.00", "450.00", "650.00"),
    ("EU-EQP-004", "Wheel loader (hire)", "equipment", "Earthmoving", "day", "410.00", "340.00", "500.00"),
    ("EU-EQP-005", "Concrete pump (hire)", "equipment", "Concrete Plant", "day", "720.00", "600.00", "880.00"),
    ("EU-EQP-006", "Scaffolding system (hire)", "equipment", "Access & Scaffolding", "m2", "14.50", "11.00", "19.00"),
    (
        "EU-EQP-007",
        "Diesel generator 60 kVA (hire)",
        "equipment",
        "Power & Generators",
        "day",
        "165.00",
        "130.00",
        "210.00",
    ),
    (
        "EU-EQP-008",
        "Telescopic handler (hire)",
        "equipment",
        "Material Handling",
        "day",
        "290.00",
        "240.00",
        "360.00",
    ),
    # --- Operator ---
    ("EU-OPR-001", "Tower crane operator", "operator", "Operators - Crane", "h", "64.00", "55.00", "76.00"),
    ("EU-OPR-002", "Excavator operator", "operator", "Operators - Earthmoving", "h", "57.00", "49.00", "68.00"),
    ("EU-OPR-003", "Concrete pump operator", "operator", "Operators - Concrete", "h", "59.00", "50.00", "71.00"),
)

# Resource sets for the two markets this build serves, one per region, priced
# in the market's currency. A Vietnamese project opens the catalogue on "VN",
# an American one on "US" (``GET /catalog/regions/preferred/``), instead of
# on European resources priced in euro. Category names are shared with the
# European set, so one translation per category covers every market. Rates are
# indicative 2026 figures for estimating, not quotations.
#
# Vietnam: labour and operators per working day (công), plant per shift (ca),
# in VND, whole dong.
_VN_RESOURCES: tuple[tuple[str, str, str, str, str, str, str, str], ...] = (
    ("VN-LAB-001", "Nhân công phổ thông bậc 3/7", "labor", "Labor - General", "công", "350000", "300000", "420000"),
    ("VN-LAB-002", "Thợ cốp pha bậc 4/7", "labor", "Labor - Carpentry", "công", "450000", "380000", "520000"),
    ("VN-LAB-003", "Thợ cốt thép bậc 4/7", "labor", "Labor - Reinforcement", "công", "450000", "380000", "520000"),
    ("VN-LAB-004", "Thợ nề bậc 4/7", "labor", "Labor - Masonry", "công", "430000", "370000", "500000"),
    ("VN-LAB-005", "Thợ điện bậc 4/7", "labor", "Labor - Electrical", "công", "480000", "400000", "560000"),
    ("VN-LAB-006", "Thợ cấp thoát nước bậc 4/7", "labor", "Labor - Plumbing", "công", "470000", "400000", "550000"),
    (
        "VN-LAB-007",
        "Cán bộ kỹ thuật giám sát thi công",
        "labor",
        "Labor - Supervision",
        "công",
        "700000",
        "600000",
        "850000",
    ),
    ("VN-LAB-008", "Thợ sơn bả bậc 4/7", "labor", "Labor - Finishing", "công", "420000", "360000", "490000"),
    (
        "VN-MAT-001",
        "Bê tông thương phẩm B20 (M250)",
        "material",
        "Concrete & Cement",
        "m3",
        "1250000",
        "1150000",
        "1380000",
    ),
    (
        "VN-MAT-002",
        "Bê tông thương phẩm B25 (M350)",
        "material",
        "Concrete & Cement",
        "m3",
        "1400000",
        "1300000",
        "1550000",
    ),
    ("VN-MAT-003", "Thép cốt bê tông CB400-V", "material", "Reinforcement", "tấn", "15500000", "14500000", "17000000"),
    (
        "VN-MAT-004",
        "Thép hình kết cấu SS400",
        "material",
        "Structural Steel",
        "tấn",
        "18500000",
        "17000000",
        "20500000",
    ),
    ("VN-MAT-005", "Gạch đặc đất nung 6,5x10,5x22 cm", "material", "Masonry", "viên", "1300", "1100", "1600"),
    ("VN-MAT-006", "Gạch bê tông khí chưng áp (AAC)", "material", "Masonry", "m3", "1450000", "1300000", "1650000"),
    ("VN-MAT-007", "Xi măng PCB40", "material", "Concrete & Cement", "tấn", "1600000", "1450000", "1800000"),
    ("VN-MAT-008", "Tấm thạch cao 9 mm", "material", "Drywall & Boards", "m2", "75000", "60000", "95000"),
    ("VN-MAT-009", "Bông khoáng cách nhiệt 50 mm", "material", "Insulation", "m2", "85000", "70000", "110000"),
    ("VN-MAT-010", "Sơn nước nội thất", "material", "Paints & Coatings", "lít", "95000", "70000", "130000"),
    ("VN-MAT-011", "Gỗ ván khuôn nhóm V", "material", "Timber", "m3", "5500000", "4800000", "6500000"),
    ("VN-MAT-012", "Ống uPVC thoát nước D110", "material", "Pipes & Drainage", "m", "95000", "75000", "120000"),
    ("VN-MAT-013", "Cáp điện Cu/PVC 3x2,5 mm2", "material", "Electrical", "m", "38000", "30000", "48000"),
    ("VN-MAT-014", "Gạch ceramic lát nền 600x600 mm", "material", "Tiling", "m2", "220000", "160000", "320000"),
    ("VN-MAT-015", "Cát vàng đổ bê tông", "material", "Aggregates", "m3", "450000", "380000", "550000"),
    ("VN-MAT-016", "Đá dăm 1x2", "material", "Aggregates", "m3", "380000", "320000", "450000"),
    ("VN-EQP-001", "Cần trục tháp 25 T", "equipment", "Cranes", "ca", "4500000", "3800000", "5300000"),
    ("VN-EQP-002", "Cần trục ô tô 25 T", "equipment", "Cranes", "ca", "3800000", "3200000", "4500000"),
    ("VN-EQP-003", "Máy đào 1,25 m3", "equipment", "Earthmoving", "ca", "3200000", "2700000", "3800000"),
    ("VN-EQP-004", "Máy ủi 110 CV", "equipment", "Earthmoving", "ca", "2600000", "2200000", "3100000"),
    ("VN-EQP-005", "Máy bơm bê tông 50 m3/h", "equipment", "Concrete Plant", "ca", "3500000", "3000000", "4200000"),
    (
        "VN-EQP-006",
        "Giàn giáo thép (thuê theo tháng)",
        "equipment",
        "Access & Scaffolding",
        "m2",
        "25000",
        "18000",
        "32000",
    ),
    ("VN-EQP-007", "Máy phát điện 60 kVA", "equipment", "Power & Generators", "ca", "1600000", "1300000", "2000000"),
    ("VN-EQP-008", "Máy trộn bê tông 250 lít", "equipment", "Concrete Plant", "ca", "350000", "300000", "420000"),
    ("VN-OPR-001", "Thợ vận hành cần trục tháp", "operator", "Operators - Crane", "công", "650000", "550000", "780000"),
    ("VN-OPR-002", "Thợ vận hành máy đào", "operator", "Operators - Earthmoving", "công", "600000", "500000", "720000"),
    (
        "VN-OPR-003",
        "Thợ vận hành máy bơm bê tông",
        "operator",
        "Operators - Concrete",
        "công",
        "580000",
        "500000",
        "700000",
    ),
)

# United States: labour and operators per hour, plant per day or week, in USD,
# in the customary units an American estimate uses (CY, SF, LF).
_US_RESOURCES: tuple[tuple[str, str, str, str, str, str, str, str], ...] = (
    ("US-LAB-001", "Construction laborer", "labor", "Labor - General", "h", "32.00", "27.00", "40.00"),
    ("US-LAB-002", "Carpenter", "labor", "Labor - Carpentry", "h", "48.00", "40.00", "58.00"),
    ("US-LAB-003", "Reinforcing ironworker", "labor", "Labor - Reinforcement", "h", "52.00", "44.00", "62.00"),
    ("US-LAB-004", "Bricklayer / mason", "labor", "Labor - Masonry", "h", "50.00", "42.00", "60.00"),
    ("US-LAB-005", "Electrician", "labor", "Labor - Electrical", "h", "62.00", "52.00", "75.00"),
    ("US-LAB-006", "Plumber", "labor", "Labor - Plumbing", "h", "60.00", "50.00", "72.00"),
    ("US-LAB-007", "Site superintendent", "labor", "Labor - Supervision", "h", "85.00", "72.00", "100.00"),
    ("US-LAB-008", "Painter", "labor", "Labor - Finishing", "h", "42.00", "35.00", "50.00"),
    ("US-MAT-001", "Ready-mix concrete 4,000 psi", "material", "Concrete & Cement", "CY", "165.00", "145.00", "190.00"),
    ("US-MAT-002", "Ready-mix concrete 5,000 psi", "material", "Concrete & Cement", "CY", "180.00", "160.00", "210.00"),
    ("US-MAT-003", "Rebar ASTM A615 Grade 60", "material", "Reinforcement", "ton", "1150.00", "1000.00", "1350.00"),
    (
        "US-MAT-004",
        "Structural steel W-shape A992",
        "material",
        "Structural Steel",
        "ton",
        "1600.00",
        "1400.00",
        "1850.00",
    ),
    ("US-MAT-005", "Modular face brick", "material", "Masonry", "ea", "0.75", "0.55", "1.00"),
    ("US-MAT-006", "Concrete masonry unit 8 in", "material", "Masonry", "ea", "2.10", "1.70", "2.60"),
    (
        "US-MAT-007",
        "Portland cement Type I/II, 94 lb bag",
        "material",
        "Concrete & Cement",
        "bag",
        "15.50",
        "13.00",
        "18.00",
    ),
    ("US-MAT-008", "Gypsum board 1/2 in", "material", "Drywall & Boards", "SF", "0.55", "0.45", "0.70"),
    ("US-MAT-009", "Fiberglass batt insulation R-13", "material", "Insulation", "SF", "0.75", "0.60", "0.95"),
    ("US-MAT-010", "Interior latex paint", "material", "Paints & Coatings", "gal", "38.00", "28.00", "52.00"),
    ("US-MAT-011", "Dimension lumber 2x4 SPF", "material", "Timber", "MBF", "650.00", "550.00", "780.00"),
    ("US-MAT-012", "PVC DWV pipe 4 in", "material", "Pipes & Drainage", "LF", "6.20", "4.80", "7.80"),
    ("US-MAT-013", "Copper cable NM-B 12/2", "material", "Electrical", "LF", "1.10", "0.85", "1.40"),
    ("US-MAT-014", "Ceramic floor tile", "material", "Tiling", "SF", "4.50", "2.50", "8.00"),
    ("US-EQP-001", "Tower crane (rental)", "equipment", "Cranes", "week", "9500.00", "8000.00", "11500.00"),
    ("US-EQP-002", "Mobile crane 50 t (rental)", "equipment", "Cranes", "day", "1900.00", "1600.00", "2300.00"),
    (
        "US-EQP-003",
        "Hydraulic excavator 20 t (rental)",
        "equipment",
        "Earthmoving",
        "day",
        "950.00",
        "800.00",
        "1150.00",
    ),
    ("US-EQP-004", "Wheel loader (rental)", "equipment", "Earthmoving", "day", "700.00", "580.00", "850.00"),
    (
        "US-EQP-005",
        "Concrete boom pump (rental)",
        "equipment",
        "Concrete Plant",
        "day",
        "1600.00",
        "1350.00",
        "1950.00",
    ),
    (
        "US-EQP-006",
        "Frame scaffolding (monthly rental)",
        "equipment",
        "Access & Scaffolding",
        "SF",
        "1.20",
        "0.90",
        "1.60",
    ),
    (
        "US-EQP-007",
        "Diesel generator 60 kW (rental)",
        "equipment",
        "Power & Generators",
        "day",
        "260.00",
        "210.00",
        "320.00",
    ),
    ("US-EQP-008", "Telehandler (rental)", "equipment", "Material Handling", "day", "420.00", "350.00", "520.00"),
    ("US-OPR-001", "Crane operator", "operator", "Operators - Crane", "h", "78.00", "66.00", "92.00"),
    ("US-OPR-002", "Excavator operator", "operator", "Operators - Earthmoving", "h", "68.00", "58.00", "80.00"),
    ("US-OPR-003", "Concrete pump operator", "operator", "Operators - Concrete", "h", "70.00", "60.00", "84.00"),
)

#: (region, currency, rows). The first code of each set is its idempotency marker.
MARKET_SETS: tuple[tuple[str, str, tuple[tuple[str, str, str, str, str, str, str, str], ...]], ...] = (
    ("VN", "VND", _VN_RESOURCES),
    ("US", "USD", _US_RESOURCES),
)


# Old code -> new code, one entry per resource above. Derived from _RESOURCES so
# it cannot drift out of step with the table: adding a resource extends this map
# automatically. Deliberately an exact-match map and not a "starts with DEMO-"
# sweep, which would also rewrite any row a customer happened to code that way.
_LEGACY_CODES: dict[str, str] = {_LEGACY_PREFIX + code.removeprefix(_CODE_PREFIX): code for code, *_rest in _RESOURCES}


async def _recode_legacy_rows(session: AsyncSession) -> int:
    """Rewrite the resource_code of rows seeded under the old prefix.

    An UPDATE, not a delete and reinsert. Component.catalog_resource_id in the
    assemblies module is a real foreign key declared ondelete="SET NULL", so
    deleting these rows would silently null out every link an assembly component
    holds to a catalog resource, with no error raised anywhere, and would also
    discard usage_count. An UPDATE keeps the row id, so every existing link and
    every accumulated counter survives the rename.

    Args:
        session: Active async SQLAlchemy session.

    Returns:
        Number of rows recoded.
    """
    recoded = 0
    for legacy_code, current_code in _LEGACY_CODES.items():
        result = await session.execute(
            update(CatalogResource)
            .where(CatalogResource.resource_code == legacy_code)
            .values(resource_code=current_code)
        )
        recoded += result.rowcount or 0

    await session.flush()
    return recoded


def _resource_row(
    spec: tuple[str, str, str, str, str, str, str, str], *, currency: str, region: str
) -> CatalogResource:
    code, name, resource_type, category, unit, base, low, high = spec
    return CatalogResource(
        resource_code=code,
        name=name,
        resource_type=resource_type,
        category=category,
        unit=unit,
        base_price=str(Decimal(base)),
        min_price=str(Decimal(low)),
        max_price=str(Decimal(high)),
        currency=currency,
        usage_count=0,
        source="manual",
        region=region,
        specifications={"demo": True, "band": [low, high]},
        is_active=True,
        metadata_={"seed": True, "demo": True},
    )


async def seed_market_catalogs(session: AsyncSession) -> dict[str, int]:
    """Insert the Vietnamese and American resource sets that are not there yet.

    Each set is guarded by its own first code, so an install that already has
    the European set gains the two market sets on its next run, once.

    Returns:
        ``{"catalog_resources_<region>": inserted}`` for each set inserted now.
    """
    counts: dict[str, int] = {}
    for region, currency, rows in MARKET_SETS:
        marker = rows[0][0]
        present = await session.execute(
            select(CatalogResource.id).where(CatalogResource.resource_code == marker).limit(1)
        )
        if present.scalar_one_or_none() is not None:
            continue
        for spec in rows:
            session.add(_resource_row(spec, currency=currency, region=region))
        counts[f"catalog_resources_{region}"] = len(rows)
    if counts:
        await session.flush()
    return counts


async def seed_catalog(
    session: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[str, int]:
    """Seed the global catalog of construction resources.

    CatalogResource rows are global (no project scoping), so project_ids is
    accepted for framework signature compatibility but only used to confirm at
    least one project context exists. Returns a dict of row counts inserted.
    Re-running is a no-op once the marker resource exists.

    The guard has three outcomes. Current codes present: nothing to do. Legacy
    codes present: recode in place and stop, without inserting. Neither: insert
    the full table. The middle branch must not fall through to the insert, that
    is what would double the catalog.

    Args:
        session: Active async SQLAlchemy session.
        project_ids: Demo project ids (unused for scoping; flagship-aware
            callers pass it for uniformity across module seeders).

    Returns:
        Mapping of entity name to the number of rows inserted.
    """
    counts: dict[str, int] = {}

    # Idempotency guard: bail out if the marker resource already exists.
    existing = await session.execute(
        select(CatalogResource.id).where(CatalogResource.resource_code == _MARKER_CODE).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("Catalog seed skipped: marker resource %s already present", _MARKER_CODE)
        return await seed_market_catalogs(session)

    # Same estate, older codes: rename it forward instead of seeding a second copy.
    legacy = await session.execute(
        select(CatalogResource.id).where(CatalogResource.resource_code == _LEGACY_MARKER_CODE).limit(1)
    )
    if legacy.scalar_one_or_none() is not None:
        recoded = await _recode_legacy_rows(session)
        logger.info("Catalog seed recoded %d resources from the previous code scheme", recoded)
        return {"catalog_resources_recoded": recoded}

    by_type: dict[str, int] = {}
    for spec in _RESOURCES:
        session.add(_resource_row(spec, currency="EUR", region="EU"))
        by_type[spec[2]] = by_type.get(spec[2], 0) + 1

    await session.flush()

    counts["catalog_resources"] = len(_RESOURCES)
    counts.update({f"resources_{rtype}": n for rtype, n in by_type.items()})
    counts.update(await seed_market_catalogs(session))

    logger.info("Catalog seed inserted: %s", counts)
    return counts
