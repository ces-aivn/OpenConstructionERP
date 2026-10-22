"""Vietnam's public holidays, its six-day planning week and the ready-made calendars.

Expected Tết and Giỗ Tổ dates are written out from published Vietnamese
almanacs (lịch vạn niên), not from the algorithm under test. The extra Quốc
khánh day is checked against the days the Government chose for 2021-2025.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.core.calendar import resolve_holidays
from app.core.calendar_vn import lunar_to_solar, vn_public_holidays, vn_statutory_holidays
from app.modules.schedule.holiday_calendars import (
    CALENDAR_PRESETS,
    MAX_PRESET_YEARS,
    default_preset_for_country,
    preset_holidays,
)
from app.modules.schedule.service import calendar_holiday_coverage, compute_duration, get_work_calendar

TET = {
    2017: date(2017, 1, 28),
    2018: date(2018, 2, 16),
    2019: date(2019, 2, 5),
    2020: date(2020, 1, 25),
    2021: date(2021, 2, 12),
    2022: date(2022, 2, 1),
    2023: date(2023, 1, 22),
    2024: date(2024, 2, 10),
    2025: date(2025, 1, 29),
    2026: date(2026, 2, 17),
}
HUNG_KINGS = {
    2022: date(2022, 4, 10),
    2023: date(2023, 4, 29),
    2024: date(2024, 4, 18),
    2025: date(2025, 4, 7),
    2026: date(2026, 4, 26),
}


@pytest.mark.parametrize(("year", "expected"), sorted(TET.items()))
def test_tet_falls_on_the_almanac_date(year: int, expected: date) -> None:
    assert lunar_to_solar(1, 1, year) == expected


def test_tet_follows_vietnamese_not_chinese_time_where_they_differ() -> None:
    assert lunar_to_solar(1, 1, 2007) == date(2007, 2, 17)
    assert lunar_to_solar(1, 1, 1985) == date(1985, 1, 21)


@pytest.mark.parametrize(("year", "expected"), sorted(HUNG_KINGS.items()))
def test_hung_kings_day_is_the_tenth_of_the_third_lunar_month(year: int, expected: date) -> None:
    assert vn_statutory_holidays(year)[expected] == "hung_kings"


def test_tet_is_five_days_from_the_last_day_of_the_old_year() -> None:
    tet = [d for d, name in vn_statutory_holidays(2024).items() if name == "tet"]
    assert sorted(tet) == [date(2024, 2, 9), date(2024, 2, 10), date(2024, 2, 11), date(2024, 2, 12), date(2024, 2, 13)]


@pytest.mark.parametrize(
    ("year", "extra"),
    [(2021, date(2021, 9, 3)), (2022, date(2022, 9, 1)), (2023, date(2023, 9, 1)),
     (2024, date(2024, 9, 3)), (2025, date(2025, 9, 1))],
)
def test_national_day_has_the_extra_day_the_government_chose(year: int, extra: date) -> None:
    days = vn_statutory_holidays(year)
    assert days[date(year, 9, 2)] == "national_day"
    assert days[extra] == "national_day"


def test_national_day_was_one_day_before_the_2019_code() -> None:
    assert [d for d, n in vn_statutory_holidays(2020).items() if n == "national_day"] == [date(2020, 9, 2)]


def test_a_sunday_holiday_is_given_back_on_the_next_working_day() -> None:
    # Giỗ Tổ 2026 is Sunday 26 April: Monday 27 April is given back.
    days = vn_public_holidays(2026)
    assert days[date(2026, 4, 27)] == "hung_kings_in_lieu"
    # On a Monday-to-Friday calendar a Saturday holiday is given back too:
    # Quốc khánh 2 September 2023 was a Saturday.
    five_day = vn_public_holidays(2023, rest_days={5, 6})
    assert five_day[date(2023, 9, 4)] == "national_day_in_lieu"


def test_core_calendar_answers_for_vietnam_on_its_own_terms() -> None:
    answer = resolve_holidays("VN", 2026)
    assert answer["jurisdiction"].answered
    assert date(2026, 2, 17) in answer["dates"] and date(2026, 9, 2) in answer["dates"]
    coverage = calendar_holiday_coverage("VN", 2026)
    assert coverage["applied"] is True


@pytest.mark.parametrize("region", ["VN", "Vietnam", "Viet Nam", "VN_HANOI"])
def test_a_vietnamese_project_plans_six_days_with_its_holidays(region: str) -> None:
    calendar = get_work_calendar(region)
    assert calendar["work_days"] == {0, 1, 2, 3, 4, 5}
    assert calendar["holiday_country"] == "VN"
    assert date(2026, 4, 30) in calendar["holidays"](2026)


def test_a_six_day_week_counts_saturdays_and_skips_the_national_day() -> None:
    # 22 Aug - 31 Oct 2022: 61 Monday-to-Saturday days less 1 and 2 September.
    assert compute_duration("2022-08-22", "2022-10-31", "Vietnam") == 59
    assert compute_duration("2022-08-22", "2022-10-31", "US") == 49


def test_presets_and_their_defaults_by_country() -> None:
    assert default_preset_for_country("vn") == "vn_6day"
    assert default_preset_for_country("US") == "us_federal"
    assert default_preset_for_country("DE") is None
    assert CALENDAR_PRESETS["vn_6day"]["work_days"] == [0, 1, 2, 3, 4, 5]
    vn = preset_holidays("vn_6day", 2025, 2026)
    assert "2025-01-29" in vn and "2026-02-17" in vn and "2026-04-27" in vn
    us = preset_holidays("us_federal", 2026, 2026)
    assert us == sorted(us) and "2026-07-03" in us and "2026-11-26" in us


def test_a_preset_refuses_a_reversed_or_huge_range() -> None:
    with pytest.raises(ValueError):
        preset_holidays("vn_6day", 2026, 2025)
    with pytest.raises(ValueError):
        preset_holidays("vn_6day", 2000, 2000 + MAX_PRESET_YEARS)
    with pytest.raises(KeyError):
        preset_holidays("mars", 2026, 2026)
