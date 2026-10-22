# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Checklist templates per inspection type, as data.

An inspection booked as "structural" opened with an empty checklist, so every
inspector wrote the same hold points from memory, or skipped them. Each
template here is the usual list of things checked on site for one kind of
work: a concrete pour, the reinforcement before it, structural steel, MEP
rough-in, waterproofing, fire stopping and finishes.

A template is a code, the inspection types it is offered for, and its items.
An item is a stable key and whether it is a hold point (``critical``). The
words live in the module's message bundle (``messages/en.json`` and
``messages/vi.json``) under ``inspections.checklist_tpl.<code>.<item>``, so a
template reads in the language of whoever opens it. Once loaded into an
inspection the items are ordinary checklist rows, editable like any other: the
template is where a checklist starts, not a rule it is held to.

Each type names the template loaded when it is picked (:data:`DEFAULT_FOR_TYPE`);
the others listed for it stay selectable. "General" has no default and is
offered every template.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.modules.inspections.messages import translate

#: The inspection type that is offered every template and loads none by itself.
GENERAL_TYPE = "general"

#: Where an inspection records the template its checklist was loaded from.
TEMPLATE_META_KEY = "checklist_template"


@dataclass(frozen=True)
class TemplateItem:
    """One thing to check: a stable key for its wording, and whether it is a hold point."""

    key: str
    critical: bool = False


@dataclass(frozen=True)
class ChecklistTemplate:
    """The usual checklist for one kind of work."""

    code: str
    inspection_types: tuple[str, ...]
    items: tuple[TemplateItem, ...]

    def name_key(self) -> str:
        return f"inspections.checklist_tpl.{self.code}.name"

    def item_key(self, item: TemplateItem) -> str:
        return f"inspections.checklist_tpl.{self.code}.{item.key}"


def _items(*specs: str) -> tuple[TemplateItem, ...]:
    """Items from keys; a key ending in ``!`` is a hold point."""
    return tuple(TemplateItem(key=s.rstrip("!"), critical=s.endswith("!")) for s in specs)


TEMPLATES: tuple[ChecklistTemplate, ...] = (
    ChecklistTemplate(
        code="concrete_pour",
        inspection_types=("concrete_pour", "concrete", "structural"),
        items=_items(
            "formwork_dimensions",
            "formwork_tight",
            "rebar_accepted!",
            "cover_spacers",
            "embedded_items",
            "mix_ticket!",
            "slump_test",
            "test_samples!",
            "placing_compaction",
            "curing",
        ),
    ),
    ChecklistTemplate(
        code="rebar",
        inspection_types=("structural", "concrete", "concrete_pour"),
        items=_items(
            "bar_size_spacing!",
            "mill_certificates",
            "laps_anchorage!",
            "cover",
            "ties_secure",
            "bars_clean",
            "starter_bars",
        ),
    ),
    ChecklistTemplate(
        code="structural_steel",
        inspection_types=("structural",),
        items=_items(
            "member_sizes",
            "bolts_tightened!",
            "welds_visual",
            "welds_ndt!",
            "plumb_alignment",
            "coating",
        ),
    ),
    ChecklistTemplate(
        code="mep_rough_in",
        inspection_types=("mep", "electrical", "plumbing"),
        items=_items(
            "routing_coordinated",
            "supports_hangers",
            "penetrations_sealed",
            "pressure_test!",
            "insulation_resistance!",
            "labelling",
            "access_kept",
        ),
    ),
    ChecklistTemplate(
        code="waterproofing",
        inspection_types=("waterproofing",),
        items=_items(
            "substrate_ready",
            "membrane_laps",
            "details_sealed",
            "flood_test!",
            "protection_layer",
        ),
    ),
    ChecklistTemplate(
        code="fire_stopping",
        inspection_types=("fire_stopping", "fire_safety"),
        items=_items(
            "system_listed!",
            "annular_gap",
            "penetration_labels",
            "fire_doors",
            "detection_alarm",
        ),
    ),
    ChecklistTemplate(
        code="finishes",
        inspection_types=("finishes", "handover"),
        items=_items(
            "surfaces_flat",
            "paint_uniform",
            "tiles_sound",
            "doors_windows",
            "sealants",
            "area_clean",
        ),
    ),
)

_BY_CODE: dict[str, ChecklistTemplate] = {tpl.code: tpl for tpl in TEMPLATES}

#: The template an inspection type loads when it is picked.
DEFAULT_FOR_TYPE: dict[str, str] = {
    "structural": "concrete_pour",
    "concrete": "concrete_pour",
    "concrete_pour": "concrete_pour",
    "mep": "mep_rough_in",
    "electrical": "mep_rough_in",
    "plumbing": "mep_rough_in",
    "waterproofing": "waterproofing",
    "fire_stopping": "fire_stopping",
    "fire_safety": "fire_stopping",
    "finishes": "finishes",
    "handover": "finishes",
}


def get_template(code: str | None) -> ChecklistTemplate | None:
    """The template with this code, or ``None``."""
    return _BY_CODE.get((code or "").strip())


def templates_for(inspection_type: str | None) -> list[ChecklistTemplate]:
    """The templates offered for an inspection type, its default first.

    No type, or "general", is offered every template.
    """
    if not inspection_type or inspection_type == GENERAL_TYPE:
        return list(TEMPLATES)
    default = default_template_for(inspection_type)
    offered = [tpl for tpl in TEMPLATES if inspection_type in tpl.inspection_types]
    return sorted(offered, key=lambda tpl: default is None or tpl.code != default.code)


def default_template_for(inspection_type: str | None) -> ChecklistTemplate | None:
    """The template loaded when this type is picked. None for "general" or a type with none."""
    return get_template(DEFAULT_FOR_TYPE.get(inspection_type or ""))


def template_payload(tpl: ChecklistTemplate, locale: str, inspection_type: str | None = None) -> dict[str, Any]:
    """A template as the API returns it, its words in ``locale``."""
    default = default_template_for(inspection_type)
    return {
        "code": tpl.code,
        "name_key": tpl.name_key(),
        "name": translate(tpl.name_key(), locale=locale),
        "inspection_types": list(tpl.inspection_types),
        "is_default": default is not None and default.code == tpl.code,
        "items": [
            {
                "key": item.key,
                "text_key": tpl.item_key(item),
                "text": translate(tpl.item_key(item), locale=locale),
                "critical": item.critical,
            }
            for item in tpl.items
        ],
    }


def checklist_from_template(tpl: ChecklistTemplate, locale: str) -> list[dict[str, Any]]:
    """The template's items as checklist rows of a new inspection, worded in ``locale``.

    The rows are the inspector's from here on: their text can be changed and
    rows added or removed, like any checklist typed by hand.
    """
    return [
        {
            "question": translate(tpl.item_key(item), locale=locale),
            "response_type": "pass_fail",
            "critical": item.critical,
        }
        for item in tpl.items
    ]


__all__ = [
    "DEFAULT_FOR_TYPE",
    "GENERAL_TYPE",
    "TEMPLATES",
    "TEMPLATE_META_KEY",
    "ChecklistTemplate",
    "TemplateItem",
    "checklist_from_template",
    "default_template_for",
    "get_template",
    "template_payload",
    "templates_for",
]
