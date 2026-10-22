# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Built-in contract templates for Vietnam and for US integrated project delivery.

Data, not branches. Each entry has the shape of the built-in catalogue in
``contracts.service`` (``name``, ``family``, ``key_clauses``,
``retention_release_event``) plus what makes it a working starting point:

* ``country_code``: the market the paper is written for.
* ``contract_types``: the contract types it fits; the first is the one a form
  pre-selects.
* ``default_terms``: the commercial terms it usually carries, written into a
  new contract's ``terms`` where the author states nothing. Anything sent wins.
* ``advance_tiers``: Vietnam's minimum advance by contract value, read when the
  author states no advance (see :func:`minimum_advance_percent`).
* ``clause_bodies``: default wording for each clause, keyed like
  ``key_clauses``.

The Vietnamese clause wording is our own summary of the rules it cites, not a
copy of a published contract form: Nghị định 37/2015/NĐ-CP on construction
contracts as amended by Nghị định 50/2021/NĐ-CP (advances further amended by
Nghị định 35/2023/NĐ-CP), and Nghị định 06/2021/NĐ-CP on the warranty. The US
integrated project delivery outline follows the structure the ConsensusDocs
300 and AIA C191 multi-party agreements share; their text is licensed by the
publishers and is not reproduced here.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

#: Vietnam's minimum advance on a construction works contract, by contract
#: value in VND (Nghị định 37/2015/NĐ-CP, Điều 18, as amended): 20 percent
#: under 10 billion, 15 percent from 10 to 50 billion, 10 percent above. Each
#: row is ``(upper bound or None, percent)``; the first row whose bound the
#: value does not exceed answers. The advance may not exceed 30 percent of the
#: contract value without the investment decision-maker's approval.
VN_ADVANCE_TIERS: tuple[tuple[str | None, str], ...] = (
    ("9999999999", "20"),
    ("50000000000", "15"),
    (None, "10"),
)

#: The ceiling on an advance without the investment decision-maker's approval.
VN_ADVANCE_CEILING_PERCENT = Decimal("30")

_VN_COMMON_TERMS: dict[str, str] = {
    "performance_security_percent": "5",
    "warranty_retention_percent": "5",
    "warranty_period_months": "12",
}

_VN_CLAUSES: dict[str, str] = {
    "1": "Hồ sơ hợp đồng và thứ tự ưu tiên",
    "2": "Nội dung và khối lượng công việc",
    "3": "Giá hợp đồng",
    "4": "Tạm ứng hợp đồng",
    "5": "Thanh toán hợp đồng",
    "6": "Bảo đảm thực hiện hợp đồng",
    "7": "Bảo hành công trình và tiền bảo hành",
    "8": "Điều chỉnh hợp đồng",
    "9": "Tiến độ, thưởng và phạt vi phạm hợp đồng",
    "10": "Nghiệm thu và bàn giao",
    "11": "Quyết toán và thanh lý hợp đồng",
    "12": "Giải quyết tranh chấp",
}

