# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Planned and earned value of a project from its progress and its programme.

Earned value is the budget of the work performed, ``EV = BAC x % complete``,
and planned value the budget of the work scheduled by the status date,
``PV = BAC x planned % at that date``. Neither is a cost figure: a commitment
says what was bought, not what was built, and the whole budget is planned only
once the last activity is due. A snapshot that reads EV off commitments and PV
off the full budget reports a project with a third of its work bought as a
project three percent on schedule.

Where the percentages come from, most direct first:

* Complete: the physical-progress rollup (``/progress``), the BOQ-weighted
  latest reading of every measured line as of the status date; else the
  progress the 4D master schedule's activities report; else nothing is earned.
* Planned: the 4D master schedule, active baseline dates first, weighted the
  way the schedule's own EVM writer weighs it; else the planned S-curve points
  entered on the progress page; else a straight line between the project's
  planned start and finish; else no plan, and PV is zero with the source
  recorded as ``none`` so a reader can tell "no plan" from "nothing planned".

The source of each figure travels with the result so a snapshot can say what
it was measured against.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.money import money_quantum
from app.modules.progress.schedule_plan import load_schedule_programme, period_end, period_start

logger = logging.getLogger(__name__)

_ZERO = Decimal("0")
_HUNDRED = Decimal("100")
_PCT_QUANT = Decimal("0.01")

EARNED_PHYSICAL_PROGRESS = "physical_progress"
EARNED_SCHEDULE_PROGRESS = "schedule_progress"
EARNED_NONE = "none"

PLANNED_SCHEDULE_BASELINE = "schedule_baseline"
PLANNED_SCHEDULE = "schedule"
PLANNED_PROGRESS_PLAN = "progress_plan"
PLANNED_PROJECT_DATES = "project_dates"
PLANNED_NONE = "none"


@dataclass(frozen=True)
class ProgressBaseline:
    """Percent complete and percent planned (0..100) at a status date, with their sources."""

    as_of: date
    earned_pct: Decimal
    earned_source: str
    planned_pct: Decimal | None
    planned_source: str


@dataclass(frozen=True)
class PlannedEarnedValue:
    """PV and EV in the project currency, and what they were measured against."""

    pv: Decimal
    ev: Decimal
    baseline: ProgressBaseline

    def metadata(self) -> dict[str, str]:
        """Snapshot metadata describing the derivation."""
        b = self.baseline
        return {
            "earned_pct": str(b.earned_pct.quantize(_PCT_QUANT, rounding=ROUND_HALF_UP)),
            "earned_source": b.earned_source,
            "planned_pct": (
                "" if b.planned_pct is None else str(b.planned_pct.quantize(_PCT_QUANT, rounding=ROUND_HALF_UP))
            ),
            "planned_source": b.planned_source,
            "status_date": b.as_of.isoformat(),
        }


def _clamp_pct(value: Decimal) -> Decimal:
    return max(_ZERO, min(_HUNDRED, value))


