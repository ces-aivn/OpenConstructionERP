"""A record raised from a BOQ validation run is worded in the project's language.

It used to be titled "Validation errors in BOQ (13)" in English on a Vietnamese
project, and read as a quality non-conformance. The title now names the BOQ
validation as its source, follows the project's language, and carries a key
and params a client can render in the reader's own language.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.modules.ncr import events as ncr_events
from tests.unit.test_ncr_validation_bridge import _FakeSession, _validation_event, store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("locale", "title", "intro"),
    [
        ("vi", "Phát hiện từ kiểm tra BOQ (2)", "Tự động tạo từ một lần kiểm tra BOQ có 2 lỗi chặn."),
        ("en-US", "BOQ validation findings (2)", "Raised automatically from a BOQ validation run with 2 blocking error(s)."),
        ("de", "BOQ validation findings (2)", "Raised automatically"),
    ],
)
async def test_the_title_follows_the_project_language(store, monkeypatch, locale, title, intro):  # noqa: F811
    async def _get(self, _model, _pk):
        return SimpleNamespace(locale=locale)

    monkeypatch.setattr(_FakeSession, "get", _get, raising=False)
    await ncr_events._on_validation_errors_found(
        _validation_event(project_id=uuid.uuid4(), report_id=uuid.uuid4(), error_count=2)
    )
    assert len(store) == 1
    ncr = store[0]
    assert ncr.title == title
    assert ncr.description.startswith(intro)
    assert ncr.metadata_["title_key"] == "ncr.validation_title"
    assert ncr.metadata_["title_params"] == {"count": 2}


@pytest.mark.asyncio
async def test_an_unreadable_project_falls_back_to_english(store):  # noqa: F811
    await ncr_events._on_validation_errors_found(
        _validation_event(project_id=uuid.uuid4(), report_id=uuid.uuid4(), error_count=1)
    )
    assert store[0].title == "BOQ validation findings (1)"
