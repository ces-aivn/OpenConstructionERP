# OpenConstructionERP - DataDrivenConstruction (DDC)
# DDC-CWICR-OE-2026
"""Planned completion read from the project's 4D schedule.

The physical-progress S-curve and the earned-value planned value (PV) both
need the same figure: how much of the project the programme says should be
done by a date. The schedule already holds it. Every work-carrying activity of
the project's master schedule has a planned start and finish, and the share of
its span elapsed at a date is its planned completion. Weighted over the
activities the same way the schedule's own EVM writer weighs them (planned cost
when every leaf carries one, planned span otherwise), that is the project's
planned completion, so this module, the automatic EVM snapshots and the
schedule agree.

The planned dates are the active baseline's where one recorded the activity:
a baseline is the plan the work is measured against, while the live dates move
as the programme is re-forecast. Activities the baseline does not cover keep
their live dates.

Period labels are free text on progress entries. The ones the product writes
are ``YYYY-MM``; ``YYYY-MM-DD``, ``YYYY-Www``, ``YYYY-Qn`` and ``YYYY`` are
read as well, each as the last day of the period. Anything else has no date
and therefore no planned figure.
"""

from __future__ import annotations

import calendar
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_HUNDRED = Decimal("100")
_PCT_QUANT = Decimal("0.001")

#: Schedules whose activities are the project's programme. A baseline is a
#: frozen copy, a revision or what-if a proposal.
_PROGRAMME_TYPES = ("master",)

#: Upper bound on generated S-curve periods: fifty years of months.
MAX_GENERATED_PERIODS = 600

GRANULARITY_MONTH = "month"
GRANULARITY_WEEK = "week"
GRANULARITY_QUARTER = "quarter"

_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_WEEK_RE = re.compile(r"^(\d{4})-?W(\d{2})$", re.IGNORECASE)
_QUARTER_RE = re.compile(r"^(\d{4})-?Q([1-4])$", re.IGNORECASE)
_YEAR_RE = re.compile(r"^(\d{4})$")


# ── Period labels ────────────────────────────────────────────────────────────


def period_end(label: str) -> date | None:
    """The last day of the period a label names, or None when it names no date."""
    text = (label or "").strip()
    try:
        if m := _MONTH_RE.match(text):
            year, month = int(m.group(1)), int(m.group(2))
            return date(year, month, calendar.monthrange(year, month)[1])
        if m := _DAY_RE.match(text):
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if m := _WEEK_RE.match(text):
            return date.fromisocalendar(int(m.group(1)), int(m.group(2)), 7)
        if m := _QUARTER_RE.match(text):
            year, quarter = int(m.group(1)), int(m.group(2))
            month = quarter * 3
            return date(year, month, calendar.monthrange(year, month)[1])
        if m := _YEAR_RE.match(text):
            return date(int(m.group(1)), 12, 31)
    except ValueError:
        return None
    return None


def period_start(label: str) -> date | None:
    """The first day of the period a label names, or None when it names no date."""
    end = period_end(label)
    if end is None:
        return None
    text = (label or "").strip()
    if _MONTH_RE.match(text):
        return end.replace(day=1)
    if _WEEK_RE.match(text):
        return end - timedelta(days=6)
    if _QUARTER_RE.match(text):
        return date(end.year, end.month - 2, 1)
    if _YEAR_RE.match(text):
        return date(end.year, 1, 1)
    return end


def label_granularity(labels: list[str]) -> str | None:
    """The period kind the project's labels use, so generated periods line up with them.

    Months when there are no labels yet (the product's default), the kind of the
    first readable label otherwise, None when no label is a month, week or quarter.
    """
    if not labels:
        return GRANULARITY_MONTH
    for label in labels:
        text = (label or "").strip()
        if _MONTH_RE.match(text):
            return GRANULARITY_MONTH
        if _WEEK_RE.match(text):
            return GRANULARITY_WEEK
        if _QUARTER_RE.match(text):
            return GRANULARITY_QUARTER
    return None


