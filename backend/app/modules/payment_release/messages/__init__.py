# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Locale-scoped message bundle for the rules the payment release module adds to other rule sets.

Holds the wording of the payment application findings this module registers
into ``pay_application`` (``claim_rules.py``). They live here rather than in
the shared validation bundle because that one requires every locale file it
carries to answer every key it knows; a module bundle grows one language at a
time and falls back to English for the rest.
"""

from __future__ import annotations

from pathlib import Path

from app.core.validation.messages import MessageBundle

DEFAULT_LOCALE = "en"
_bundle = MessageBundle(messages_dir=Path(__file__).parent)


def translate(key: str, locale: str = DEFAULT_LOCALE, **params: object) -> str:
    """Resolve a payment release message key for ``locale`` with ``str.format`` params."""
    return _bundle.translate(key, locale=locale, **params)


def is_key_present(key: str, locale: str = DEFAULT_LOCALE) -> bool:
    """Return ``True`` if ``key`` exists in ``locale`` without any fallback."""
    return _bundle.is_key_present(key, locale=locale)


__all__ = ["is_key_present", "translate"]
