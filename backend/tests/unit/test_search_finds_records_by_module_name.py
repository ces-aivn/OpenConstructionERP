"""A search that names a kind of record lists records of that kind.

Typing "hợp đồng", "contract", "rủi ro" or "BOQ" into the global search used
to answer "no results": the SQL track only matches record text, and nobody
writes the word "contract" into a contract's title. The query now names the
module, in English or Vietnamese, with or without tone marks, and the newest
records of that module are listed. Contracts and BOQ headers are searchable
record types of their own.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.vector_index import COLLECTION_RISKS
from app.modules.boq.models import BOQ
from app.modules.contracts.models import Contract
from app.modules.projects.models import Project
from app.modules.risk.models import RiskItem
from app.modules.search.service import (
    COLLECTION_BOQ_DOCUMENTS,
    COLLECTION_CONTRACTS,
    SEARCHABLE_COLLECTIONS,
    _normalize_types,
    _sql_search_collection,
    module_intent,
    normalize_search_text,
)
from app.modules.users.models import User


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("hợp đồng", COLLECTION_CONTRACTS),
        ("Hop Dong", COLLECTION_CONTRACTS),
        ("contract", COLLECTION_CONTRACTS),
        ("rủi ro", COLLECTION_RISKS),
        ("Sổ rủi ro", COLLECTION_RISKS),
        ("risk", COLLECTION_RISKS),
        ("BOQ", COLLECTION_BOQ_DOCUMENTS),
        ("bảng khối lượng", COLLECTION_BOQ_DOCUMENTS),
    ],
)
def test_module_names_in_both_languages_are_recognised(query: str, expected: str) -> None:
    assert expected in module_intent(query)


def test_ordinary_text_is_not_a_module_name() -> None:
    assert module_intent("contract award letter") == set()
    assert module_intent("bê tông") == set()
    assert module_intent("   ") == set()


def test_normalisation_drops_tone_marks_and_d_stroke() -> None:
    assert normalize_search_text("  Đường   GĂNG ") == "duong gang"


def test_contracts_and_boqs_are_searched_by_default() -> None:
    chosen = _normalize_types(None)
    assert COLLECTION_CONTRACTS in chosen
    assert COLLECTION_BOQ_DOCUMENTS in chosen
    assert tuple(chosen) == SEARCHABLE_COLLECTIONS
    assert _normalize_types(["contracts"]) == [COLLECTION_CONTRACTS]


@pytest_asyncio.fixture
async def seeded() -> AsyncIterator[tuple[AsyncSession, uuid.UUID]]:
    from tests._pg import transactional_session

    project_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    async with transactional_session() as s:
        s.add(User(id=owner_id, email="kw@test.io", hashed_password="x", full_name="Owner"))
        await s.flush()
        s.add(Project(id=project_id, name="Landmark 81", description="", owner_id=owner_id))
        await s.flush()
        s.add_all(
            [
                Contract(
                    id=uuid.uuid4(),
                    code="HD-001",
                    title="Thi công kết cấu phần thân",
                    project_id=project_id,
                    total_value=Decimal("1000000000"),
                    currency="VND",
                ),
                RiskItem(
                    id=uuid.uuid4(),
                    project_id=project_id,
                    code="R-001",
                    title="Chậm cấp phép xây dựng",
                    description="",
                ),
                BOQ(id=uuid.uuid4(), project_id=project_id, name="Dự toán phần thân", description=""),
            ]
        )
        await s.flush()
        yield s, project_id


@pytest.mark.asyncio
async def test_naming_the_module_lists_its_records(seeded: tuple[AsyncSession, uuid.UUID]) -> None:
    session, project_id = seeded
    for query, collection, title in (
        ("hợp đồng", COLLECTION_CONTRACTS, "Thi công kết cấu phần thân"),
        ("rủi ro", COLLECTION_RISKS, "Chậm cấp phép xây dựng"),
        ("BOQ", COLLECTION_BOQ_DOCUMENTS, "Dự toán phần thân"),
    ):
        # The record text does not contain the query, so a text match finds nothing.
        plain = await _sql_search_collection(session, collection, query, project_id=str(project_id))
        assert plain == []
        listed = await _sql_search_collection(
            session, collection, query, project_id=str(project_id), browse=True
        )
        assert [hit.title for hit in listed] == [title]
        assert all(hit.score > 0 for hit in listed)


@pytest.mark.asyncio
async def test_contract_found_by_its_code(seeded: tuple[AsyncSession, uuid.UUID]) -> None:
    session, project_id = seeded
    hits = await _sql_search_collection(session, COLLECTION_CONTRACTS, "HD-001", project_id=str(project_id))
    assert len(hits) == 1
    assert hits[0].payload["code"] == "HD-001"
    assert hits[0].module == "Contracts"


@pytest.mark.asyncio
async def test_browsing_respects_the_project_fence(seeded: tuple[AsyncSession, uuid.UUID]) -> None:
    session, _ = seeded
    hits = await _sql_search_collection(
        session, COLLECTION_CONTRACTS, "contract", allowed_project_ids=set(), browse=True
    )
    assert hits == []