def _iso(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _in_effect(label: str, as_of: date) -> bool:
    """A period counts at ``as_of`` once it has begun; a label with no date always counts."""
    start = period_start(label)
    return start is None or start <= as_of


def linear_planned_pct(start: date | None, finish: date | None, as_of: date) -> Decimal | None:
    """Planned percent on a straight line between two dates, None without both dates."""
    if start is None or finish is None:
        return None
    if finish < start:
        start, finish = finish, start
    if as_of <= start:
        return _ZERO
    if as_of >= finish:
        return _HUNDRED
    span = (finish - start).days
    return (Decimal((as_of - start).days) / Decimal(span) * _HUNDRED) if span > 0 else _HUNDRED


async def _physical_pct(session: AsyncSession, project_id: uuid.UUID, as_of: date) -> Decimal | None:
    """The physical-progress rollup at ``as_of``, None when nothing was recorded by then."""
    from app.modules.progress.service import ProgressService

    cumulative = await ProgressService(session).get_cumulative(project_id)
    in_effect = [p for p in cumulative.periods if _in_effect(p.period_label, as_of)]
    if not in_effect:
        return None
    return _clamp_pct(Decimal(str(in_effect[-1].cumulative_pct)))


async def _manual_plan_pct(session: AsyncSession, project_id: uuid.UUID, as_of: date) -> Decimal | None:
    """The entered S-curve plan at ``as_of``: the last point whose period has ended, else 0."""
    from app.modules.progress.repository import ProgressRepository

    points = await ProgressRepository(session).list_plan(project_id)
    if not points:
        return None
    reached = _ZERO
    for point in points:
        end = period_end(point.period_label)
        if end is not None and end <= as_of:
            reached = _clamp_pct(Decimal(str(point.planned_pct)))
    return reached


async def load_progress_baseline(session: AsyncSession, project_id: uuid.UUID, as_of: date) -> ProgressBaseline:
    """Percent complete and percent planned of a project at ``as_of``."""
    programme = await load_schedule_programme(session, project_id)

    earned_source = EARNED_NONE
    earned: Decimal = _ZERO
    try:
        physical = await _physical_pct(session, project_id, as_of)
    except Exception:
        logger.warning("Physical progress unreadable for project %s", project_id, exc_info=True)
        physical = None
    if physical is not None:
        earned, earned_source = physical, EARNED_PHYSICAL_PROGRESS
    else:
        reported = programme.earned_pct(as_of)
        if reported is not None and reported > _ZERO:
            earned, earned_source = _clamp_pct(reported), EARNED_SCHEDULE_PROGRESS

    planned = programme.planned_pct(as_of)
    planned_source = PLANNED_SCHEDULE_BASELINE if programme.uses_baseline else PLANNED_SCHEDULE
    if planned is None:
        planned_source = PLANNED_NONE
        try:
            planned = await _manual_plan_pct(session, project_id, as_of)
        except Exception:
            logger.warning("Progress plan unreadable for project %s", project_id, exc_info=True)
            planned = None
        if planned is not None:
            planned_source = PLANNED_PROGRESS_PLAN
        else:
            from app.modules.projects.models import Project

            project = await session.get(Project, project_id)
            planned = linear_planned_pct(
                _iso(getattr(project, "planned_start_date", None)),
                _iso(getattr(project, "planned_end_date", None)),
                as_of,
            )
            if planned is not None:
                planned_source = PLANNED_PROJECT_DATES

    return ProgressBaseline(
        as_of=as_of,
        earned_pct=earned,
        earned_source=earned_source,
        planned_pct=None if planned is None else _clamp_pct(planned),
        planned_source=planned_source,
    )


def planned_earned_from(baseline: ProgressBaseline, *, bac: Decimal, currency: str) -> PlannedEarnedValue:
    """PV and EV of ``bac`` at the baseline's percentages, rounded once to the currency."""
    quantum = money_quantum(currency)
    ev = (bac * baseline.earned_pct / _HUNDRED).quantize(quantum, rounding=ROUND_HALF_UP)
    planned = baseline.planned_pct if baseline.planned_pct is not None else _ZERO
    pv = (bac * planned / _HUNDRED).quantize(quantum, rounding=ROUND_HALF_UP)
    return PlannedEarnedValue(pv=pv, ev=ev, baseline=baseline)


async def derive_pv_ev(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    bac: Decimal,
    as_of: date | str,
    currency: str,
) -> PlannedEarnedValue:
    """Planned and earned value of a project's budget at completion on a status date.

    Args:
        session: Open database session.
        project_id: Project to measure.
        bac: Budget at completion in the project currency.
        as_of: Status date, a date or an ISO string (``YYYY-MM-DD`` prefix).
        currency: Project currency code, for rounding.

    Returns:
        PV and EV rounded to the currency, and the percentages behind them.

    Raises:
        ValueError: ``as_of`` is not an ISO date.
    """
    status_date = as_of if isinstance(as_of, date) else date.fromisoformat(str(as_of)[:10])
    baseline = await load_progress_baseline(session, project_id, status_date)
    return planned_earned_from(baseline, bac=bac, currency=currency)
