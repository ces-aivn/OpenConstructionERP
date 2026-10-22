// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Errors a screen has said it reports itself, without a toast.
 *
 * A failed write raises a deferred "not saved" toast from the API client
 * unless something else reports it. A screen that shows the failure inline
 * (a form message, a dialog) marks its mutation with
 * `meta: { suppressGlobalErrorToast: true }`; the mutation cache marks the
 * error here so the API client's deferred toast stays quiet too. A WeakSet
 * keeps no error alive after the screen lets go of it.
 */
const reported = new WeakSet<object>();

/** Record that `error` (and the error it wraps, if any) is already reported. */
export function markErrorReported(error: unknown): void {
  if (typeof error !== 'object' || error === null) return;
  reported.add(error);
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) reported.add(cause);
}

/** True when a screen has said it reports `error` itself. */
export function isErrorReported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && reported.has(error);
}
