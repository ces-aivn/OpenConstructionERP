# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""A write into a locked bill is refused with a code the client can act on.

The 409 carried only a translated sentence. Adding cost items to a locked bill
from the cost database got that 409, and the dialog showed nothing: it could
not tell the refusal apart from any other failure. The refusal now carries
``code: boq_locked`` beside the sentence in the request's language, and it
still reads as that sentence wherever a caller collects ``str(exc.detail)``.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.modules.boq import locked_bill
from app.modules.boq.service import BOQService


class _Result:
    def __init__(self, row: Any) -> None:
        self._row = row

    def first(self) -> Any:
        return self._row


class _Session:
    def __init__(self, locked: bool) -> None:
        self.locked = locked

    async def execute(self, _stmt: Any) -> _Result:
        return _Result((self.locked,))


def _service(locked: bool) -> BOQService:
    service = BOQService.__new__(BOQService)
    service.session = _Session(locked)  # type: ignore[assignment]

    async def _get_boq(boq_id: uuid.UUID) -> Any:
        return SimpleNamespace(id=boq_id, is_locked=locked)

    service.get_boq = _get_boq  # type: ignore[method-assign]
    return service


@pytest.mark.parametrize("guard", ["_ensure_not_locked", "_ensure_boq_writable"])
async def test_a_write_into_a_locked_bill_is_refused_with_a_code(guard: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # The request's language, as the locale middleware would have set it.
    monkeypatch.setattr(locked_bill, "get_locale", lambda: "vi")
    with pytest.raises(HTTPException) as exc:
        await getattr(_service(True), guard)(uuid.uuid4())

    assert exc.value.status_code == 409
    body = json.loads(json.dumps({"detail": exc.value.detail}))
    assert body["detail"]["code"] == "boq_locked"
    assert body["detail"]["params"] == {}
    assert "khóa" in body["detail"]["message"]


async def test_the_refusal_still_reads_as_its_sentence() -> None:
    with pytest.raises(HTTPException) as exc:
        await _service(True)._ensure_boq_writable(uuid.uuid4())

    assert str(exc.value.detail) == "BOQ is locked and cannot be modified. Create a revision to make changes."
    assert f"delete skipped: {exc.value.detail}".endswith("Create a revision to make changes.")


async def test_an_open_bill_is_not_refused() -> None:
    await _service(False)._ensure_boq_writable(uuid.uuid4())
    await _service(False)._ensure_not_locked(uuid.uuid4())