def period_labels_between(start: date, end: date, granularity: str) -> list[str]:
    """Every period label from the one holding ``start`` to the one holding ``end``."""
    if end < start:
        start, end = end, start
    out: list[str] = []
    if granularity == GRANULARITY_WEEK:
        cursor = start - timedelta(days=start.weekday())
        while cursor <= end and len(out) < MAX_GENERATED_PERIODS:
            iso = cursor.isocalendar()
            out.append(f"{iso[0]:04d}-W{iso[1]:02d}")
            cursor += timedelta(days=7)
        return out
    step = 3 if granularity == GRANULARITY_QUARTER else 1
    year, month = start.year, start.month
    if step == 3:
        month = ((month - 1) // 3) * 3 + 1
    while (year, month) <= (end.year, end.month) and len(out) < MAX_GENERATED_PERIODS:
        if step == 3:
            out.append(f"{year:04d}-Q{(month - 1) // 3 + 1}")
        else:
            out.append(f"{year:04d}-{month:02d}")
        month += step
        if month > 12:
            month -= 12
            year += 1
    return out


# ── Schedule programme ───────────────────────────────────────────────────────


def _iso(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _baseline_dates(snapshot_data: object) -> dict[str, tuple[str | None, str | None]]:
    """``{activity_id: (start, finish)}`` from one baseline snapshot blob.

    The blob is caller-defined; the shapes the schedule module reads are
    accepted: an ``activities`` list, or a bare list, of entries carrying
    ``id``/``activity_id`` and the planned dates under any of their usual names.
    """
    entries = snapshot_data.get("activities") if isinstance(snapshot_data, dict) else snapshot_data
    out: dict[str, tuple[str | None, str | None]] = {}
    if not isinstance(entries, list):
        return out
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        key = entry.get("id") or entry.get("activity_id")
        if not key:
            continue
        start = entry.get("start_date") or entry.get("start") or entry.get("baseline_start")
        finish = entry.get("end_date") or entry.get("finish") or entry.get("baseline_finish")
        if _iso(start) is not None and _iso(finish) is not None:
            out[str(key)] = (str(start)[:10], str(finish)[:10])
    return out


@dataclass(frozen=True)
class ScheduleProgramme:
    """The project's programme: its activities with planned dates, and their calendars."""

    activities: list[Any]
    calendars: dict[Any, Any]
    uses_baseline: bool

    @property
    def empty(self) -> bool:
        return not self.activities

    def span(self) -> tuple[date, date] | None:
        """First planned start and last planned finish over the activities."""
        starts = [d for a in self.activities if (d := _iso(a.start_date)) is not None]
        ends = [d for a in self.activities if (d := _iso(a.end_date)) is not None]
        if not starts or not ends:
            return None
        return min(starts), max(ends)

    def fractions(self, as_of: date) -> tuple[Decimal, Decimal] | None:
        """``(earned, planned)`` completion as fractions of 1 at ``as_of``, None without work."""
        from app.core.event_handlers import schedule_progress_fractions

        if not self.activities:
            return None
        return schedule_progress_fractions(
            self.activities,
            as_of=as_of,
            calendar_for=lambda activity: self.calendars[activity.calendar_id],
        )

    def planned_pct(self, as_of: date) -> Decimal | None:
        """Planned completion in percent (0..100, 3 dp) at ``as_of``, None without work."""
        result = self.fractions(as_of)
        if result is None:
            return None
        return (result[1] * _HUNDRED).quantize(_PCT_QUANT)

    def earned_pct(self, as_of: date) -> Decimal | None:
        """Completion the activities report, in percent, None without work."""
        result = self.fractions(as_of)
        if result is None:
            return None
        return (result[0] * _HUNDRED).quantize(_PCT_QUANT)


async def load_schedule_programme(session: AsyncSession, project_id: uuid.UUID) -> ScheduleProgramme:
    """Read the project's master-schedule activities, baseline dates applied.

    Falls back to every schedule of the project when it has no master schedule,
    so a project whose only schedule was imported under another type still has
    a plan. Any read failure degrades to an empty programme: a plan line that
    cannot be drawn must not break the page that draws the actual one.
    """
    try:
        from app.modules.schedule.models import Activity, Schedule, ScheduleBaseline
        from app.modules.schedule.progress_service import ScheduleProgressService

        schedules = (
            await session.execute(select(Schedule.id, Schedule.schedule_type).where(Schedule.project_id == project_id))
        ).all()
        programme_ids = [sid for sid, kind in schedules if (kind or "master") in _PROGRAMME_TYPES]
        if not programme_ids:
            programme_ids = [sid for sid, _kind in schedules]
        if not programme_ids:
            return ScheduleProgramme(activities=[], calendars={}, uses_baseline=False)

        rows = (
            await session.execute(
                select(
                    Activity.id,
                    Activity.parent_id,
                    Activity.activity_type,
                    Activity.cost_planned,
                    Activity.start_date,
                    Activity.end_date,
                    Activity.progress_pct,
                    Activity.calendar_id,
                ).where(Activity.schedule_id.in_(programme_ids))
            )
        ).all()

        baseline_rows = (
            await session.execute(
                select(ScheduleBaseline.schedule_id, ScheduleBaseline.baseline_date, ScheduleBaseline.snapshot_data)
                .where(ScheduleBaseline.project_id == project_id, ScheduleBaseline.is_active.is_(True))
                .order_by(ScheduleBaseline.baseline_date.asc())
            )
        ).all()
        planned_dates: dict[str, tuple[str | None, str | None]] = {}
        for schedule_id, _baseline_date, blob in baseline_rows:
            if schedule_id is not None and schedule_id not in programme_ids:
                continue
            # Later baselines win: they are the plan currently measured against.
            planned_dates.update(_baseline_dates(blob))

        activities: list[Any] = []
        uses_baseline = False
        for row in rows:
            start, end = row.start_date, row.end_date
            dates = planned_dates.get(str(row.id))
            if dates is not None:
                start, end = dates
                uses_baseline = True
            activities.append(
                SimpleNamespace(
                    id=row.id,
                    parent_id=row.parent_id,
                    activity_type=row.activity_type,
                    cost_planned=row.cost_planned,
                    start_date=start,
                    end_date=end,
                    progress_pct=row.progress_pct,
                    calendar_id=row.calendar_id,
                )
            )

        resolver = ScheduleProgressService(session)
        calendars: dict[Any, Any] = {}
        for calendar_id in {a.calendar_id for a in activities}:
            calendars[calendar_id] = await resolver.resolve_calendar(calendar_id)
        return ScheduleProgramme(activities=activities, calendars=calendars, uses_baseline=uses_baseline)
    except Exception:
        logger.warning("Could not read the schedule programme for project %s", project_id, exc_info=True)
        return ScheduleProgramme(activities=[], calendars={}, uses_baseline=False)
