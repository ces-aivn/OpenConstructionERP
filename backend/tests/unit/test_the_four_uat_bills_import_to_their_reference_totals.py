"""The four bills of the acceptance package import to their reference totals.

The CSVs under ``tests/fixtures/uat_boq`` are the acceptance package's own
files, kept in the number format of their market: Landmark 81 and LEGO in the
Vietnamese one (``15.000``, ``8.500.000``), SoFi and Penn in the US one
(``"450,000"``, ``"1,400.00"``), all four under Vietnamese column names. They
are read by the spreadsheet importer, stored as lines of a bill, priced with
the markups the reference sheet lists, and the bill's server-side totals are
checked against the independently computed reference figures.

Before the fix the importer read SoFi as 1,434,548,708 USD ("450,000" as 450,
because the Vietnamese header proposed dot grouping and the file's "12.00"
vetoed it, leaving the commas unread), and dropped the lump-sum lines priced
in trillions of dong against a 1e8 rate cap.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio

from app.modules.boq.importers.excel import ExcelImporter
from app.modules.boq.schemas import MarkupCreate, PositionCreate
from app.modules.boq.service import BOQService
from tests._pg import transactional_session

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "uat_boq"
OWNER_ID = uuid.uuid4()

# (file, currency, lines, direct cost, markups, grand total)
# Markups: (name, category, percent, apply_to), in cascade order.
VN_BXD = [
    ("Chi phí chung", "overhead", "6.5", "direct_cost"),
    ("Nhà tạm", "overhead", "1.1", "direct_cost"),
    ("Khối lượng không xác định", "contingency", "2.5", "direct_cost"),
    ("Thu nhập chịu thuế tính trước", "profit", "6", "cumulative"),
    ("VAT", "tax", "10", "cumulative"),
]
US_AIA = [
    ("General Conditions", "overhead", "8", "direct_cost"),
    ("GC Overhead", "overhead", "7", "direct_cost"),
    ("GC Profit", "profit", "5", "direct_cost"),
    ("General Liability", "insurance", "1", "direct_cost"),
    ("Bond", "bond", "1.5", "cumulative"),
    ("Design Contingency", "contingency", "5", "direct_cost"),
    ("Construction Contingency", "contingency", "3", "direct_cost"),
]
BILLS = [
    ("BOQ_CS-VN01_Landmark81.csv", "VND", 12, Decimal("1930150000000"), VN_BXD, Decimal("2477860944900")),
    ("BOQ_CS-VN02_LEGO.csv", "VND", 14, Decimal("8574100000000"),
     [("Phụ phí", "overhead", "7", "direct_cost")], Decimal("9174287000000")),
    ("BOQ_CS-US01_SoFi.csv", "USD", 12, Decimal("1982708000"), US_AIA, Decimal("2593679470.20")),
    ("BOQ_CS-US02_Penn.csv", "USD", 13, Decimal("965480000"),
     [("GC, insurance, IPD profit pool", "overhead", "12", "direct_cost")], Decimal("1081337600")),
]


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        from app.modules.users.models import User

        s.add(User(id=OWNER_ID, email=f"o-{uuid.uuid4().hex[:6]}@test.io", hashed_password="x", full_name="O"))
        await s.flush()
        await s.commit()
        yield s


@pytest.mark.asyncio
@pytest.mark.parametrize(("name", "currency", "lines", "direct", "markups", "grand"), BILLS)
async def test_csv_reads_in_its_own_number_format(name, currency, lines, direct, markups, grand):
    imported = await ExcelImporter.parse((FIXTURES / name).read_bytes(), locale="vi")

    assert imported.errors == []
    assert len(imported.positions) == lines
    total = sum(Decimal(str(p.quantity)) * Decimal(str(p.unit_rate)) for p in imported.positions)
    assert total == direct


@pytest.mark.asyncio
@pytest.mark.parametrize(("name", "currency", "lines", "direct", "markups", "grand"), BILLS)
async def test_imported_bill_totals_match_the_reference(session, name, currency, lines, direct, markups, grand):
    from app.modules.boq.models import BOQ
    from app.modules.projects.models import Project

    project_id = uuid.uuid4()
    session.add(Project(id=project_id, name=name, owner_id=OWNER_ID, currency=currency))
    await session.flush()
    boq = BOQ(id=uuid.uuid4(), project_id=project_id, name=name)
    session.add(boq)
    await session.commit()

    service = BOQService(session)
    imported = await ExcelImporter.parse((FIXTURES / name).read_bytes(), locale="vi")
    await service.bulk_add_positions(
        boq.id,
        [
            PositionCreate(
                boq_id=boq.id,
                ordinal=f"{(i + 1) * 10:04d}",
                description=p.description,
                unit=p.unit,
                quantity=p.quantity,
                unit_rate=Decimal(str(p.unit_rate)),
                source="excel_import",
            )
            for i, p in enumerate(imported.positions)
        ],
    )
    for order, (markup_name, category, percent, apply_to) in enumerate(markups):
        await service.add_markup(
            boq.id,
            MarkupCreate(
                name=markup_name,
                category=category,
                percentage=float(percent),
                apply_to=apply_to,
                sort_order=order,
            ),
        )
    await session.commit()

    totals = (await service.compute_boq_totals([boq.id]))[boq.id]
    assert Decimal(str(totals["direct_cost"])).quantize(Decimal("0.01")) == direct
    assert Decimal(str(totals["grand_total"])).quantize(Decimal("0.01")) == grand
