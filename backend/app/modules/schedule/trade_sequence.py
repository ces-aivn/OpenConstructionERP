# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Which stage of the build a bill line belongs to, read from its wording.

A building goes up in an order every site manager knows: the ground and the
foundations, then the structure, then the envelope that closes it, then the
services, then the finishes, and the external works last. Site overheads run
alongside the whole job. A bill rarely says which line is which, but its
descriptions do, in English or in Vietnamese, so the generator reads them to
put the trades in that order rather than starting them all on day one.

The reading is a vote: every phrase a description contains scores for its
stage, longer phrases score more (``site utilities`` beats ``utilities``), and
a tie goes to the earlier stage in :data:`TIE_ORDER`. A description no phrase
matches has no stage and the caller keeps it where the bill put it.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final

PRELIMINARIES: Final = "preliminaries"
SUBSTRUCTURE: Final = "substructure"
STRUCTURE: Final = "structure"
ENVELOPE: Final = "envelope"
MEP: Final = "mep"
FINISHES: Final = "finishes"
EXTERNAL: Final = "external"

#: The order the stages are built in. Site overheads come first but span the job.
PHASE_ORDER: Final[tuple[str, ...]] = (PRELIMINARIES, SUBSTRUCTURE, STRUCTURE, ENVELOPE, MEP, FINISHES, EXTERNAL)

#: Stages whose lines follow one another in bill order, each starting when half
#: of the one before is done: excavation before the piles or the piles before
#: the dig is the bill's call, and the deck follows the frame it sits on. In
#: the other stages the trades work side by side.
SEQUENTIAL_PHASES: Final[frozenset[str]] = frozenset({SUBSTRUCTURE, STRUCTURE})

#: Which stage wins a tied vote.
TIE_ORDER: Final[tuple[str, ...]] = (SUBSTRUCTURE, STRUCTURE, MEP, ENVELOPE, FINISHES, EXTERNAL, PRELIMINARIES)

# English phrases are matched on the description folded to plain ASCII, so an
# accent or a ligature does not hide them. A pattern without a closing ``\b``
# is a stem ("foundation" also reads "foundations").
_EN: Final[dict[str, tuple[str, ...]]] = {
    PRELIMINARIES: (
        r"\bpreliminar",
        r"\bgeneral conditions?\b",
        r"\bgeneral requirements?\b",
        r"\bmobili[sz]ation",
        r"\bsite (setup|set-up|establishment|facilities|office|overheads?)\b",
        r"\btemporary (works|facilities|offices?|roads?)\b",
        r"\binsurance",
        r"\bperformance bond",
        r"\bscaffold",
        r"\bhoists?\b",
        r"\btower cranes?\b",
        r"\bconstruction equipment\b",
    ),
    SUBSTRUCTURE: (
        r"\bexcavat",
        r"\bearthwork",
        r"\bearth retention\b",
        r"\bshoring\b",
        r"\bdewater",
        r"\bsoe\b",
        r"\bsite (clearing|preparation|grading)\b",
        r"\bgrading\b",
        r"\bbackfill",
        r"\bfoundation",
        r"\bfootings?\b",
        r"\bpil(e|es|ing)\b",
        r"\bpile caps?\b",
        r"\bcaisson",
        r"\bdrilled piers?\b",
        r"\bdiaphragm walls?\b",
        r"\bslurry walls?\b",
        r"\bsheet pil",
        r"\bsubstructure\b",
        r"\bunderpinning\b",
    ),
    STRUCTURE: (
        r"\bstructur",
        r"\bstructural steel\b",
        r"\bconcrete\b",
        r"\bcast-in-place\b",
        r"\bprecast\b",
        r"\brebar\b",
        r"\breinforc",
        r"\bformwork",
        r"\bsteel (frame|structure|erection)\b",
        r"\bmetal deck",
        r"\bdeck(s|ing)?\b",
        r"\bslabs?\b",
        r"\bcolumns?\b",
        r"\bbeams?\b",
        r"\bframe\b",
        r"\bsuperstructure\b",
        r"\bcore walls?\b",
        r"\bpost-tension",
    ),
    ENVELOPE: (
        r"\bcurtain ?wall",
        r"\bfacade",
        r"\bfaçade",
        r"\bcladding",
        r"\benvelope\b",
        r"\broof",
        r"\bcanopy\b",
        r"\betfe\b",
        r"\bglazing\b",
        r"\bwindows?\b",
        r"\bexternal walls?\b",
        r"\bwaterproofing\b",
        r"\bmasonry\b",
    ),
    MEP: (
        r"\bmep\b",
        r"\bm&e\b",
        r"\bmechanical\b",
        r"\bhvac\b",
        r"\bplumbing\b",
        r"\belectrical\b",
        r"\blow[- ]voltage\b",
        r"\bfire (protection|alarm|sprinklers?|suppression)\b",
        r"\bsprinkler",
        r"\bfp systems?\b",
        r"\belevators?\b",
        r"\bescalators?\b",
        r"\bvertical transportation\b",
        r"\bchillers?\b",
        r"\butilities\b",
        r"\benergy (center|centre)\b",
        r"\bpiping\b",
        r"\bducts?\b",
        r"\bbms\b",
        r"\belv\b",
        r"\bpv\b",
        r"\bsolar\b",
        r"\bgenerators?\b",
        r"\bswitchgear\b",
    ),
    FINISHES: (
        r"\bfinish",
        r"\binterior",
        r"\bfit-?out\b",
        r"\bpainting\b",
        r"\bflooring\b",
        r"\btiling\b",
        r"\bdrywall\b",
        r"\bceilings?\b",
        r"\bpartitions?\b",
        r"\bjoinery\b",
        r"\bmillwork\b",
        r"\bdoors?\b",
        r"\bbathroom",
        r"\bpods?\b",
        r"\bseating\b",
        r"\bfurnish",
        r"\bff&e\b",
        r"\bsignage\b",
        r"\bvideo boards?\b",
        r"\bscoreboards?\b",
    ),
    EXTERNAL: (
        r"\blandscap",
        r"\bhardscap",
        r"\bsite (utilities|works|improvements|development)\b",
        r"\bexternal works?\b",
        r"\bpaving\b",
        r"\bplaza\b",
        r"\bparking\b",
        r"\bfenc(e|ing)\b",
    ),
}

