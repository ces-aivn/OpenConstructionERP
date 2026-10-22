# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Vietnamese public holidays and the lunar calendar they depend on.

Bộ luật Lao động 2019 (Labour Code No. 45/2019/QH14), Điều 112, effective
1 January 2021, gives these paid public holidays:

* Tết Dương lịch, 1 January, one day;
* Tết Âm lịch (Tết Nguyên đán), five days;
* Giỗ Tổ Hùng Vương, the 10th day of the 3rd lunar month, one day;
* Ngày Chiến thắng, 30 April, one day;
* Ngày Quốc tế lao động, 1 May, one day;
* Quốc khánh, 2 September plus one day immediately before or after it.

The Code fixes how many Tết days there are, not which; the common
arrangement, and the one used here, is the last day of the lunar year and the
first four days of the new one. The extra Quốc khánh day is the neighbour of
2 September that joins it to the weekend, which is the day the Government
chose in 2021 to 2025. Earlier codes are followed for earlier years: Quốc
khánh was one day before 2021, Giỗ Tổ became a holiday in 2007 and Tết was
four days before 2013.

Điều 111(3): a public holiday falling on the weekly rest day is given back on
the next working day (nghỉ bù). Điều 111(2) makes Sunday the rest day when the
employer has not set another, so the roster :data:`app.core.calendar` serves
gives days back for Sunday holidays; a calendar with other rest days asks
:func:`vn_public_holidays` with its own.

The Government publishes the exact arrangement each year (moved working days
for the civil service, sometimes a different pair of Tết days); a calendar
built from these rules is a starting point the planner can edit.

Lunar dates are computed with Hồ Ngọc Đức's astronomical algorithm on Vietnam
time (UTC+7), the method behind Vietnamese almanacs; it gives Tết on the
Vietnamese date where it differs from the Chinese one (1985, 2007).
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from datetime import date, timedelta
from typing import Final

_VN_TIMEZONE: Final = 7.0
_SYNODIC_MONTH: Final = 29.530588853
_EPOCH_NEW_MOON_JD: Final = 2415021.076998695


# ── Vietnamese lunar calendar (Hồ Ngọc Đức) ──────────────────────────────


def _jd_from_date(day: int, month: int, year: int) -> int:
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    jd = day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
    if jd < 2299161:
        jd = day + (153 * m + 2) // 5 + 365 * y + y // 4 - 32083
    return jd


def _date_from_jd(jd: int) -> date:
    if jd > 2299160:
        a = jd + 32044
        b = (4 * a + 3) // 146097
        c = a - (b * 146097) // 4
    else:
        b = 0
        c = jd + 32082
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = b * 100 + d - 4800 + m // 10
    return date(year, month, day)


def _new_moon(k: int) -> float:
    """Julian day (fractional, UT) of the k-th new moon after 1900-01-01."""
    t = k / 1236.85
    t2 = t * t
    t3 = t2 * t
    dr = math.pi / 180
    jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3
    jd1 += 0.00033 * math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr)
    m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3
    mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3
    f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3
    c1 = (0.1734 - 0.000393 * t) * math.sin(m * dr) + 0.0021 * math.sin(2 * dr * m)
    c1 = c1 - 0.4068 * math.sin(mpr * dr) + 0.0161 * math.sin(dr * 2 * mpr)
    c1 = c1 - 0.0004 * math.sin(dr * 3 * mpr)
    c1 = c1 + 0.0104 * math.sin(dr * 2 * f) - 0.0051 * math.sin(dr * (m + mpr))
    c1 = c1 - 0.0074 * math.sin(dr * (m - mpr)) + 0.0004 * math.sin(dr * (2 * f + m))
    c1 = c1 - 0.0004 * math.sin(dr * (2 * f - m)) - 0.0006 * math.sin(dr * (2 * f + mpr))
    c1 = c1 + 0.0010 * math.sin(dr * (2 * f - mpr)) + 0.0005 * math.sin(dr * (2 * mpr + m))
    if t < -11:
        delta_t = 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3
    else:
        delta_t = -0.000278 + 0.000265 * t + 0.000262 * t2
    return jd1 + c1 - delta_t


def _new_moon_day(k: int, tz: float) -> int:
    return math.floor(_new_moon(k) + 0.5 + tz / 24)


def _sun_longitude_sector(day_number: int, tz: float) -> int:
    """The sun's longitude at local midnight, in twelfths of a circle (0..11)."""
    jdn = day_number - 0.5 - tz / 24
    t = (jdn - 2451545.0) / 36525
    t2 = t * t
    dr = math.pi / 180
    m = 357.52910 + 35999.05030 * t - 0.0001559 * t2 - 0.00000048 * t * t2
    l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2
    dl = (1.914600 - 0.004817 * t - 0.000014 * t2) * math.sin(dr * m)
    dl += (0.019993 - 0.000101 * t) * math.sin(dr * 2 * m) + 0.000290 * math.sin(dr * 3 * m)
    longitude = (l0 + dl) * dr
    longitude -= math.pi * 2 * math.floor(longitude / (math.pi * 2))
    return math.floor(longitude / math.pi * 6)


