/**
 * Keys typed while a cell editor is still opening are held and typed into it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createKeystrokeBuffer, isHoldableKey, type KeystrokeBuffer } from './keystrokeBuffer';

let root: HTMLDivElement;
let cell: HTMLDivElement;
let editing = 0;
let buffer: KeystrokeBuffer;

function key(target: Element, k: string, init: KeyboardEventInit = {}): boolean {
  return target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

/** Mount an editor input the way the grid does: inside an editing cell. */
function mountEditor(value = ''): HTMLInputElement {
  const frame = document.createElement('div');
  frame.className = 'ag-cell-inline-editing';
  const input = document.createElement('input');
  input.value = value;
  frame.appendChild(input);
  root.appendChild(frame);
  return input;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  root = document.createElement('div');
  cell = document.createElement('div');
  cell.tabIndex = -1;
  cell.className = 'ag-cell';
  root.appendChild(cell);
  document.body.appendChild(root);
  editing = 0;
  buffer = createKeystrokeBuffer(root, () => ({ getEditingCells: () => Array.from({ length: editing }) }));
});

afterEach(() => {
  buffer.dispose();
  root.remove();
});

describe('isHoldableKey', () => {
  it('holds characters, Backspace, Tab and Enter only', () => {
    expect(isHoldableKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isHoldableKey({ key: 'ê', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isHoldableKey({ key: 'Tab', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isHoldableKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isHoldableKey({ key: 'z', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isHoldableKey({ key: 'e', ctrlKey: false, metaKey: false, altKey: true })).toBe(false);
  });
});

describe('createKeystrokeBuffer', () => {
  it('lets keys through when nothing is being edited', () => {
    cell.focus();
    expect(key(cell, 's')).toBe(true);
    expect(buffer.pending()).toBe(0);
  });

  it('holds the keys typed on a cell while its editor mounts, then types them into it', async () => {
    cell.focus();
    editing = 1;
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    expect(key(cell, '1')).toBe(false);
    expect(key(cell, '2')).toBe(false);
    document.removeEventListener('keydown', seen);
    expect(seen, 'held keys must not reach the page shortcuts').not.toHaveBeenCalled();

    const input = mountEditor();
    input.focus();
    await wait(60);

    expect(input.value).toBe('12');
    expect(buffer.pending()).toBe(0);
  });

  it('waits for the editor to take the focus itself before typing into it', async () => {
    cell.focus();
    editing = 1;
    key(cell, '7');
    const input = mountEditor('old');
    await wait(30);
    // The editor selects its stored value when it focuses; the held key then replaces it.
    input.focus();
    input.select();
    await wait(60);

    expect(input.value).toBe('7');
  });

  it('keeps later keys in order behind the held ones, even once the editor has the focus', async () => {
    cell.focus();
    editing = 1;
    key(cell, 'a');
    const input = mountEditor();
    input.focus();
    key(input, 'b');
    await wait(60);

    expect(input.value).toBe('ab');
  });

  it('replays Tab into the editor and sends the rest to the next one', async () => {
    cell.focus();
    editing = 1;
    for (const k of ['e', 'a', 'Tab', '1', '0']) key(cell, k);

    const unit = mountEditor();
    const onTab = vi.fn((ev: KeyboardEvent) => {
      if (ev.key !== 'Tab') return;
      ev.preventDefault();
      unit.parentElement!.remove();
      // The next editor opens a moment later.
      setTimeout(() => {
        const qty = mountEditor();
        qty.id = 'qty';
        qty.focus();
      }, 20);
    });
    unit.addEventListener('keydown', onTab);
    unit.focus();
    await wait(200);

    expect(unit.value).toBe('ea');
    expect(onTab).toHaveBeenCalledTimes(1);
    expect((root.querySelector('#qty') as HTMLInputElement).value).toBe('10');
  });

  it('when armed, holds keys until a new editor opens', async () => {
    cell.focus();
    buffer.arm(1000);
    expect(key(cell, 'W')).toBe(false);
    await wait(40);
    expect(buffer.pending()).toBe(1);

    editing = 1;
    const desc = mountEditor();
    desc.focus();
    await wait(60);

    expect(desc.value).toBe('W');
  });

  it('drops what was typed for a new line that never opened', async () => {
    cell.focus();
    buffer.arm(80);
    key(cell, 'W');
    await wait(200);

    expect(buffer.pending()).toBe(0);
  });

  it('never holds a key typed outside its grid', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    editing = 1;
    outside.focus();
    expect(key(outside, 'x')).toBe(true);
    outside.remove();
  });
});
