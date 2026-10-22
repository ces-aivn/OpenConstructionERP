# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Which loaded cost base a reader should see first.

The cost database used to open on "All regions", which lists rows of every
installed base mixed together. On an install that also carries a demo German
base, a Vietnamese reader working on a project in Vietnam saw German items
priced in euro before anything Vietnamese. The page now opens on the base of
the reader's market:

1. the active project's currency, or the currency of its country;
2. otherwise the market of the interface language (``vi`` reads in VND,
   ``en`` in USD - the two markets this build serves);

and among the loaded bases in that currency, the one whose country matches,
then the largest. Nothing is guessed when no loaded base is in that currency:
the answer is empty and the page keeps its own default.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

#: The two markets this build serves, by country and by interface language.
COUNTRY_CURRENCY: dict[str, str] = {"VN": "VND", "US": "USD"}
LANGUAGE_CURRENCY: dict[str, str] = {"vi": "VND", "en": "USD"}
LANGUAGE_COUNTRY: dict[str, str] = {"vi": "VN", "en": "US"}

#: Region tags that are never a market base.
_NOT_A_BASE = frozenset({"CUSTOM"})


@dataclass(frozen=True, slots=True)
class MarketHint:
    """What the reader's context says about their market."""

    currency: str
    country: str | None
    source: str  # "project" | "language"


def market_hint(
    *,
    project_currency: str | None = None,
    project_country: str | None = None,
    language: str | None = None,
) -> MarketHint | None:
    """Resolve the market currency from the project first, then the language."""
    currency = (project_currency or "").strip().upper()
    country = (project_country or "").strip().upper() or None
    if not currency and country:
        currency = COUNTRY_CURRENCY.get(country, "")
    if currency:
        return MarketHint(currency=currency, country=country, source="project")
    lang = (language or "").strip().lower().split("-")[0]
    if lang in LANGUAGE_CURRENCY:
        return MarketHint(currency=LANGUAGE_CURRENCY[lang], country=LANGUAGE_COUNTRY[lang], source="language")
    return None


def pick_preferred_region(
    region_counts: Iterable[tuple[str, int]],
    hint: MarketHint,
    *,
    region_currency: Mapping[str, str],
    region_country: Mapping[str, str],
) -> str:
    """The loaded base to open on for *hint*, or ``""`` when none fits.

    Args:
        region_counts: ``(region, active rows)`` for every loaded region.
        hint: The reader's market.
        region_currency: ``{region: ISO 4217}``.
        region_country: ``{region: ISO 3166-1 alpha-2, upper case}``.
    """
    candidates: list[tuple[int, int, str]] = []
    for region, count in region_counts:
        if not region or region in _NOT_A_BASE or region.startswith("__") or count <= 0:
            continue
        if (region_currency.get(region) or "").upper() != hint.currency:
            continue
        same_country = 1 if hint.country and region_country.get(region, "").upper() == hint.country else 0
        candidates.append((same_country, int(count), region))
    if not candidates:
        return ""
    # Same country first, then the largest base, then a stable name order.
    candidates.sort(key=lambda c: (-c[0], -c[1], c[2]))
    return candidates[0][2]


def region_country_table() -> dict[str, str]:
    """``{region: country}`` for every loadable base, from the base registry."""
    from app.modules.costs import base_registry

    out: dict[str, str] = {}
    for variant in base_registry.iter_variants():
        flag = (getattr(variant, "flag", "") or "").upper()
        region = getattr(variant, "region", "")
        if region and flag:
            out[region] = flag
    return out