_VN_BODIES_COMMON: dict[str, str] = {
    "1": (
        "Hồ sơ hợp đồng gồm văn bản hợp đồng và các tài liệu kèm theo theo thứ tự ưu tiên: văn bản hợp đồng, "
        "điều kiện cụ thể, điều kiện chung, hồ sơ mời thầu hoặc yêu cầu của bên giao thầu, hồ sơ dự thầu hoặc "
        "đề xuất của bên nhận thầu, bản vẽ thiết kế và chỉ dẫn kỹ thuật, các tài liệu khác do hai bên thống nhất."
    ),
    "2": (
        "Bên nhận thầu thực hiện toàn bộ khối lượng công việc theo hồ sơ thiết kế, chỉ dẫn kỹ thuật và bảng "
        "khối lượng kèm theo hợp đồng."
    ),
    "4": (
        "Bên giao thầu tạm ứng theo tỷ lệ ghi trong hợp đồng sau khi hợp đồng có hiệu lực và nhận được bảo lãnh "
        "tạm ứng. Mức tạm ứng tối thiểu đối với hợp đồng thi công xây dựng: 20% với hợp đồng dưới 10 tỷ "
        "đồng, 15% với hợp đồng từ 10 đến 50 tỷ đồng, 10% với hợp đồng trên 50 tỷ đồng; mức tối đa 30% giá hợp "
        "đồng tại thời điểm ký kết (Nghị định 37/2015/NĐ-CP, Điều 18, sửa đổi bởi Nghị định 50/2021/NĐ-CP và "
        "Nghị định 35/2023/NĐ-CP). Tạm ứng trên 1 tỷ đồng phải có bảo lãnh tạm ứng có giá trị và loại tiền tương "
        "đương. Tiền tạm ứng được thu hồi dần qua các lần thanh toán và thu hồi hết khi thanh toán đạt 80% giá "
        "hợp đồng."
    ),
    "5": (
        "Thanh toán theo giai đoạn trên cơ sở khối lượng hoàn thành được nghiệm thu. Bên giao thầu thanh toán "
        "trong thời hạn không quá 14 ngày làm việc kể từ ngày nhận đủ hồ sơ đề nghị thanh toán hợp lệ "
        "(Nghị định 37/2015/NĐ-CP, Điều 19 và Điều 20). Mỗi lần thanh toán giữ lại "
        "tỷ lệ tiền bảo hành ghi trong hợp đồng, trừ khi bên nhận thầu nộp bảo lãnh bảo hành tương ứng."
    ),
    "6": (
        "Bên nhận thầu nộp bảo đảm thực hiện hợp đồng theo tỷ lệ ghi trong hợp đồng (từ 2% đến 10% giá hợp "
        "đồng theo Nghị định 37/2015/NĐ-CP, Điều 16) trước ngày hợp đồng có hiệu lực. Bảo đảm có hiệu lực đến "
        "khi khối lượng theo hợp đồng được nghiệm thu và bên nhận thầu chuyển sang nghĩa vụ bảo hành. Bên nhận "
        "thầu không được hoàn trả bảo đảm nếu từ chối thực hiện hợp đồng sau khi hợp đồng có hiệu lực."
    ),
    "7": (
        "Thời gian bảo hành ghi trong hợp đồng tính từ ngày nghiệm thu đưa công trình vào sử dụng "
        "(không ít hơn 24 tháng với công trình cấp đặc biệt và cấp I, 12 tháng với công trình cấp còn lại). Tiền "
        "bảo hành tối thiểu 3% giá hợp đồng với công trình cấp đặc biệt và cấp I, 5% với công trình cấp còn lại "
        "(Nghị định 06/2021/NĐ-CP, Điều 28). Tiền bảo hành được hoàn trả khi kết thúc thời gian bảo hành và bên "
        "giao thầu xác nhận hoàn thành nghĩa vụ bảo hành."
    ),
    "9": (
        "Bên nhận thầu hoàn thành công trình đúng tiến độ đã thống nhất. Hai bên thỏa thuận mức thưởng và mức "
        "phạt vi phạm hợp đồng; với công trình sử dụng vốn nhà nước, mức phạt không vượt quá 12% giá trị phần "
        "hợp đồng bị vi phạm."
    ),
    "10": (
        "Công việc được nghiệm thu theo từng giai đoạn và khi hoàn thành; biên bản nghiệm thu là căn cứ thanh "
        "toán. Bên nhận thầu bàn giao công trình cùng hồ sơ hoàn công."
    ),
    "11": (
        "Hai bên quyết toán hợp đồng sau khi bên nhận thầu hoàn thành nghĩa vụ theo hợp đồng, và thanh lý hợp "
        "đồng khi các nghĩa vụ đã hoàn thành (Nghị định 37/2015/NĐ-CP, Điều 22 và Điều 23)."
    ),
    "12": (
        "Tranh chấp được giải quyết trước hết bằng thương lượng, hòa giải; không thành thì đưa ra trọng tài "
        "thương mại hoặc tòa án có thẩm quyền theo thỏa thuận của hai bên."
    ),
}


