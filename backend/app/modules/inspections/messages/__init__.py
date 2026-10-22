# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Locale-scoped message bundle of the inspections module.

Holds the wording of the checklist templates (``checklist_templates.py``): a
template's name and the text of each item, in English and Vietnamese. A
language without a file falls back to English per key.
"""

from __future__ import annotations

from pathlib import Path

from app.core.validation.messages import MessageBundle

DEFAULT_LOCALE = "en"
_bundle = MessageBundle(messages_dir=Path(__file__).parent)


def translate(key: str, locale: str = DEFAULT_LOCALE, **params: object) -> str:
    """Resolve an inspections message key for ``locale`` with ``str.format`` params."""
    return _bundle.translate(key, locale=locale, **params)


def is_key_present(key: str, locale: str = DEFAULT_LOCALE) -> bool:
    """Return ``True`` if ``key`` exists in ``locale`` without any fallback."""
    return _bundle.is_key_present(key, locale=locale)


__all__ = ["is_key_present", "translate"]
