# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Type terms answer per field, templates carry their terms, and a region names a country.

Three promises, without a database:

* A cost-plus or GMP contract that lacks a figure is refused with a code and
  the field at fault, so the form can mark the field rather than print a
  machine word.
* The Vietnamese and integrated-project-delivery templates are data a contract
  starts from: a type they fit, the terms they usually carry, default clause
  wording, and for Vietnam the minimum advance by contract value.
* A project whose region or address says "Vietnam" is in Vietnam, while the
  multi-country "DACH" default still names no country.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.modules.contracts.country_defaults import (
    COUNTRY_CONTRACT_DEFAULTS,
    country_from_text,
    project_country_code,
    resolve_contract_defaults,
)
from app.modules.contracts.service import (
    CONTRACT_CLAUSE_TEMPLATES,
    builtin_clause_rows,
    builtin_template_default_terms,
    contract_term_problems,
    invalid_contract_terms_error,
    list_contract_templates,
    validate_contract_terms,
)
from app.modules.contracts.template_library import LIBRARY_TEMPLATES, minimum_advance_percent

# ── Type terms ───────────────────────────────────────────────────────


def test_a_gmp_contract_with_its_cap_and_target_is_accepted() -> None:
    assert contract_term_problems("gmp", {"gmp_cap": "12000000", "target_cost": "11500000", "fee_percent": "4"}) == []


def test_a_gmp_contract_without_its_figures_names_each_missing_field() -> None:
    problems = contract_term_problems("gmp", {})
    assert [(p["code"], p["field"]) for p in problems] == [
        ("contract_term_required", "terms.gmp_cap"),
        ("contract_term_required", "terms.target_cost"),
    ]


def test_a_cost_plus_contract_without_a_fee_is_refused_on_the_fee_field() -> None:
    (problem,) = contract_term_problems("cost_plus", {"fee_percent": ""})
    assert problem["code"] == "contract_term_required"
    assert problem["field"] == "terms.fee_percent"
    assert problem["params"] == {"term": "fee_percent", "contract_type": "cost_plus"}


def test_a_cap_below_the_target_is_refused() -> None:
    (problem,) = contract_term_problems("gmp", {"gmp_cap": "100", "target_cost": "200"})
    assert problem["code"] == "contract_gmp_below_target"
    assert problem["field"] == "terms.gmp_cap"


@pytest.mark.parametrize(
    ("terms", "code"),
    [
        ({"fee_percent": "-1"}, "contract_term_negative"),
        ({"fee_percent": "abc"}, "contract_term_not_numeric"),
        ({"fee_percent": "NaN"}, "contract_term_not_numeric"),
        ({"fee_percent": "5", "advance_payment_percent": "130"}, "contract_term_over_100"),
        ({"fee_percent": "5", "price_basis": "floating"}, "contract_price_basis_unknown"),
    ],
)
def test_a_bad_figure_is_refused_with_its_own_code(terms: dict, code: str) -> None:
    assert [p["code"] for p in contract_term_problems("cost_plus", terms)] == [code]


def test_the_legacy_message_list_is_kept_for_older_clients() -> None:
    ok, errors = validate_contract_terms("cost_plus", {})
    assert ok is False
    assert errors == ["missing required term: fee_percent"]


def test_the_refusal_carries_the_code_the_client_translates_and_every_field() -> None:
    error = invalid_contract_terms_error(contract_term_problems("gmp", {}))
    assert error.status_code == 400
    detail = error.detail
    assert detail["error"] == "invalid_contract_terms"
    assert detail["code"] == "contract_term_required"
    assert detail["field"] == "terms.gmp_cap"
    assert detail["params"]["term"] == "gmp_cap"
    assert [f["field"] for f in detail["fields"]] == ["terms.gmp_cap", "terms.target_cost"]
    assert detail["details"] == ["missing required term: gmp_cap", "missing required term: target_cost"]


# ── Templates ────────────────────────────────────────────────────────


def test_the_catalogue_carries_vietnamese_and_ipd_templates() -> None:
    codes = {entry["code"] for entry in list_contract_templates()}
    assert {
        "vn_nd37_lump_sum",
        "vn_nd37_fixed_unit_price",
        "vn_nd37_adjustable_unit_price",
        "vn_nd37_time_based",
        "consensusdocs_300_ipd",
        "aia_c191_ipd",
    } <= codes


def test_every_catalogue_entry_answers_the_template_profile() -> None:
    for entry in list_contract_templates():
        assert "key_clauses" not in entry and "clause_bodies" not in entry
        assert isinstance(entry["contract_types"], list)
        assert isinstance(entry["default_terms"], dict)
        assert entry["clause_count"] > 0