# Vietnamese phrases are matched with their diacritics: without them "sàn nền"
# (a floor slab) and "san nền" (levelling the site) are the same letters.
_VI: Final[dict[str, tuple[str, ...]]] = {
    PRELIMINARIES: (
        "chi phí chung",
        "hạng mục chung",
        "thiết bị thi công",
        "cẩu tháp",
        "vận thăng",
        "lán trại",
        "nhà tạm",
        "đường tạm",
        "điện nước tạm",
        "bảo hiểm",
        "an toàn lao động",
        "giàn giáo",
    ),
    SUBSTRUCTURE: (
        "san lấp",
        "san nền",
        "chuẩn bị mặt bằng",
        "đào đất",
        "đào móng",
        "đào hố",
        "đắp đất",
        "cọc",
        "móng",
        "đài cọc",
        "dầm giằng",
        "tường vây",
        "barrette",
        "hạ mực nước ngầm",
        "phần ngầm",
    ),
    STRUCTURE: (
        "kết cấu",
        "kết cấu thép",
        "bê tông",
        "btct",
        "cốt thép",
        "cốp pha",
        "ván khuôn",
        "thép hình",
        "sàn",
        "cột",
        "dầm",
        "vách",
        "phần thân",
    ),
    ENVELOPE: (
        "mặt dựng",
        "vách kính",
        "kính mặt ngoài",
        "mái",
        "mái tôn",
        "tôn",
        "cách nhiệt",
        "vách panel",
        "chống thấm",
        "xây tường bao",
        "bao che",
        "cửa sổ",
    ),
    MEP: (
        "điện",
        "cấp thoát nước",
        "thoát nước",
        "cấp nước",
        "điều hòa",
        "thông gió",
        "pccc",
        "phòng cháy",
        "chữa cháy",
        "thang máy",
        "đường ống",
        "khí nén",
        "nước làm mát",
        "điện mặt trời",
        "cơ điện",
    ),
    FINISHES: (
        "hoàn thiện",
        "trát",
        "sơn",
        "ốp",
        "lát",
        "trần",
        "cửa",
        "nội thất",
        "thiết bị vệ sinh",
        "xây",
    ),
    EXTERNAL: (
        "hạ tầng",
        "ngoài nhà",
        "cảnh quan",
        "cây xanh",
        "đường nội bộ",
        "bãi đỗ",
        "sân vườn",
        "hàng rào",
        "cổng tường rào",
    ),
}


def _compile() -> list[tuple[str, re.Pattern[str], int, bool]]:
    patterns: list[tuple[str, re.Pattern[str], int, bool]] = []
    for phase, items in _EN.items():
        for item in items:
            weight = len(re.sub(r"\\b|\(|\)|\?|\|.*", "", item).split())
            patterns.append((phase, re.compile(item), max(1, weight), True))
    for phase, items in _VI.items():
        for item in items:
            # Vietnamese writes a word as several syllables ("bê tông"), so a
            # phrase scores one, and two only when it is a longer expression.
            weight = 2 if len(item.split()) >= 3 else 1
            patterns.append((phase, re.compile(rf"(?<!\w){re.escape(item)}(?!\w)"), weight, False))
    return patterns


_PATTERNS: Final = _compile()


def _ascii_fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def classify_trade(description: str | None) -> str | None:
    """The build stage a bill line's description names, or ``None`` when it names none.

    Args:
        description: The position or section description, any case, English
            or Vietnamese.

    Returns:
        One of :data:`PHASE_ORDER`, or ``None``.
    """
    text = unicodedata.normalize("NFC", (description or "").lower())
    if not text.strip():
        return None
    folded = _ascii_fold(text)
    scores: dict[str, int] = {}
    for phase, pattern, weight, english in _PATTERNS:
        if pattern.search(folded if english else text):
            scores[phase] = scores.get(phase, 0) + weight
    if not scores:
        return None
    best = max(scores.values())
    return next(phase for phase in TIE_ORDER if scores.get(phase) == best)
