// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Holds the keystrokes typed while a BOQ cell editor is still opening, and
 * types them into it once it has the focus.
 *
 * An estimator entering lines from the keyboard types straight on after Tab:
 * "Wall, Tab, m3, Tab, 12, Tab, 85000, Enter". Each Tab closes one editor and
 * opens the next, and the next one is a React component that mounts and takes
 * the focus a frame or two later. Until it does, the focus sits on a grid cell
 * (often the cell just left), so the keys typed in that gap went to the wrong
 * place: they reopened the previous cell (the quantity and the rate ended up
 * appended to the description, "...35-40m32000500000", while both numbers
 * stayed 0), started a fresh edit that dropped every character but the first,
 * or reached the page's single-key shortcuts. This buffer takes those keys in
 * the capture phase, before anything else sees them, and replays them in order
 * into the editor that opens.
 *
 * It only ever holds keys while an editor of its grid is open but not yet
 * focused, while earlier keys are still waiting, or while the grid has said a
 * new line is on its way (``arm``). Keys with Ctrl, Cmd or Alt are never held.
 */

/** The grid calls the buffer needs; a subset of AG Grid's ``GridApi``. */
export interface KeystrokeBufferApi {
  getEditingCells: () => unknown[];
}

interface HeldKey {
  key: string;
  shiftKey: boolean;
}

const EDITOR_FIELD = 'input, textarea, select, button, [contenteditable="true"]';
const EDITOR_FRAME = '.ag-popup-editor, .ag-cell-inline-editing';
const EDITOR_INPUT_SELECTOR = [
  '.ag-popup-editor textarea',
  '.ag-popup-editor input',
  '.ag-cell-inline-editing textarea',
  '.ag-cell-inline-editing input',
].join(', ');

/** How long a held key waits for an editor before it is let go. */
const SETTLE_MS = 1500;
/** How long an editor that has mounted may take to focus itself. */
const SELF_FOCUS_MS = 120;
const POLL_MS = 16;

/** A key the buffer may hold: a character, Backspace, Tab or Enter, with no command modifier. */
export function isHoldableKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & { isComposing?: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const key = e.key ?? '';
  if (Array.from(key).length === 1) return true;
  return key === 'Backspace' || key === 'Tab' || key === 'Enter';
}

/** The text field of the editor that is open in ``root``, if one has mounted. */
export function findOpenEditorInput(root: ParentNode): HTMLInputElement | HTMLTextAreaElement | null {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active && (active as Element).matches?.(EDITOR_INPUT_SELECTOR) && root.contains(active)) {
    return active as HTMLInputElement | HTMLTextAreaElement;
  }
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement>(EDITOR_INPUT_SELECTOR);
}

function isEditorField(el: Element | null): boolean {
  return !!el && typeof el.matches === 'function' && el.matches(EDITOR_FIELD) && el.closest(EDITOR_FRAME) !== null;
}

