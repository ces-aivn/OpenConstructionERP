# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Coded refusals for the finance screens.

A refusal a person reads carries a stable ``code``, the ``field`` it is about
and the ``params`` its sentence needs, beside an English ``message``. The web
client words the code in the reader's language (``api_errors.<code>``) and
falls back to ``message`` only for a code it has no text for, so a Vietnamese
user never reads a raw English or Pydantic sentence.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status


def finance_error(
    code: str,
    message: str,
    *,
    field: str | None = None,
    status_code: int = status.HTTP_422_UNPROCESSABLE_CONTENT,
    **params: Any,
) -> HTTPException:
    """An HTTPException whose ``detail`` is ``{code, message, field, params}``."""
    detail: dict[str, Any] = {
        "code": code,
        "message": message,
        "params": {key: "" if value is None else str(value) for key, value in params.items()},
    }
    if field is not None:
        detail["field"] = field
    return HTTPException(status_code=status_code, detail=detail)


__all__ = ["finance_error"]
