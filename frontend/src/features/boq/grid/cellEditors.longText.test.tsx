/**
 * The description editor holds the focus and moves on with Tab.
 *
 * AG Grid's own large-text editor focused its textarea only when a user gesture
 * opened it, and a click on its popup frame moved the focus to the frame. Keys
 * then went to the page shortcuts and the description was never saved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { LongTextCellEditor, tabAndEdit, type LongTextCellEditorParams } from './cellEditors';

function renderEditor(over: Partial<LongTextCellEditorParams> = {}) {
  const api = {
    stopEditing: vi.fn(),
    tabToNextCell: vi.fn(() => true),
    tabToPreviousCell: vi.fn(() => true),
    getFocusedCell: vi.fn(() => ({ rowIndex: 2, rowPinned: null, column: { getColId: () => 'unit', isCellEditable: () => true } })),
    getDisplayedRowAtIndex: vi.fn(() => ({ id: 'row' })),
    startEditingCell: vi.fn(),
    setFocusedCell: vi.fn(),
  };
  const setDataValue = vi.fn();
  const params = {
    value: 'Tường vây',
    data: { id: 'p1', description: 'Tường vây' },
    node: { rowIndex: 2, data: { id: 'p1', description: 'Tường vây' }, setDataValue },
    api,
    column: { getColId: () => 'description' },
    ...over,
  } as unknown as LongTextCellEditorParams;
  render(<LongTextCellEditor {...params} />);
  const area = document.querySelector('textarea') as HTMLTextAreaElement;
  return { api, setDataValue, area };
}

describe('LongTextCellEditor', () => {
  beforeEach(() => cleanup());

  it('takes the focus when it opens, with the stored text selected', () => {
    const { area } = renderEditor();
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe(area.value.length);
  });

  it('starts from the key that opened it', () => {
    const { area } = renderEditor({ eventKey: 'B' } as Partial<LongTextCellEditorParams>);
    expect(area.value).toBe('B');
  });

  it('keeps the focus when the frame around the textarea is clicked', () => {
    const { area } = renderEditor();
    const frame = area.parentElement as HTMLElement;
    const notCancelled = fireEvent.mouseDown(frame);
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(area);
  });

  it('saves on Tab and opens the editor of the next cell', () => {
    const { area, api, setDataValue } = renderEditor();
    fireEvent.input(area, { target: { value: 'Tường vây dày 1,0 m' } });
    const notCancelled = fireEvent.keyDown(area, { key: 'Tab' });
    expect(notCancelled).toBe(false);
    expect(setDataValue).toHaveBeenCalledWith('description', 'Tường vây dày 1,0 m');
    expect(api.stopEditing).toHaveBeenCalledWith(true);
    expect(api.tabToNextCell).toHaveBeenCalledTimes(1);
    expect(api.startEditingCell).toHaveBeenCalledWith({ rowIndex: 2, colKey: 'unit' });
  });

  it('keeps Shift+Enter as a new line and saves on Enter', () => {
    const { area, setDataValue } = renderEditor();
    expect(fireEvent.keyDown(area, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(setDataValue).not.toHaveBeenCalled();
    fireEvent.input(area, { target: { value: 'x' } });
    expect(fireEvent.keyDown(area, { key: 'Enter' })).toBe(false);
    expect(setDataValue).toHaveBeenCalledWith('description', 'x');
  });

  it('saves nothing on Escape', () => {
    const { area, setDataValue, api } = renderEditor();
    fireEvent.input(area, { target: { value: 'x' } });
    fireEvent.keyDown(area, { key: 'Escape' });
    fireEvent.blur(area);
    expect(setDataValue).not.toHaveBeenCalled();
    expect(api.stopEditing).toHaveBeenCalledWith(true);
  });
});

describe('tabAndEdit', () => {
  it('does not open an editor on a cell the user cannot edit', () => {
    const api = {
      tabToNextCell: vi.fn(() => true),
      tabToPreviousCell: vi.fn(() => true),
      getFocusedCell: () => ({ rowIndex: 0, rowPinned: null, column: { getColId: () => 'total', isCellEditable: () => false } }),
      getDisplayedRowAtIndex: () => ({}),
      startEditingCell: vi.fn(),
    };
    tabAndEdit(api, false);
    expect(api.startEditingCell).not.toHaveBeenCalled();
  });

  it('never opens an editor on a totals row', () => {
    const api = {
      tabToNextCell: vi.fn(() => true),
      tabToPreviousCell: vi.fn(() => true),
      getFocusedCell: () => ({ rowIndex: 0, rowPinned: 'bottom', column: { getColId: () => 'description', isCellEditable: () => true } }),
      getDisplayedRowAtIndex: () => ({}),
      startEditingCell: vi.fn(),
    };
    tabAndEdit(api, true);
    expect(api.tabToPreviousCell).toHaveBeenCalled();
    expect(api.startEditingCell).not.toHaveBeenCalled();
  });
});
