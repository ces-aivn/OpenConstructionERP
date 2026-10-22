/**
 * The row menu stays inside a 746 px tall window, scrolls, and closes on Escape.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { ContextMenuFrame, placeMenu } from './ContextMenuFrame';

afterEach(() => cleanup());

const laptop = { width: 1512, height: 746 };

describe('placeMenu', () => {
  it('opens below the pointer when the menu fits there', () => {
    expect(placeMenu({ x: 100, y: 100 }, { width: 240, height: 300 }, laptop)).toEqual({
      left: 100, top: 100, maxHeight: 730,
    });
  });

  it('opens above the pointer near the bottom of the window', () => {
    const p = placeMenu({ x: 100, y: 600 }, { width: 240, height: 300 }, laptop);
    expect(p.top).toBe(300);
  });

  it('keeps a thirty-item menu on a 746 px screen, scrolling inside', () => {
    const p = placeMenu({ x: 1442, y: 153 }, { width: 240, height: 30 * 30 }, laptop);
    expect(p.maxHeight).toBe(730);
    expect(p.top).toBe(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(laptop.height);
    // Opened at the "..." button on the right edge: flipped to its left.
    expect(p.left + 240).toBeLessThanOrEqual(laptop.width - 8);
  });
});

describe('ContextMenuFrame', () => {
  function renderMenu(onClose = vi.fn()) {
    render(
      <ContextMenuFrame x={10} y={10} onClose={onClose} label="Actions">
        <div data-testid="list">
          <button type="button">Copy</button>
          <button type="button">Delete</button>
        </div>
      </ContextMenuFrame>,
    );
    return onClose;
  }

  it('is a scrollable menu capped to the window height', () => {
    renderMenu();
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.className).toContain('overflow-y-auto');
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 16}px`);
  });

  it('closes on Escape', () => {
    const onClose = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts the focus on its first action and walks with the arrow keys to Delete', () => {
    renderMenu();
    expect(document.activeElement?.textContent).toBe('Copy');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Delete');
  });

  it('gives the focus back to where it was when it closes', () => {
    const cell = document.createElement('div');
    cell.tabIndex = -1;
    document.body.appendChild(cell);
    cell.focus();
    const { unmount } = render(
      <ContextMenuFrame x={10} y={10} onClose={vi.fn()} label="Actions">
        <button type="button">Copy</button>
      </ContextMenuFrame>,
    );
    expect(document.activeElement?.textContent).toBe('Copy');
    unmount();
    expect(document.activeElement).toBe(cell);
    cell.remove();
  });

  it('leaves the focus alone when an action already moved it elsewhere', () => {
    const cell = document.createElement('div');
    cell.tabIndex = -1;
    const dialogInput = document.createElement('input');
    document.body.append(cell, dialogInput);
    cell.focus();
    const { unmount } = render(
      <ContextMenuFrame x={10} y={10} onClose={vi.fn()} label="Actions">
        <button type="button">Rename</button>
      </ContextMenuFrame>,
    );
    dialogInput.focus();
    unmount();
    expect(document.activeElement).toBe(dialogInput);
    cell.remove();
    dialogInput.remove();
  });

  it('closes when the page scrolls, not when its own list does', () => {
    const onClose = renderMenu();
    fireEvent.scroll(document.querySelector('[role="menu"]')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