def _vn_template(
    name: str,
    contract_type: str,
    price_clause: str,
    adjustment_clause: str,
    extra_terms: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "family": "vietnam",
        "country_code": "VN",
        "contract_types": [contract_type],
        "description": (
            "Vietnamese construction works contract under Nghị định 37/2015/NĐ-CP as amended by "
            "Nghị định 50/2021/NĐ-CP: advance, payment, performance security, warranty retention."
        ),
        "key_clauses": dict(_VN_CLAUSES),
        "clause_bodies": {**_VN_BODIES_COMMON, "3": price_clause, "8": adjustment_clause},
        "default_terms": {**_VN_COMMON_TERMS, **(extra_terms or {})},
        "advance_tiers": [list(row) for row in VN_ADVANCE_TIERS],
        "retention_release_event": "defects_period_end",
    }


_IPD_CLAUSES: dict[str, str] = {
    "1": "Parties and the integrated project team",
    "2": "Governance and consensus decision-making",
    "3": "Target cost and project budget",
    "4": "Compensation: cost of the work and profit at risk",
    "5": "Incentive compensation and shared savings",
    "6": "Changes and adjustments to the target cost",
    "7": "Schedule, substantial completion and final completion",
    "8": "Applications for payment",
    "9": "Mutual waivers and limitation of liability",
    "10": "Insurance and bonds",
    "11": "Dispute mitigation and resolution",
    "12": "Suspension and termination",
}

_IPD_BODIES: dict[str, str] = {
    "1": (
        "The owner, the design professional and the constructor sign one agreement and work as a single team. "
        "Key trade partners may join by joinder agreement."
    ),
    "2": (
        "A core group with one representative of each party manages the project and decides by consensus. "
        "Deadlocks escalate to the parties' senior management before any dispute process starts."
    ),
    "3": (
        "The team validates the owner's program and agrees a target cost. The target cost changes only through "
        "the change process in this agreement."
    ),
    "4": (
        "Each party is reimbursed its actual cost of the work. Profit is placed in a shared pool at risk and paid "
        "according to the project's cost and goal outcomes."
    ),
    "5": (
        "Savings below the target cost are shared among the parties in the agreed proportions; costs above the "
        "target reduce the profit pool first."
    ),
    "6": (
        "A change in the owner's program or scope adjusts the target cost and the schedule. Changes are priced "
        "transparently from the cost of the work."
    ),
    "7": ("The team keeps an integrated schedule. Substantial completion and final completion are certified jointly."),
    "8": (
        "Each party applies monthly for its cost of the work on a schedule of values with a continuation "
        "sheet. Retainage, if any, follows the agreed rate and any state statute that limits it."
    ),
    "9": (
        "The parties waive claims against each other except for the matters this agreement names, such as "
        "wilful default, and limit liability to the amounts it states."
    ),
    "10": (
        "The parties carry the insurance the agreement lists, preferably a project-specific policy, and the "
        "constructor provides payment and performance bonds where the owner requires them."
    ),
    "11": (
        "Disputes go first to the core group, then to senior management, then to mediation, and finally to "
        "arbitration or litigation as agreed."
    ),
    "12": (
        "The owner may suspend the work or terminate for convenience on written notice, paying the cost of the "
        "work performed and agreed demobilisation costs."
    ),
}


def _ipd_template(name: str, family: str) -> dict[str, Any]:
    return {
        "name": name,
        "family": family,
        "country_code": "US",
        "contract_types": ["cost_plus", "gmp"],
        "description": (
            "Integrated project delivery: one multi-party agreement among owner, designer and constructor, "
            "cost of the work reimbursed, profit at risk against a shared target cost."
        ),
        "key_clauses": dict(_IPD_CLAUSES),
        "clause_bodies": dict(_IPD_BODIES),
        "default_terms": {"gainshare_split_pct": "50"},
        "retention_release_event": "substantial_completion",
    }