/** Type one character at the caret, replacing a selection, as the browser would. */
function insertText(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const max = el.maxLength > 0 ? el.maxLength : Infinity;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (el.value.length - (end - start) + text.length > max) return;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function deleteBackward(el: HTMLInputElement | HTMLTextAreaElement): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (start !== end) el.setRangeText('', start, end, 'end');
  else if (start > 0) el.setRangeText('', start - 1, start, 'end');
  else return;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export interface KeystrokeBuffer {
  /** Hold every key until a NEW editor opens or ``ms`` pass (a line is being added). */
  arm: (ms: number) => void;
  /** Stop listening and forget anything held. */
  dispose: () => void;
  /** Number of keys waiting; for tests. */
  pending: () => number;
}

/**
 * Listen in the capture phase of the window, ahead of every document-level
 * shortcut handler, and hold the keys meant for the editors of the grid inside
 * ``root``.
 */
export function createKeystrokeBuffer(
  root: HTMLElement,
  getApi: () => KeystrokeBufferApi | null,
  doc: Document = document,
): KeystrokeBuffer {
  const queue: HeldKey[] = [];
  const replayed = new WeakSet<Event>();
  let armedUntil = 0;
  // The editor that was open when the last Tab / Enter was replayed, or when
  // the buffer was armed: the next key waits for a different one.
  let waitingPast: Element | null = null;
  let waitUntil = 0;
  let seenEditor: { el: Element; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const now = () => Date.now();
  const isArmed = () => armedUntil > now();
  const editing = () => (getApi()?.getEditingCells().length ?? 0) > 0;

  const schedule = (ms = POLL_MS) => {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, ms);
  };

  /** Hand a key to whatever has the focus, as if it had been typed there. */
  const dispatchTo = (target: Element, held: HeldKey): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', {
      key: held.key,
      shiftKey: held.shiftKey,
      bubbles: true,
      cancelable: true,
    });
    replayed.add(ev);
    target.dispatchEvent(ev);
    return ev;
  };

  const flush = () => {
    if (disposed) return;
    while (queue.length > 0) {
      const editor = findOpenEditorInput(root);
      const waitingForNew = waitingPast !== null || isArmed();
      const fresh = editor !== null && editor !== waitingPast;

      if (waitingForNew && !fresh) {
        // The previous key moved on (Tab, Enter) or a line is being added. If
        // nothing is opening any more, that move ended without an editor.
        const deadline = isArmed() ? armedUntil : waitUntil;
        const nothingOpening = !isArmed() && editor === null && !editing();
        if (!nothingOpening && now() < deadline) {
          schedule();
          return;
        }
        if (isArmed()) {
          // The new line never came (the add failed): what was typed for it
          // has nowhere sensible to go.
          queue.length = 0;
          armedUntil = 0;
          waitingPast = null;
          return;
        }
        waitingPast = null;
        continue;
      }
      waitingPast = null;
      armedUntil = 0;

      if (editor === null) {
        if (editing() && now() < waitUntil) {
          // An editor is opening but has not mounted yet.
          schedule();
          return;
        }
        // Nothing is being edited: give the key to the focused cell, which
        // starts an edit with it exactly as the typed key would have.
        const target = (doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement : null);
        const held = queue.shift()!;
        if (target) {
          dispatchTo(target, held);
          waitUntil = now() + SETTLE_MS;
        }
        continue;
      }

      // Give a freshly mounted editor a moment to take the focus itself, so
      // its own "select all on open" cannot select what is replayed into it.
      if (doc.activeElement !== editor) {
        if (!seenEditor || seenEditor.el !== editor) seenEditor = { el: editor, at: now() };
        if (now() - seenEditor.at < SELF_FOCUS_MS) {
          schedule();
          return;
        }
        editor.focus();
      }

      const held = queue.shift()!;
      if (held.key === 'Tab' || held.key === 'Enter') {
        dispatchTo(editor, held);
        waitingPast = editor;
        waitUntil = now() + SETTLE_MS;
        continue;
      }
      if (held.key === 'Backspace') deleteBackward(editor);
      else insertText(editor, held.key);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (replayed.has(e) || !isHoldableKey(e)) return;
    const target = e.target as Element | null;
    const inGrid = !!target && (target === doc.body || root.contains(target));
    if (!inGrid) return;
    let hold = queue.length > 0 || isArmed();
    if (!hold && editing() && !isEditorField(target)) {
      // An editor is open, but the focus is not in it yet.
      hold = true;
    }
    if (!hold) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (queue.length === 0 && !isArmed()) waitUntil = now() + SETTLE_MS;
    queue.push({ key: e.key, shiftKey: e.shiftKey });
    schedule(0);
  };

  const listenOn: EventTarget = doc.defaultView ?? doc;
  listenOn.addEventListener('keydown', onKeyDown as EventListener, true);

  return {
    arm(ms: number) {
      armedUntil = now() + ms;
      waitingPast = findOpenEditorInput(root);
    },
    dispose() {
      disposed = true;
      listenOn.removeEventListener('keydown', onKeyDown as EventListener, true);
      if (timer !== null) clearTimeout(timer);
      queue.length = 0;
    },
    pending: () => queue.length,
  };
}
