// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The frame of the BOQ row menu ("..." and right-click).
 *
 * The position menu holds about thirty actions. It used to be placed from a
 * fixed height estimate (360 px) with no scrolling, so on a 746 px tall screen
 * its last items, Delete among them, sat below the window and could not be
 * reached; Escape did not close it and it stayed hanging when the page
 * scrolled. The frame now measures the menu, opens it below or above the
 * pointer where it fits, never taller than the window (scrolling inside when
 * it is longer), closes on Escape, on a scroll outside it and on a resize, and
 * puts the focus on its first action so the keyboard reaches every item.
 *
 * When it closes with the focus still inside it, or lost to the page body,
 * the focus goes back to where it was before the menu opened. Left on the
 * body, the next letter typed reached the page's single-key shortcuts ("s"
 * opened the update-rates dialog) instead of the grid.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Where a menu of ``size`` opened at ``anchor`` goes in a ``viewport``: below
 * the anchor when it fits, above when that fits, otherwise as high as needed to
 * keep it on screen, and never taller than the viewport less the margins.
 */
export function placeMenu(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): MenuPlacement {
  const maxHeight = Math.max(80, viewport.height - margin * 2);
  const height = Math.min(size.height, maxHeight);
  let top: number;
  if (anchor.y + height <= viewport.height - margin) top = anchor.y;
  else if (anchor.y - height >= margin) top = anchor.y - height;
  else top = Math.max(margin, viewport.height - margin - height);
  let left = anchor.x;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, anchor.x - size.width);
  left = Math.max(margin, Math.min(left, viewport.width - margin - size.width));
  return { left, top, maxHeight };
}

export interface ContextMenuFrameProps {
  x: number;
  y: number;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

export function ContextMenuFrame({ x, y, onClose, label, children }: ContextMenuFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  // Read on the first render, before the menu takes the focus.
  const [returnFocusTo] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );

  useEffect(() => {
    const menu = ref.current;
    return () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || (menu?.contains(active) ?? false);
      if (!lost) return;
      if (returnFocusTo instanceof HTMLElement && returnFocusTo !== document.body && returnFocusTo.isConnected) {
        returnFocusTo.focus({ preventScroll: true });
      }
    };
  }, [returnFocusTo]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlacement(
      placeMenu(
        { x, y },
        { width: el.offsetWidth, height: el.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y]);

  // The keyboard starts on the first action, so Tab and the arrows reach all.
  useEffect(() => {
    if (!placement) return;
    const first = ref.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
  }, [placement]);

  const move = useCallback((step: 1 | -1) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!ref.current?.contains(document.activeElement)) return;
        e.preventDefault();
        e.stopPropagation();
        move(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    const onScroll = (e: Event) => {
      // Scrolling the menu's own list keeps it; scrolling the page closes it.
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, move]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-[9999] min-w-[200px] overflow-y-auto overscroll-contain rounded-lg border border-border-light bg-surface-elevated shadow-lg py-1"
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { left: x, top: y, visibility: 'hidden' }
      }
    >
      {children}
    </div>
  );
}