#: The templates this module contributes to the built-in catalogue.
LIBRARY_TEMPLATES: dict[str, dict[str, Any]] = {
    "vn_nd37_lump_sum": _vn_template(
        "Hợp đồng thi công xây dựng trọn gói - NĐ 37/2015 (sửa đổi NĐ 50/2021)",
        "lump_sum",
        (
            "Giá hợp đồng trọn gói (Nghị định 37/2015/NĐ-CP, Điều 15). Giá không thay đổi trong suốt quá trình "
            "thực hiện đối với khối lượng công việc thuộc phạm vi hợp đồng đã ký kết."
        ),
        (
            "Giá hợp đồng trọn gói chỉ được điều chỉnh khi bổ sung công việc ngoài phạm vi hợp đồng, do sự kiện "
            "bất khả kháng hoặc khi Nhà nước thay đổi chính sách làm ảnh hưởng trực tiếp đến giá hợp đồng."
        ),
    ),
    "vn_nd37_fixed_unit_price": _vn_template(
        "Hợp đồng thi công xây dựng theo đơn giá cố định - NĐ 37/2015 (sửa đổi NĐ 50/2021)",
        "unit_price",
        (
            "Giá hợp đồng theo đơn giá cố định (Nghị định 37/2015/NĐ-CP, Điều 15): đơn giá không thay đổi trong "
            "suốt thời gian thực hiện hợp đồng; giá thanh toán bằng khối lượng thực tế hoàn thành được nghiệm "
            "thu nhân với đơn giá trong hợp đồng."
        ),
        (
            "Khối lượng được điều chỉnh theo thực tế nghiệm thu; đơn giá không điều chỉnh, trừ khối lượng phát "
            "sinh ngoài phạm vi hợp đồng hoặc sự kiện bất khả kháng."
        ),
        {"price_basis": "fixed"},
    ),
    "vn_nd37_adjustable_unit_price": _vn_template(
        "Hợp đồng thi công xây dựng theo đơn giá điều chỉnh - NĐ 37/2015 (sửa đổi NĐ 50/2021)",
        "unit_price",
        (
            "Giá hợp đồng theo đơn giá điều chỉnh (Nghị định 37/2015/NĐ-CP, Điều 15): đơn giá được điều chỉnh "
            "do trượt giá theo các loại công việc và thời điểm điều chỉnh thỏa thuận trong hợp đồng; giá thanh "
            "toán bằng khối lượng thực tế hoàn thành được nghiệm thu nhân với đơn giá đã điều chỉnh."
        ),
        (
            "Đơn giá được điều chỉnh theo phương pháp chỉ số giá xây dựng do cơ quan có thẩm quyền công bố hoặc "
            "theo phương pháp bù trừ trực tiếp, với công thức, thời điểm và chu kỳ điều chỉnh ghi trong hợp đồng."
        ),
        {"price_basis": "adjustable"},
    ),
    "vn_nd37_time_based": _vn_template(
        "Hợp đồng tư vấn xây dựng theo thời gian - NĐ 37/2015 (sửa đổi NĐ 50/2021)",
        "tm",
        (
            "Giá hợp đồng theo thời gian (Nghị định 37/2015/NĐ-CP, Điều 15): xác định trên cơ sở mức thù lao "
            "cho chuyên gia, các khoản chi phí ngoài thù lao và thời gian làm việc thực tế được nghiệm thu, "
            "không vượt mức trần ghi trong hợp đồng."
        ),
        (
            "Mức thù lao được điều chỉnh theo thời điểm và phương pháp thỏa thuận trong hợp đồng; thời gian "
            "làm việc thay đổi do bên giao thầu yêu cầu được lập thành phụ lục hợp đồng."
        ),
    ),
    "consensusdocs_300_ipd": _ipd_template(
        "ConsensusDocs 300 style - Integrated Project Delivery multi-party agreement (outline)",
        "consensusdocs",
    ),
    "aia_c191_ipd": _ipd_template(
        "AIA C191 style - Integrated Project Delivery multi-party agreement (outline)",
        "aia",
    ),
}


def minimum_advance_percent(tiers: list[list[Any]] | None, contract_value: Any) -> str | None:
    """The minimum advance for ``contract_value`` under ``tiers``, or ``None``.

    ``None`` when the template states no tiers or the value is not a number.
    """
    if not tiers:
        return None
    try:
        value = Decimal(str(contract_value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    for bound, percent in tiers:
        if bound is None or value <= Decimal(str(bound)):
            return str(percent)
    return None
