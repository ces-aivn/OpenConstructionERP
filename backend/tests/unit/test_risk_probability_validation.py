"""Probability on the risk API: one 0-1 scale and a stable error code.

The register UI takes a percentage and sends a fraction. A value outside 0-1
is refused with the error type ``risk_probability_out_of_range`` on the
``probability`` field, which the UI translates; the reader never gets
Pydantic's English sentence.
"""

from __future__ import annotations

import math
import uuid

import pytest
from pydantic import ValidationError

from app.modules.risk.schemas import PROBABILITY_ERROR_CODE, RiskCreate, RiskUpdate

PROJECT_ID = uuid.uuid4()


def _errors(exc: ValidationError) -> list[tuple[tuple, str]]:
    return [(tuple(e["loc"]), e["type"]) for e in exc.errors()]


@pytest.mark.parametrize("bad", [1.5, -0.01, 15, 100, math.inf, math.nan])
def test_create_refuses_probability_outside_zero_to_one_with_a_code(bad: float) -> None:
    with pytest.raises(ValidationError) as exc:
        RiskCreate(project_id=PROJECT_ID, title="R", probability=bad)
    assert _errors(exc.value) == [(("probability",), PROBABILITY_ERROR_CODE)]
    ctx = exc.value.errors()[0]["ctx"]
    assert ctx["min_percent"] == 0 and ctx["max_percent"] == 100


@pytest.mark.parametrize("bad", [1.5, -1])
def test_update_refuses_probability_outside_zero_to_one_with_a_code(bad: float) -> None:
    with pytest.raises(ValidationError) as exc:
        RiskUpdate(probability=bad)
    assert _errors(exc.value) == [(("probability",), PROBABILITY_ERROR_CODE)]


@pytest.mark.parametrize("ok", [0, 0.0, 0.15, 0.5, 1, 1.0])
def test_probability_inside_the_range_is_accepted(ok: float) -> None:
    assert RiskCreate(project_id=PROJECT_ID, title="R", probability=ok).probability == ok
    assert RiskUpdate(probability=ok).probability == ok


def test_update_without_probability_stays_unset() -> None:
    assert "probability" not in RiskUpdate(title="x").model_dump(exclude_unset=True)