def _lunar_month_11(year: int, tz: float) -> int:
    """Day number of the start of the 11th lunar month (the one holding the winter solstice)."""
    off = _jd_from_date(31, 12, year) - 2415021
    k = math.floor(off / _SYNODIC_MONTH)
    nm = _new_moon_day(k, tz)
    if _sun_longitude_sector(nm, tz) >= 9:
        nm = _new_moon_day(k - 1, tz)
    return nm


def _leap_month_offset(a11: int, tz: float) -> int:
    k = math.floor((a11 - _EPOCH_NEW_MOON_JD) / _SYNODIC_MONTH + 0.5)
    i = 1
    arc = _sun_longitude_sector(_new_moon_day(k + i, tz), tz)
    while True:
        last = arc
        i += 1
        arc = _sun_longitude_sector(_new_moon_day(k + i, tz), tz)
        if arc == last or i >= 14:
            break
    return i - 1


def lunar_to_solar(lunar_day: int, lunar_month: int, lunar_year: int, *, tz: float = _VN_TIMEZONE) -> date:
    """The Gregorian date of a (non-leap) Vietnamese lunar date.

    Args:
        lunar_day: 1..30.
        lunar_month: 1..12, the ordinary (not the leap) month of that number.
        lunar_year: The lunar year, numbered as the Gregorian year it mostly falls in.
        tz: Hours east of UTC the calendar is reckoned in (7 for Vietnam).
    """
    if lunar_month < 11:
        a11 = _lunar_month_11(lunar_year - 1, tz)
        b11 = _lunar_month_11(lunar_year, tz)
    else:
        a11 = _lunar_month_11(lunar_year, tz)
        b11 = _lunar_month_11(lunar_year + 1, tz)
    k = math.floor(0.5 + (a11 - _EPOCH_NEW_MOON_JD) / _SYNODIC_MONTH)
    off = lunar_month - 11
    if off < 0:
        off += 12
    if b11 - a11 > 365 and off >= _leap_month_offset(a11, tz):
        off += 1
    month_start = _new_moon_day(k + off, tz)
    return _date_from_jd(month_start + lunar_day - 1)


# ── Vietnam ────────────────────────────────────────────────────────────────

#: Rest day of the six-day week Vietnamese construction sites work.
VN_REST_DAYS: Final[frozenset[int]] = frozenset({6})


def _national_day_extra(year: int) -> date:
    """The day joined to 2 September: the neighbour that touches the weekend."""
    national = date(year, 9, 2)
    # Mon -> Tue (Sunday is already off), Tue/Wed -> Mon/Tue before,
    # Thu -> Fri, Fri/Sat -> the day before, Sun -> Monday.
    after = national.weekday() in (0, 3, 6)
    return national + timedelta(days=1 if after else -1)


def vn_statutory_holidays(year: int) -> dict[date, str]:
    """Vietnam's public holidays in ``year`` before any day given back, by date.

    Values are stable keys (``new_year``, ``tet``, ``hung_kings``,
    ``reunification``, ``labour_day``, ``national_day``) a screen can name.
    """
    if year < 1900 or year > 2199:
        raise ValueError(f"Vietnamese holidays are computed for 1900-2199, not {year}")
    days: dict[date, str] = {date(year, 1, 1): "new_year"}
    tet = lunar_to_solar(1, 1, year)
    tet_days_after = 4 if year >= 2013 else 3
    for offset in range(-1, tet_days_after):
        days[tet + timedelta(days=offset)] = "tet"
    if year >= 2007:
        days[lunar_to_solar(10, 3, year)] = "hung_kings"
    days[date(year, 4, 30)] = "reunification"
    days[date(year, 5, 1)] = "labour_day"
    days[date(year, 9, 2)] = "national_day"
    if year >= 2021:
        days[_national_day_extra(year)] = "national_day"
    return days


def vn_public_holidays(year: int, rest_days: Iterable[int] = VN_REST_DAYS) -> dict[date, str]:
    """Vietnam's days off for public holidays in ``year``, days given back included.

    A holiday on a rest day is given back on the next day that is neither a
    rest day nor a holiday (Labour Code 2019, Điều 111(3)); the day given back
    carries the holiday's key with ``_in_lieu`` appended.

    Args:
        year: Gregorian year, 1900-2199.
        rest_days: Weekly rest days of the calendar, Mon=0..Sun=6.
    """
    rest = frozenset(rest_days)
    statutory = vn_statutory_holidays(year)
    days = dict(statutory)
    for day in sorted(statutory):
        if day.weekday() not in rest:
            continue
        lieu = day + timedelta(days=1)
        while lieu.weekday() in rest or lieu in days:
            lieu += timedelta(days=1)
        days[lieu] = f"{statutory[day]}_in_lieu"
    return days
