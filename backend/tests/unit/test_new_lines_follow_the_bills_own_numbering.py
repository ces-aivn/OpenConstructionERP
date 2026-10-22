"""A new line continues the numbering the bill already uses.

A bill pasted from a spreadsheet is numbered one by one (01 ... 12). A line
added to it was numbered 0020 by the gap-of-10 rule, which reads as a
different scheme and sorts oddly; the cost database's own add wrote 01.031.
Both now continue the bill's numbering: 13 after 12, 01.3 after 01.2, while a
bill already on the gap-of-10 scheme keeps it.
"""

from app.modules.boq.service import next_position_ordinals


def test_a_bill_numbered_one_by_one_continues_one_by_one_at_its_width():
    sofi = [f"{n:02d}" for n in range(1, 13)]
    assert next_position_ordinals(sofi, None, 2) == ["13", "14"]


def test_a_section_numbered_one_by_one_continues_inside_the_section():
    assert next_position_ordinals(["01", "01.1", "01.2", "02"], "01", 1) == ["01.3"]


def test_a_bill_on_the_gap_of_ten_scheme_keeps_it():
    assert next_position_ordinals(["0010", "0020"], None, 1) == ["0030"]
    assert next_position_ordinals(["01", "01.010", "01.020"], "01", 1) == ["01.030"]


def test_one_line_slotted_in_between_does_not_change_the_scheme():
    assert next_position_ordinals(["01", "01.10", "01.15", "01.20"], "01", 1) == ["01.30"]


def test_section_headers_alone_do_not_make_positions_count_one_by_one():
    assert next_position_ordinals(["01"], None, 1) == ["0010"]


def test_a_taken_number_is_skipped():
    assert next_position_ordinals(["01", "02", "03", "04"], None, 2) == ["05", "06"]
    assert next_position_ordinals(["01", "02", "03", "05"], None, 1) == ["06"]
