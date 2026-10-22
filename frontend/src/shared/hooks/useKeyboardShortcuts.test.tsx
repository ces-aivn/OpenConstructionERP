/**
 * Global single-key shortcuts leave keys typed into a data grid alone.
 *
 * In the bill editor a key typed while a description editor was opening (the
 * focus on its popup frame or on the cell) reached these shortcuts: "g" then
 * "b" or "c" navigated away from the bill and the typing was lost.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { isTypingTarget, useKeyboardShortcuts } from './useKeyboardShortcuts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

let path = '';
function Probe() {
  useKeyboardShortcuts({ onOpenSearch: () => undefined, onToggleShortcutsDialog: () => undefined });
  path = useLocation().pathname;
  return null;
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/boq/1']}>
      <Probe />
    </MemoryRouter>,
  );
}

function grid(): { cell: HTMLElement; frame: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'ag-root-wrapper';
  const cell = document.createElement('div');
  cell.className = 'ag-cell';
  cell.tabIndex = -1;
  const frame = document.createElement('div');
  frame.className = 'ag-popup-editor';
  frame.tabIndex = -1;
  wrapper.append(cell, frame);
  document.body.appendChild(wrapper);
  return { cell, frame };
}

describe('isTypingTarget', () => {
  it('counts form fields, editable text and anything inside a data grid', () => {
    const { cell, frame } = grid();
    const input = document.createElement('input');
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.append(input, div);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(cell)).toBe(true);
    expect(isTypingTarget(frame)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('two-key navigation', () => {
  it('still navigates from the page itself', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(path).toBe('/costs');
  });

  it('does not navigate while the focus is on a grid cell', () => {
    mount();
    const { cell } = grid();
    cell.focus();
    fireEvent.keyDown(cell, { key: 'g' });
    fireEvent.keyDown(cell, { key: 'b' });
    expect(path).toBe('/boq/1');
  });

  it('does not navigate while a cell editor frame holds the focus', () => {
    mount();
    const { frame } = grid();
    frame.focus();
    fireEvent.keyDown(frame, { key: 'g' });
    fireEvent.keyDown(frame, { key: 'c' });
    expect(path).toBe('/boq/1');
  });
});
