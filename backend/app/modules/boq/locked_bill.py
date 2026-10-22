# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The refusal a locked bill of quantities answers a write with.

The 409 used to carry only a translated sentence. A client could not tell a
locked bill from any other conflict without reading the sentence, so the cost
database's "Add to BOQ" dialog swallowed it and left the user with nothing.
The refusal now carries the stable code ``boq_locked`` beside the sentence, in
the ``{code, message, params}`` shape the web client reads coded errors from.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from app.core.i18n import get_locale
from app.core.validation.messages import translate

BOQ_LOCKED_CODE = "boq_locked"


class CodedDetail(dict[str, Any]):
    """An error body ``{code, message, params}`` that still reads as its message.

    Callers that collect a refusal into a per-row error list write
    ``str(exc.detail)``; for this body that is the sentence, not the dict.
    """

    def __str__(self) -> str:
        return str(self.get("message", ""))


def boq_locked_error() -> HTTPException:
    """The 409 for a write into a locked bill, coded and in the request's language."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=CodedDetail(
            code=BOQ_LOCKED_CODE,
            message=translate("errors.boq_locked", locale=get_locale()),
            params={},
        ),
    )
