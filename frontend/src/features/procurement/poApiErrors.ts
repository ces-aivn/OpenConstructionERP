// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The text a refused purchase-order action shows.
//
// A coded refusal is translated by `getErrorMessage` from its `code`. The
// approval gate's refusal (`po_validation_failed`) also carries `errors`, one
// per failing rule, each already worded in the request's language; the toast
// used to say "see the errors listed below" and list none. They are appended
// here so the buyer reads what to fix.

import { ApiError, getErrorMessage } from '@/shared/lib/api';

function ruleMessages(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const errors = (detail as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((entry) =>
      entry && typeof entry === 'object' && typeof (entry as { message?: unknown }).message === 'string'
        ? (entry as { message: string }).message.trim()
        : '',
    )
    .filter((m) => m.length > 0);
}

/** The refusal of a purchase-order action, with each failing rule listed after it. */
export function describePOActionError(err: unknown): string {
  const head = getErrorMessage(err);
  if (!(err instanceof ApiError)) return head;
  const rules = ruleMessages(err.body);
  return rules.length > 0 ? `${head} ${rules.join('; ')}` : head;
}
