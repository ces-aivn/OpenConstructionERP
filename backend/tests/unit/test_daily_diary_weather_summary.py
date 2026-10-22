"""A site diary records its day's weather, in metric, within plausible ranges.

The create and edit forms now send a ``weather_summary`` snapshot with the
keys the PDF export and the insights panel read (``conditions``, ``temp_c``,
``precipitation_mm``, ``wind_kmh``). The schema keeps the snapshot open to
other keys but refuses a reading that is not a number or is outside a
plausible range, which is what a unit mix-up looks like on a signed record.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.daily_diary.pdf_translations import weather_summary_text
from app.modules.daily_diary.schemas import DailyDiaryCreate, DailyDiaryUpdate


def test_the_form_snapshot_is_accepted_and_renders_on_the_record() -> None:
    summary = {"conditions": "rain_heavy", "temp_c": 14.5, "precipitation_mm": 32.0, "wind_kmh": 25.7}
    created = DailyDiaryCreate(project_id=uuid.uuid4(), diary_date="2020-01-15", weather_summary=summary)
    assert created.weather_summary == summary
    line = weather_summary_text(created.weather_summary, "en")
    assert line.startswith("14.5 °C, heavy rain")


def test_other_keys_pass_through_untouched() -> None:
    upd = DailyDiaryUpdate(weather_summary={"temp_c": 20, "source": "sensor", "humidity_pct": 60})
    assert upd.weather_summary == {"temp_c": 20, "source": "sensor", "humidity_pct": 60}


@pytest.mark.parametrize(
    "summary",
    [
        {"temp_c": 95},  # Fahrenheit typed into the Celsius key
        {"precipitation_mm": -1},
        {"wind_kmh": "strong"},
        {"temp_c": True},
        {"conditions": "x" * 81},
    ],
)
def test_an_implausible_reading_is_refused(summary: dict) -> None:
    with pytest.raises(ValidationError):
        DailyDiaryUpdate(weather_summary=summary)
