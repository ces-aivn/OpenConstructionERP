"""Submitting a submittal: error-level checks block it, and the date is the real one.

A check of ERROR severity (no reviewer, no required date, a date that cannot be
true) used to be logged and the submission went through anyway, so the register
filled with submittals in nobody's court. The submission date was always
stamped as today, so a register backfilled from paper could not record when a
package actually went in. The Vietnamese reader also got two findings in
English because the module's message bundle carried no Vietnamese.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.core.validation.rules import register_builtin_rules
from app.modules.submittals.messages import is_key_present, translate
from app.modules.submittals.rules import SUBMITTAL_REGISTER_RULES, register_submittal_register_rules
from app.modules.submittals.schemas import SubmittalCreate, SubmittalUpdate
from tests.unit.test_submittals import _make_service


@pytest.fixture(autouse=True)
def _rules() -> None:
    register_builtin_rules()
    register_submittal_register_rules()


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _tomorrow() -> str:
    """A day that is in the future in every time zone (UTC+14 is at most one day ahead)."""
    return (datetime.now(UTC).date() + timedelta(days=2)).isoformat()


async def _draft(service, **overrides):
    data = {
        "project_id": uuid.uuid4(),
        "title": "ETFE cushion roof",
        "submittal_type": "shop_drawing",
        "spec_section": "07 42 63",
        "reviewer_id": str(uuid.uuid4()),
        "date_required": "2999-01-31",
    }
    data.update(overrides)
    row = await service.create_submittal(SubmittalCreate(**data))
    row.status = "draft"
    row.current_revision = 0
    return row


@pytest.mark.asyncio
async def test_a_submittal_without_a_reviewer_is_not_submitted() -> None:
    service = _make_service()
    row = await _draft(service, reviewer_id=None)
    with pytest.raises(HTTPException) as exc_info:
        await service.submit_submittal(row.id)
    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert detail["code"] == "submittal_validation_blocked"
    assert detail["rules"] == ["submittal.reviewer_assigned"]
    assert detail["params"] == {"count": 1}
    assert row.status == "draft"


@pytest.mark.asyncio
async def test_a_required_on_site_date_before_the_submission_blocks_it() -> None:
    service = _make_service()
    row = await _draft(service, required_on_site_date="2018-02-01")
    with pytest.raises(HTTPException) as exc_info:
        await service.submit_submittal(row.id, date_submitted="2018-03-01")
    assert "submittal.required_on_site_after_submitted" in exc_info.value.detail["rules"]


@pytest.mark.asyncio
async def test_warnings_alone_do_not_block() -> None:
    service = _make_service()
    row = await _draft(service, spec_section=None)
    result = await service.submit_submittal(row.id)
    assert result.status == "submitted"
    assert result.date_submitted == _today()


@pytest.mark.asyncio
async def test_a_historical_submission_keeps_its_real_date() -> None:
    service = _make_service()
    row = await _draft(service, date_required="2017-08-10")
    result = await service.submit_submittal(row.id, date_submitted="2017-07-20")
    assert result.status == "submitted"
    assert result.date_submitted == "2017-07-20"


@pytest.mark.asyncio
async def test_a_draft_submits_on_the_date_recorded_on_it() -> None:
    service = _make_service()
    row = await _draft(service, date_required="2017-08-10", date_submitted="2017-07-20")
    result = await service.submit_submittal(row.id)
    assert result.date_submitted == "2017-07-20"


@pytest.mark.asyncio
async def test_a_future_submission_date_is_refused_everywhere() -> None:
    service = _make_service()
    with pytest.raises(HTTPException) as created:
        await _draft(service, date_submitted=_tomorrow())
    assert created.value.detail["code"] == "submittal_date_submitted_in_future"
    assert created.value.detail["field"] == "date_submitted"

    row = await _draft(service)
    with pytest.raises(HTTPException) as submitted:
        await service.submit_submittal(row.id, date_submitted=_tomorrow())
    assert submitted.value.detail["code"] == "submittal_date_submitted_in_future"

    with pytest.raises(HTTPException) as updated:
        await service.update_submittal(row.id, SubmittalUpdate(date_submitted=_tomorrow()))
    assert updated.value.detail["code"] == "submittal_date_submitted_in_future"


@pytest.mark.parametrize("rule_class", SUBMITTAL_REGISTER_RULES, ids=lambda c: c.rule_id)
@pytest.mark.parametrize("suffix", ["fail", "suggestion"])
def test_every_register_finding_has_vietnamese_text(rule_class: type, suffix: str) -> None:
    key = f"{rule_class.rule_id}.{suffix}"
    assert is_key_present(key, "vi"), key
    assert translate(key, locale="vi") != translate(key, locale="en")


@pytest.mark.asyncio
async def test_the_two_procurement_findings_read_in_vietnamese_with_day_first_dates() -> None:
    from app.core.validation.engine import validation_engine
    from app.modules.submittals.service import SUBMITTAL_RULE_SET

    payload = {
        "id": "s-1",
        "submittal_number": "SUB-001",
        "title": "ETFE",
        "status": "submitted",
        "submittal_type": "shop_drawing",
        "reviewer_id": "r-1",
        "date_submitted": "2017-09-01",
        "date_required": "2017-09-15",
        "required_on_site_date": "2017-08-01",
        "lead_time_weeks": 26,
        "long_lead": True,
        "linked_boq_item_ids": [],
        "review_history": [],
        "as_of": "2017-09-10",
    }
    report = await validation_engine.validate(
        data=payload,
        rule_sets=[SUBMITTAL_RULE_SET],
        target_type="submittal",
        target_id="s-1",
        project_id="p-1",
        metadata={"locale": "vi", "operation": "read"},
    )
    by_rule = {r.rule_id: r for r in report.results if not r.passed}
    on_site = by_rule["submittal.required_on_site_after_submitted"]
    assert "01/08/2017" in on_site.message
    assert "công trường" in on_site.message
    late = by_rule["submittal.approval_needed_by_not_passed"]
    assert "phê duyệt" in late.message
    assert "Chase" not in (late.suggestion or "")


@pytest.mark.asyncio
async def test_a_vietnamese_user_can_record_their_today_before_utc_reaches_it(monkeypatch) -> None:
    from app.modules.submittals import service as submittal_service

    # 06:30 on 23 October in Vietnam (UTC+7) is still 22 October in UTC.
    monkeypatch.setattr(submittal_service, "_utcnow", lambda: datetime(2026, 10, 22, 23, 30, tzinfo=UTC))
    service = _make_service()
    row = await _draft(service, date_required="2026-11-10", date_submitted="2026-10-23")
    assert row.date_submitted == "2026-10-23"

    updated = await service.update_submittal(row.id, SubmittalUpdate(date_submitted="2026-10-23"))
    assert updated.date_submitted == "2026-10-23"

    result = await service.submit_submittal(row.id, date_submitted="2026-10-23")
    assert result.date_submitted == "2026-10-23"


@pytest.mark.asyncio
async def test_the_day_after_the_furthest_time_zone_is_still_refused(monkeypatch) -> None:
    from app.modules.submittals import service as submittal_service

    monkeypatch.setattr(submittal_service, "_utcnow", lambda: datetime(2026, 10, 22, 23, 30, tzinfo=UTC))
    service = _make_service()
    with pytest.raises(HTTPException) as refused:
        await _draft(service, date_required="2026-11-10", date_submitted="2026-10-24")
    assert refused.value.status_code == 422
    assert refused.value.detail["code"] == "submittal_date_submitted_in_future"
