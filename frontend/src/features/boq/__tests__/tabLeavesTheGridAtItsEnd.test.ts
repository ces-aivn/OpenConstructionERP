// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tab walks the editable cells of the bill in order and, past the last one,
 * lets the focus leave the grid (WCAG 2.1.2, no keyboard trap).
 *
 * AG Grid 32 reads the answer of `tabToNextCell` as: a cell position to move
 * to, `true` to stay on the current cell, `false` to leave the keystroke to
 * the browser. Staying put whenever no editable cell was left made the grid a
 * trap, and a complete one on a locked bill, where nothing is editable.
 */
import { describe, expect, it, vi } from 'vitest';

import { nextEntryCell } from '../BOQGrid';
import { tabAndEdit } from '../grid/cellEditors';

type Row = Record<string, unknown>;

function column(id: string, editable: (data: Row) => boolean) {
  return {
    getColId: () => id,
    isSuppressNavigable: () => false,
    isCellEditable: (node: { data: Row }) => editable(node.data),
  };
}

function grid(rows: Row[], locked = false) {
  const editable = () => !locked;
  const columns = [
    column('_drag', () => false),
    column('ordinal', editable),
    column('description', editable),
    column('quantity', editable),
    column('total', () => false),
  ];
  const api = {
    getAllDisplayedColumns: () => columns,
    getDisplayedRowAtIndex: (i: number) => (rows[i] ? { data: rows[i] } : undefined),
    getDisplayedRowCount: () => rows.length,
  };
  return { api: api as never as Parameters<typeof nextEntryCell>[0], columns };
}

const LINES: Row[] = [
  { id: 's1', _isSection: true },
  { id: 'p1', parent_id: 's1' },
  { id: 'p2', parent_id: 's1' },
];

function at(rowIndex: number, columns: ReturnType<typeof grid>['columns'], colId: string) {
  const col = columns.find((c) => c.getColId() === colId)!;
  return { rowIndex, column: col, rowPinned: null } as never as Parameters<typeof nextEntryCell>[1];
}

function where(result: ReturnType<typeof nextEntryCell>): string | false {
  return result === false ? false : `${result.rowIndex}:${result.column.getColId()}`;
}

describe('Tab in the BOQ grid', () => {
  it('walks every editable cell in order, skipping sections and read-only columns', () => {
    const { api, columns } = grid(LINES);
    const visited: string[] = [];
    let cell = at(1, columns, 'ordinal');
    for (;;) {
      const next = nextEntryCell(api, cell, false);
      if (next === false) break;
      visited.push(where(next) as string);
      cell = next;
    }
    expect(visited).toEqual(['1:description', '1:quantity', '2:ordinal', '2:description', '2:quantity']);
  });

  it('lets the focus leave the grid after the last editable cell', () => {
    const { api, columns } = grid(LINES);
    expect(nextEntryCell(api, at(2, columns, 'quantity'), false)).toBe(false);
  });

  it('lets Shift+Tab leave the grid before the first editable cell', () => {
    const { api, columns } = grid(LINES);
    expect(nextEntryCell(api, at(1, columns, 'ordinal'), true)).toBe(false);
  });

  it('never traps the focus on a locked bill', () => {
    const { api, columns } = grid(LINES, true);
    expect(nextEntryCell(api, at(1, columns, 'description'), false)).toBe(false);
    expect(nextEntryCell(api, at(2, columns, 'description'), true)).toBe(false);
  });

  it("follows the grid's own move on a pinned totals row, and leaves when it has none", () => {
    const { api, columns } = grid(LINES);
    const pinned = { ...at(0, columns, 'ordinal'), rowPinned: 'bottom' } as never as Parameters<typeof nextEntryCell>[1];
    const gridNext = { ...at(0, columns, 'description'), rowPinned: 'bottom' } as never as Parameters<typeof nextEntryCell>[1];
    expect(nextEntryCell(api, pinned, false, gridNext)).toBe(gridNext);
    expect(nextEntryCell(api, pinned, false, null)).toBe(false);
  });
});

describe('Tab out of an open editor with no editable cell left', () => {
  it('keeps the focus on the cell instead of dropping it to the page', () => {
    const setFocusedCell = vi.fn();
    const startEditingCell = vi.fn();
    tabAndEdit(
      {
        tabToNextCell: () => false,
        tabToPreviousCell: () => false,
        getFocusedCell: () => ({ rowIndex: 2, rowPinned: null, column: { getColId: () => 'quantity' } }),
        setFocusedCell,
        startEditingCell,
      },
      false,
    );
    expect(setFocusedCell).toHaveBeenCalledWith(2, 'quantity', null);
    expect(startEditingCell).not.toHaveBeenCalled();
  });
});
