# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""An inspection starts from the usual checklist for its type, in the reader's language.

Choosing "structural" used to leave the checklist empty, so every inspector
wrote the hold points from memory. Pinned here:

* every inspection type the form offers, "general" aside, loads a template,
  and the templates the user asked for exist: concrete pour, rebar, MEP and
  finishes;
* every item of every template is worded in English and in Vietnamese, under
  its own message key;
* the API lists the templates of a type with its default first, worded in the
  requested language;
* an inspection created with a template and no checklist starts with the
  template's items, as ordinary pass/fail rows, and records the template; a
  checklist the inspector edited from the template wins over it;
* an unknown template is refused with a stable code the client translates.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.modules.inspections import checklist_templates as tpl
from app.modules.inspections.messages import is_key_present
from app.modules.inspections.router import list_checklist_templates
from app.modules.inspections.schemas import ChecklistEntry, InspectionCreate
from tests.unit.test_inspections import _make_service

MESSAGES = Path(tpl.__file__).parent / "messages"

#: The types the create form offers, with the template each loads.
FORM_TYPES = {
    "structural": "concrete_pour",
    "concrete": "concrete_pour",
    "electrical": "mep_rough_in",
    "plumbing": "mep_rough_in",
    "mep": "mep_rough_in",
    "fire_safety": "fire_stopping",
    "waterproofing": "waterproofing",
    "finishes": "finishes",
}


def _speak(monkeypatch: pytest.MonkeyPatch, locale: str) -> None:
    """Answer as if the request asked for ``locale`` (what the Accept-Language middleware sets)."""
    monkeypatch.setattr("app.modules.inspections.router.get_locale", lambda: locale)
    monkeypatch.setattr("app.modules.inspections.service.get_locale", lambda: locale)


@pytest.mark.parametrize(("inspection_type", "code"), sorted(FORM_TYPES.items()))
def test_each_type_loads_its_template(inspection_type: str, code: str) -> None:
    default = tpl.default_template_for(inspection_type)
    assert default is not None
    assert default.code == code
    # The default is offered first, and the type's other templates after it.
    assert tpl.templates_for(inspection_type)[0].code == code


def test_structural_offers_the_pour_the_rebar_and_the_steel() -> None:
    assert [t.code for t in tpl.templates_for("structural")] == ["concrete_pour", "rebar", "structural_steel"]


def test_general_loads_nothing_and_offers_everything() -> None:
    assert tpl.default_template_for("general") is None
    assert len(tpl.templates_for("general")) == len(tpl.TEMPLATES)


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_every_template_is_worded_in_english_and_vietnamese(locale: str) -> None:
    for template in tpl.TEMPLATES:
        assert is_key_present(template.name_key(), locale), (locale, template.name_key())
        for item in template.items:
            assert is_key_present(template.item_key(item), locale), (locale, template.item_key(item))


def test_the_bundles_carry_no_key_without_an_item() -> None:
    known = {(t.code, "name") for t in tpl.TEMPLATES} | {(t.code, i.key) for t in tpl.TEMPLATES for i in t.items}
    for name in ("en.json", "vi.json"):
        data = json.loads((MESSAGES / name).read_text(encoding="utf-8"))["inspections"]["checklist_tpl"]
        assert {(code, key) for code, items in data.items() for key in items} == known, name


async def test_the_api_words_the_templates_in_the_requested_language(monkeypatch: pytest.MonkeyPatch) -> None:
    _speak(monkeypatch, "vi")
    listed = await list_checklist_templates("user-1", inspection_type="structural")
    assert [t.code for t in listed] == ["concrete_pour", "rebar", "structural_steel"]
    pour = listed[0]
    assert pour.is_default is True
    assert pour.name == "Đổ bê tông"
    assert pour.items[2].text_key == "inspections.checklist_tpl.concrete_pour.rebar_accepted"
    assert pour.items[2].text == "Cốt thép đã được nghiệm thu trước khi đổ bê tông"
    assert pour.items[2].critical is True
    assert listed[1].is_default is False

    _speak(monkeypatch, "en")
    (finishes,) = [t for t in await list_checklist_templates("user-1", inspection_type="finishes")]
    assert finishes.name == "Finishes"
    assert finishes.items[0].text.startswith("Walls and ceilings")


async def test_an_inspection_created_with_a_template_starts_with_its_items(monkeypatch: pytest.MonkeyPatch) -> None:
    _speak(monkeypatch, "vi")
    inspection = await _make_service().create_inspection(
        InspectionCreate(
            project_id=uuid.uuid4(),
            inspection_type="structural",
            title="Đổ bê tông sàn tầng 3",
            checklist_template="concrete_pour",
        )
    )
    rows = inspection.checklist_data
    assert len(rows) == len(tpl.get_template("concrete_pour").items)
    assert rows[0]["question"] == "Vị trí, kích thước và cao độ cốp pha đúng bản vẽ"
    assert all(row["response_type"] == "pass_fail" and row["id"] for row in rows)
    assert [row["critical"] for row in rows][2] is True
    assert inspection.metadata_[tpl.TEMPLATE_META_KEY] == "concrete_pour"


async def test_a_checklist_edited_from_the_template_wins() -> None:
    inspection = await _make_service().create_inspection(
        InspectionCreate(
            project_id=uuid.uuid4(),
            inspection_type="structural",
            title="Rebar, grid C",
            checklist_template="rebar",
            checklist_data=[ChecklistEntry(question="Bar sizes as drawn, plus the extra trimmer bars", critical=True)],
        )
    )
    assert [row["question"] for row in inspection.checklist_data] == ["Bar sizes as drawn, plus the extra trimmer bars"]
    assert inspection.metadata_[tpl.TEMPLATE_META_KEY] == "rebar"


async def test_an_unknown_template_is_refused_with_a_code() -> None:
    with pytest.raises(HTTPException) as caught:
        await _make_service().create_inspection(
            InspectionCreate(
                project_id=uuid.uuid4(),
                inspection_type="general",
                title="Walkthrough",
                checklist_template="no_such_template",
            )
        )
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "inspection_template_unknown"
    assert caught.value.detail["field"] == "checklist_template"


def test_finishes_is_an_inspection_type() -> None:
    InspectionCreate(project_id=uuid.uuid4(), inspection_type="finishes", title="Unit 12B walkthrough")
