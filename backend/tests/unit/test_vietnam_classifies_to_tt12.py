"""A Vietnamese project reads the national cost-norm work-item codes.

The region picker writes "Vietnam", which resolved to no country, so every
Vietnamese project was classified against DIN 276. Vietnam now resolves to the
work-item code groups of Circular 12/2021/TT-BXD, shipped as a code list.
"""

from __future__ import annotations

from app.core.classification_registry import (
    CLASSIFICATION_STANDARD_LABELS,
    KNOWN_CLASSIFICATION_STANDARDS,
    resolve_standard,
)
from app.core.code_lists import get_code_list


def test_the_picker_spelling_of_vietnam_resolves_to_the_national_codes() -> None:
    resolved = resolve_standard(None, "Vietnam")
    assert resolved.standard == "vn_tt12"
    assert resolved.country == "VN"
    assert resolved.source == "region"


def test_the_united_states_keeps_masterformat() -> None:
    assert resolve_standard(None, "US").standard == "masterformat"


def test_the_standard_can_be_chosen_explicitly_and_is_labelled() -> None:
    assert "vn_tt12" in KNOWN_CLASSIFICATION_STANDARDS
    assert resolve_standard("vn_tt12", "US").standard == "vn_tt12"
    assert CLASSIFICATION_STANDARD_LABELS["vn_tt12"] == "TT 12/2021/TT-BXD"


def test_the_code_list_carries_the_work_item_groups_aa_to_al() -> None:
    code_list = get_code_list("vn_tt12")
    assert code_list is not None
    codes = {entry.code for entry in code_list.entries}
    assert {"AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AK", "AL"} <= codes
    by_code = {entry.code: entry for entry in code_list.entries}
    assert by_code["AF"].parent == "A"
    assert by_code["BA"].parent == "B"
