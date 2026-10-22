// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A line typed from the keyboard alone keeps every keystroke.
 *
 * Reported on the bill editor: after "Add position" the estimator types the
 * description, Tab, the unit, Tab, the quantity, Tab, the rate, Enter. Typed at
 * speed, the quantity and the rate were appended to the description
 * ("...35-40m32000500000") and saved as 0; Tab after the unit skipped the
 * quantity or left the grid for the markups panel; keys typed into the
 * description editor reached the page shortcuts.
 *
 * This drives the real grid. Each keystroke is delivered the way a browser
 * delivers it: a keydown on the focused element and, unless a handler cancels
 * it, the character typed into the focused field. The "burst" case sends a
 * whole line without yielding between keys, so every editor is still mounting
 * when the next keys arrive.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { createElement, createRef } from 'react';

import BOQGrid, { type BOQGridHandle } from '../BOQGrid';
import type { Position } from '../api';
import { usePreferencesStore } from '@/stores/usePreferencesStore';

vi.mock('@/features/collab_locks', () => ({
  acquireLock: vi.fn(async () => ({ ok: true, lock: { id: 'lock-test' } })),
  releaseLock: vi.fn(async () => undefined),
}));

beforeAll(() => {
  for (const prop of ['clientHeight', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  for (const prop of ['clientWidth', 'offsetWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1600 });
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: 1600, height: 800, top: 0, left: 0, bottom: 800, right: 1600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentElement; },
  });
});

beforeEach(() => {
  usePreferencesStore.getState().resetPreferences();
  usePreferencesStore.getState().setPreference('measurementSystem', 'metric');
});

afterEach(() => {
  cleanup();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function line(n: number, extra: Partial<Position> = {}): Position {
  return {
    id: `pos-${n}`, boq_id: 'boq-1', ordinal: `0${n}`, description: `Position ${n}`, unit: 'm2',
    quantity: 10, unit_rate: 5, total: 50, parent_id: null, position_type: 'position',
    validation_status: 'valid', metadata: {}, ...extra,
  } as unknown as Position;
}

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitUntil(cond: () => boolean, what: string, timeoutMs = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await flush(20);
  }
}

/** What went wrong while typing, in the words of the report. */
const mishaps: string[] = [];

/** One keystroke as the browser delivers it, without yielding to React. */
function strike(key: string, shiftKey = false): void {
  const target = (document.activeElement ?? document.body) as HTMLElement;
  const ev = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  const notCancelled = target.dispatchEvent(ev);
  if (!notCancelled) return;
  if (key === 'Tab') {
    mishaps.push(`Tab left the grid from ${target.tagName}`);
    return;
  }
  if (Array.from(key).length !== 1) return;
  const field = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA')) {
    field.setRangeText(key, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    mishaps.push(`'${key}' typed on ${target.tagName}.${target.className.toString().split(' ')[0]}`);
  }
}

/** The keystrokes of one line: description, unit, quantity, rate, Enter. */
function lineKeys(desc: string, unit: string, qty: string, rate: string): string[] {
  return [...desc, 'Tab', ...unit, 'Tab', ...qty, 'Tab', ...rate, 'Enter'];
}

async function renderGrid(positions: Position[], onAddPosition = vi.fn()) {
  const onUpdatePosition = vi.fn();
  const ref = createRef<BOQGridHandle>();
  render(createElement(BOQGrid, {
    ref,
    positions,
    onUpdatePosition,
    onDeletePosition: () => undefined,
    onAddPosition,
    onSelectSuggestion: () => undefined,
    onSaveToDatabase: () => undefined,
    onFormulaApplied: () => undefined,
    onActiveRowChange: () => undefined,
    collapsedSections: new Set<string>(),
    onToggleSection: () => undefined,
    currencySymbol: '₫',
    currencyCode: 'VND',
    locale: 'vi-VN',
    footerRows: [{
      _isFooter: true, _footerType: 'direct', id: 'f-direct', description: 'Chi phí trực tiếp',
      total: 100, ordinal: '', unit: '', quantity: 0, unit_rate: 0,
    }],
  } as never));
  await waitUntil(
    () => !!document.querySelector(`.ag-row[row-id="${positions[positions.length - 1]!.id}"] .ag-cell[col-id="description"]`),
    'rows rendered',
  );
  return { ref, onUpdatePosition, onAddPosition };
}

async function openNewLine(ref: React.RefObject<BOQGridHandle>, id: string) {
  await act(async () => {
    ref.current!.beginEditDescription(id);
  });
  await waitUntil(() => document.activeElement?.tagName === 'TEXTAREA', 'description editor focused');
}

function savedFields(onUpdatePosition: ReturnType<typeof vi.fn>, id: string): Record<string, unknown> {
  return Object.assign({}, ...onUpdatePosition.mock.calls.filter((c) => c[0] === id).map((c) => c[1]));
}

describe('a line typed from the keyboard alone', () => {
  it('lands each value in its own cell when typed key by key', async () => {
    mishaps.length = 0;
    const fresh = line(3, { description: '', quantity: 0, unit_rate: 0, total: 0 });
    const { ref, onUpdatePosition, onAddPosition } = await renderGrid([line(1), line(2), fresh]);
    await openNewLine(ref, 'pos-3');

    for (const key of lineKeys('Tường vây', 'm3', '22000', '7500000')) {
      await act(async () => strike(key));
      await flush(5);
    }
    await flush(100);

    expect(mishaps).toEqual([]);
    expect(savedFields(onUpdatePosition, 'pos-3')).toEqual({
      description: 'Tường vây', unit: 'm3', quantity: 22000, unit_rate: 7500000,
    });
    // Enter on the rate of the last new line asks for the next line.
    expect(onAddPosition).toHaveBeenCalledTimes(1);
  });

  it('keeps every keystroke when the whole line arrives before any editor has mounted', async () => {
    mishaps.length = 0;
    const fresh = line(3, { description: '', quantity: 0, unit_rate: 0, total: 0 });
    const { ref, onUpdatePosition } = await renderGrid([line(1), line(2), fresh]);
    await openNewLine(ref, 'pos-3');

    // Outside act: React renders the next editor only when the test yields.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    for (const key of lineKeys('Đào đất', 'm3', '300000', '150000')) strike(key);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await waitUntil(() => 'unit_rate' in savedFields(onUpdatePosition, 'pos-3'), 'rate saved');
    await flush(100);

    expect(mishaps).toEqual([]);
    expect(savedFields(onUpdatePosition, 'pos-3')).toEqual({
      description: 'Đào đất', unit: 'm3', quantity: 300000, unit_rate: 150000,
    });
  });

  it('goes from the unit to the quantity editor, not out of the grid', async () => {
    mishaps.length = 0;
    const fresh = line(3, { description: '', quantity: 0, unit_rate: 0, total: 0 });
    const { ref } = await renderGrid([line(1), line(2), fresh]);
    await openNewLine(ref, 'pos-3');

    for (const key of ['X', 'Tab', 'e', 'a', 'Tab']) {
      await act(async () => strike(key));
      await flush(5);
    }
    await flush(50);

    expect(mishaps).toEqual([]);
    const editing = document.activeElement?.closest('.ag-popup-editor, .ag-cell-inline-editing');
    expect(editing, 'an editor must have the focus').toBeTruthy();
    // The quantity editor is the formula popup; its input carries the help toggle.
    const quantityCell = document.querySelector('.ag-row[row-id="pos-3"] .ag-cell[col-id="quantity"]');
    expect(quantityCell?.className).toContain('ag-cell-focus');
  });

  it('does not add a line when Enter confirms a corrected rate on an existing line', async () => {
    mishaps.length = 0;
    const { onAddPosition, onUpdatePosition } = await renderGrid([line(1), line(2)]);
    const rateCell = document.querySelector<HTMLElement>('.ag-row[row-id="pos-2"] .ag-cell[col-id="unit_rate"]')!;
    await act(async () => {
      rateCell.focus();
      strike('9');
    });
    await flush(30);
    await act(async () => strike('Enter'));
    await flush(50);

    expect(savedFields(onUpdatePosition, 'pos-2')).toEqual({ unit_rate: 9 });
    expect(onAddPosition).not.toHaveBeenCalled();
    // The focus is back on the cell, not on the page body.
    expect(document.activeElement?.getAttribute('col-id')).toBe('unit_rate');
  });
});
