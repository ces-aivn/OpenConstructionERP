"""Bill lines are put in build order when their wording names the trades.

Pins :func:`app.modules.schedule.trade_sequence.classify_trade` on real
English and Vietnamese bill wording, and rule 6 of the planner: ground and
structure lines follow one another, later trades work side by side, site
overheads span the works, and a bill naming no trades keeps its old layout.
"""

from __future__ import annotations

import pytest

from app.modules.schedule.boq_plan import BoqRow, build_plan_tree, layout_plan
from app.modules.schedule.trade_sequence import (
    ENVELOPE,
    EXTERNAL,
    FINISHES,
    MEP,
    PRELIMINARIES,
    STRUCTURE,
    SUBSTRUCTURE,
    classify_trade,
)


@pytest.mark.parametrize(
    ("description", "trade"),
    [
        ("Excavation & support of excavation (SOE)", SUBSTRUCTURE),
        ("Foundations (caissons + mat/pile caps)", SUBSTRUCTURE),
        ("Structural steel frame (~22 lb/SF)", STRUCTURE),
        ("Composite metal deck + slab-on-deck concrete", STRUCTURE),
        ("Structural steel roof shell & compression ring", STRUCTURE),
        ("Unitized curtain wall / facade", ENVELOPE),
        ("Mechanical (HVAC) & plumbing", MEP),
        ("Vertical transportation (elevators)", MEP),
        ("Interior construction & finishes", FINISHES),
        ("Site utilities, hardscape, plaza", EXTERNAL),
        ("General conditions and insurance", PRELIMINARIES),
        ("San lấp, chuẩn bị mặt bằng, đường tạm (44 ha)", SUBSTRUCTURE),
        ("Cọc barrette BTCT – thi công + bê tông + thép", SUBSTRUCTURE),
        ("Bê tông móng bè 8,4m", SUBSTRUCTURE),
        ("Sàn nền công nghiệp chịu tải cao (superflat)", STRUCTURE),
        ("Kết cấu thép nhà xưởng (gia công + lắp dựng)", STRUCTURE),
        ("Mái tôn cách nhiệt + vách panel", ENVELOPE),
        ("Hệ thống PV áp mái ~12.400 tấm", MEP),
        ("MEP tòa nhà (HVAC, điện, cấp thoát nước, PCCC)", MEP),
        ("Hoàn thiện kiến trúc văn phòng", FINISHES),
        ("Hạ tầng ngoài nhà: đường nội bộ, bãi đỗ, thoát nước", EXTERNAL),
        ("Thiết bị thi công: cẩu tháp leo, vận thăng", PRELIMINARIES),
        ("Position 1.1", None),
        ("", None),
    ],
)
def test_the_trade_is_read_off_the_wording(description: str, trade: str | None) -> None:
    assert classify_trade(description) == trade


def _row(row_id: str, description: str, *, lump_sum: bool = False) -> BoqRow:
    return BoqRow(
        id=row_id,
        parent_id=None,
        is_section=False,
        is_placeholder=False,
        data={},
        lump_sum=lump_sum,
        trade=classify_trade(description),
    )


def _starts(rows: list[BoqRow], durations: dict[str, int]) -> dict[str, int]:
    tree = build_plan_tree(rows)
    layout = layout_plan(tree.roots, durations, 4)
    return {key[2:]: slot.start for key, slot in layout.slots.items() if key.startswith("t:")}


def test_a_flat_bill_is_built_in_trade_order_whatever_the_bill_order() -> None:
    rows = [
        _row("finish", "Interior finishes"),
        _row("mech", "Mechanical & plumbing"),
        _row("elec", "Electrical"),
        _row("found", "Foundations and piles"),
        _row("frame", "Structural steel frame"),
        _row("deck", "Metal deck and slab"),
        _row("wall", "Curtain wall"),
        _row("prelims", "General conditions", lump_sum=True),
    ]
    starts = _starts(rows, {r.id: 10 for r in rows})
    assert starts["found"] == 0
    # The frame waits for half the foundations, the deck for half the frame.
    assert starts["found"] < starts["frame"] < starts["deck"] < starts["wall"]
    # The services start together, after the envelope; finishes after them.
    assert starts["wall"] < starts["mech"] == starts["elec"] < starts["finish"]
    # Site overheads run from the first day.
    assert starts["prelims"] == 0


def test_a_bill_whose_wording_names_no_trade_keeps_its_layout() -> None:
    rows = [_row(f"p{i}", f"Position {i}") for i in range(4)]
    starts = _starts(rows, {r.id: 10 for r in rows})
    # Loose positions at the top are worked side by side, as before.
    assert set(starts.values()) == {0}