@pytest.mark.parametrize("code", sorted(LIBRARY_TEMPLATES))
def test_a_library_template_has_wording_for_every_clause(code: str) -> None:
    rows = builtin_clause_rows(CONTRACT_CLAUSE_TEMPLATES[code])
    assert rows and all(row["body"].strip() for row in rows)


def test_the_two_vietnamese_unit_price_templates_differ_in_their_price_basis() -> None:
    fixed = builtin_template_default_terms("vn_nd37_fixed_unit_price", "unit_price")
    adjustable = builtin_template_default_terms("vn_nd37_adjustable_unit_price", "unit_price")
    assert fixed["price_basis"] == "fixed"
    assert adjustable["price_basis"] == "adjustable"
    for terms in (fixed, adjustable):
        assert terms["performance_security_percent"] == "5"
        assert terms["warranty_retention_percent"] == "5"
        assert terms["warranty_period_months"] == "12"


@pytest.mark.parametrize(
    ("value", "advance"),
    [("9000000000", "20"), ("10000000000", "15"), ("50000000000", "15"), ("50000000001", "10")],
)
def test_a_vietnamese_template_states_the_minimum_advance_for_the_contract_value(value: str, advance: str) -> None:
    assert builtin_template_default_terms("vn_nd37_lump_sum", "lump_sum", value)["advance_payment_percent"] == advance


def test_no_advance_is_invented_without_a_contract_value() -> None:
    assert "advance_payment_percent" not in builtin_template_default_terms("vn_nd37_lump_sum", "lump_sum", 0)
    assert minimum_advance_percent([], "1") is None
    assert minimum_advance_percent([[None, "10"]], "not a number") is None


def test_a_template_fills_nothing_for_a_contract_type_it_is_not_written_for() -> None:
    assert builtin_template_default_terms("vn_nd37_lump_sum", "gmp", "1") == {}
    assert builtin_template_default_terms("fidic_red_1999", "lump_sum", "1") == {}
    assert builtin_template_default_terms("not-a-template", "lump_sum", "1") == {}
    assert builtin_template_default_terms(None, "lump_sum", "1") == {}


def test_the_aia_cost_plus_gmp_form_is_offered_for_both_types() -> None:
    profile = next(entry for entry in list_contract_templates() if entry["code"] == "aia_a102_2017")
    assert profile["contract_types"] == ["gmp", "cost_plus"]
    assert profile["country_code"] == "US"


def test_an_ipd_template_suggests_cost_plus_first_and_fits_gmp() -> None:
    profile = next(entry for entry in list_contract_templates() if entry["code"] == "consensusdocs_300_ipd")
    assert profile["contract_types"][0] == "cost_plus"
    assert "gmp" in profile["contract_types"]
    assert builtin_template_default_terms("consensusdocs_300_ipd", "gmp")["gainshare_split_pct"] == "50"


# ── The project's country ────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Vietnam", "VN"),
        ("Viet Nam", "VN"),
        ("vn", "VN"),
        ("VNM", "VN"),
        ("United States", "US"),
        ("USA", "US"),
        ("us", "US"),
        ("UK", "GB"),
        ("DACH", ""),
        ("EU", ""),
        ("", ""),
        (None, ""),
        ("Atlantis", ""),
    ],
)
def test_a_free_text_country_resolves_to_its_code_or_to_nothing(text, code: str) -> None:
    assert country_from_text(text) == code


def test_a_project_whose_region_is_vietnam_is_in_vietnam() -> None:
    project = SimpleNamespace(country_code=None, address=None, region="Vietnam")
    assert project_country_code(project) == "VN"


def test_the_recorded_code_wins_over_the_region() -> None:
    project = SimpleNamespace(country_code="us", address=None, region="Vietnam")
    assert project_country_code(project) == "US"


def test_the_address_country_answers_before_the_region() -> None:
    project = SimpleNamespace(country_code=None, address={"country": "Viet Nam"}, region="DACH")
    assert project_country_code(project) == "VN"


def test_a_project_that_never_chose_a_market_still_names_no_country() -> None:
    assert project_country_code(SimpleNamespace(country_code=None, address=None, region="DACH")) == ""
    assert project_country_code(None) == ""


def test_vietnam_has_usual_payment_terms_under_decree_37() -> None:
    resolved = resolve_contract_defaults("VN")
    assert resolved is not None
    values = resolved["values"]
    assert values["retention_percent"] == "5"
    assert values["payment_period_days"] == 14
    assert values["retention_release_split"] == [{"event": "defects_period_end", "release_percent_of_held": "100"}]
    assert "Nghị định 37/2015" in COUNTRY_CONTRACT_DEFAULTS["VN"]["standard_form"]
