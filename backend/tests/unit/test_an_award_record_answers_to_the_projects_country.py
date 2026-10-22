# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""An award record cites the procurement rules of the project's own country.

The record used to call itself a Vergabevermerk and cite VOB/A section 20 and
VgV section 8 for every project, so a private stadium in Los Angeles and a
factory in Vietnam were both filed under German public procurement law. The
country now picks the wording: Vietnam's Law on Bidding No. 22/2023/QH15, a
private US procurement with no statutory form, the German record for a German
project, and no named rules at all when the project names no country.
"""

from __future__ import annotations

import io
import uuid
from types import SimpleNamespace

import pypdf
import pytest

from app.modules.tendering.award_record import (
    build_award_record,
    legal_framework_for,
    normalise_country,
    project_country_code,
)
from app.modules.tendering.pdf_documents import generate_award_record_pdf

_GERMAN_TERMS = ("Vergabevermerk", "VERGABEVERMERK", "VOB/A", "VgV")


@pytest.mark.parametrize(
    ("written", "code"),
    [
        ("VN", "VN"),
        ("vn", "VN"),
        ("VNM", "VN"),
        ("Vietnam", "VN"),
        ("Viet Nam", "VN"),
        ("Việt Nam", "VN"),
        ("US", "US"),
        ("USA", "US"),
        ("United States", "US"),
        ("", None),
        (None, None),
    ],
)
def test_a_country_written_as_a_code_or_a_name_is_read_as_one_code(written: object, code: str | None) -> None:
    assert normalise_country(written) == code


def test_a_region_naming_another_country_outranks_the_legacy_german_default() -> None:
    assert project_country_code("DE", "Vietnam") == "VN"
    assert project_country_code(None, "Vietnam") == "VN"
    assert project_country_code("US", "California") == "US"
    assert project_country_code("DE", "") == "DE"
    assert project_country_code(None, None) is None


def test_the_country_picks_the_body_of_rules() -> None:
    assert legal_framework_for("VN") == "vn"
    assert legal_framework_for("US") == "us"
    assert legal_framework_for("DE") == "de"
    assert legal_framework_for("FR") == "neutral"
    assert legal_framework_for(None) == "neutral"


def _pdf_text(framework: str) -> str:
    record = build_award_record(package_name="Roof steel", status="draft", metadata={}, bids=[], currency="USD")
    record["package_name"] = "Roof steel"
    record["project_name"] = "SoFi Stadium"
    record["legal_framework"] = framework
    pdf = generate_award_record_pdf(record=record, package_ref="ab12cd34")
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    return "\n".join(page.extract_text() or "" for page in reader.pages) + str(reader.metadata or "")


@pytest.mark.parametrize("framework", ["vn", "us", "neutral"])
def test_no_record_outside_germany_cites_german_procurement_law(framework: str) -> None:
    text = _pdf_text(framework)
    for term in _GERMAN_TERMS:
        assert term not in text, (framework, term)


def test_a_vietnamese_record_cites_the_law_on_bidding() -> None:
    assert "22/2023/QH15" in _pdf_text("vn")


def test_a_german_record_keeps_its_own_name() -> None:
    assert "VERGABEVERMERK" in _pdf_text("de")


async def test_the_service_reports_the_framework_of_the_projects_country() -> None:
    from app.modules.tendering.service import TenderingService

    package = SimpleNamespace(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        boq_id=None,
        name="Kết cấu thép mái",
        description="",
        status="draft",
        deadline=None,
        metadata_={},
    )
    service = TenderingService.__new__(TenderingService)

    class _Repo:
        async def list_bids_for_package(self, _pid: object) -> list:
            return []

    async def _get_package(_pid: object) -> SimpleNamespace:
        return package

    async def _name_and_currency(_package: object) -> tuple[str, str]:
        return "LEGO Bình Dương", "VND"

    async def _country(_package: object) -> str | None:
        return "VN"

    service.repo = _Repo()
    service.session = SimpleNamespace()
    service.get_package = _get_package
    service._project_name_and_currency = _name_and_currency
    service._project_country = _country

    record = await service.award_record(package.id)
    assert record.country_code == "VN"
    assert record.legal_framework == "vn"
