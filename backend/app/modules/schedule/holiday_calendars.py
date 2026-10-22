# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Public-holiday rosters and ready-made work calendars for the two home markets.

Vietnam
    Public holidays (Tết, Giỗ Tổ Hùng Vương, 30/4, 1/5, Quốc khánh with its
    extra day, and the days given back for a holiday on a rest day) from
    :mod:`app.core.calendar_vn`, which states the Labour Code rules it follows.

United States
    Federal holidays under 5 U.S.C. § 6103 with the Friday/Monday observed
    rule, from :func:`app.core.calendar.resolve_holidays`.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Final

from app.core.calendar_vn import vn_public_holidays

# ── Ready-made calendars ───────────────────────────────────────────────────

#: Calendars a project can start from. ``country`` names the holiday roster.
CALENDAR_PRESETS: Final[dict[str, dict[str, Any]]] = {
    "vn_6day": {
        "country": "VN",
        "work_days": [0, 1, 2, 3, 4, 5],
        "work_hours_per_day": 8,
        "name": "Vietnam, Mon-Sat 8h, public holidays",
    },
    "vn_5day": {
        "country": "VN",
        "work_days": [0, 1, 2, 3, 4],
        "work_hours_per_day": 8,
        "name": "Vietnam, Mon-Fri 8h, public holidays",
    },
    "us_federal": {
        "country": "US",
        "work_days": [0, 1, 2, 3, 4],
        "work_hours_per_day": 8,
        "name": "United States, Mon-Fri 8h, federal holidays",
    },
}

#: The preset a project of a country starts from.
_DEFAULT_PRESET_BY_COUNTRY: Final[dict[str, str]] = {"VN": "vn_6day", "US": "us_federal"}

#: Most years one preset calendar may span, so a typo in a year cannot build a
#: roster of thousands of years.
MAX_PRESET_YEARS: Final = 30


def default_preset_for_country(country: str | None) -> str | None:
    """The preset key a project in ``country`` (ISO alpha-2) defaults to, if any."""
    return _DEFAULT_PRESET_BY_COUNTRY.get((country or "").strip().upper())


def us_federal_holidays(year: int) -> frozenset[date]:
    """US federal holidays (observed dates) in ``year``."""
    from app.core.calendar import resolve_holidays

    return frozenset(resolve_holidays("US", year)["dates"])


def preset_holidays(preset: str, start_year: int, end_year: int) -> list[str]:
    """Sorted ISO holiday dates of a preset over ``start_year``..``end_year`` inclusive.

    Raises:
        KeyError: ``preset`` is not a known preset.
        ValueError: The year range is reversed or longer than :data:`MAX_PRESET_YEARS`.
    """
    spec = CALENDAR_PRESETS[preset]
    if end_year < start_year:
        raise ValueError("end_year is before start_year")
    if end_year - start_year + 1 > MAX_PRESET_YEARS:
        raise ValueError(f"a preset calendar spans at most {MAX_PRESET_YEARS} years")
    rest = frozenset(range(7)) - frozenset(spec["work_days"])
    days: set[date] = set()
    for year in range(start_year, end_year + 1):
        if spec["country"] == "VN":
            days.update(vn_public_holidays(year, rest))
        else:
            days.update(us_federal_holidays(year))
    return sorted(d.isoformat() for d in days)
