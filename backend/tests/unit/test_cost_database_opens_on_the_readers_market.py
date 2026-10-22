"""The cost database opens on the base of the reader's market.

A Vietnamese reader on a project in Vietnam used to land on "All regions",
where a demo German base priced in euro came first. The preferred base is
chosen from the project's currency or country, then the interface language,
and only among loaded bases priced in that currency.
"""

from __future__ import annotations

from app.modules.costs.preferred_region import (
    MarketHint,
    market_hint,
    pick_preferred_region,
    region_country_table,
)
from app.modules.costs.region_currency import REGION_CURRENCY

LOADED = [("DE_BERLIN", 55_000), ("VI_HANOI", 55_719), ("VN_NATIONAL", 4_299), ("USA_USD", 40_000), ("CUSTOM", 12)]


def _pick(hint: MarketHint) -> str:
    return pick_preferred_region(
        LOADED, hint, region_currency=REGION_CURRENCY, region_country=region_country_table()
    )


def test_a_vietnamese_project_opens_on_the_largest_vnd_base() -> None:
    hint = market_hint(project_currency="VND", project_country="VN", language="en")
    assert hint == MarketHint(currency="VND", country="VN", source="project")
    assert _pick(hint) == "VI_HANOI"


def test_a_us_project_opens_on_the_usd_base_even_for_a_vietnamese_reader() -> None:
    hint = market_hint(project_currency="", project_country="US", language="vi")
    assert hint is not None and hint.currency == "USD"
    assert _pick(hint) == "USA_USD"


def test_without_a_project_the_interface_language_decides() -> None:
    vi = market_hint(language="vi")
    en = market_hint(language="en-US")
    assert vi == MarketHint(currency="VND", country="VN", source="language")
    assert en is not None and en.currency == "USD"
    assert _pick(vi) == "VI_HANOI"
    assert _pick(en) == "USA_USD"


def test_never_another_markets_prices() -> None:
    only_eu = [("DE_BERLIN", 55_000), ("CUSTOM", 3)]
    hint = MarketHint(currency="VND", country="VN", source="language")
    assert (
        pick_preferred_region(only_eu, hint, region_currency=REGION_CURRENCY, region_country=region_country_table())
        == ""
    )


def test_unknown_language_and_no_project_give_no_hint() -> None:
    assert market_hint(language="de") is None
    assert market_hint() is None


def test_same_country_wins_over_size() -> None:
    loaded = [("USA_NEWYORK", 90_000), ("USA_USD", 10_000)]
    hint = MarketHint(currency="USD", country="US", source="project")
    assert (
        pick_preferred_region(loaded, hint, region_currency=REGION_CURRENCY, region_country=region_country_table())
        == "USA_USD"
    )
