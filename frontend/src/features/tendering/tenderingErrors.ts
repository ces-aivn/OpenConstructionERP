// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Word a refused tendering request in the reader's language.
 *
 * The server refuses a value with a stable code: a 422 validation entry
 * carries it as `type` beside the field in `loc`, a business refusal as
 * `detail.code`. The English `msg`/`message` beside it is for API callers, so
 * a Vietnamese buyer typing a negative bid saw "total_amount: must be zero or
 * more". The codes this module sends are worded here; anything else falls
 * back to the shared reader.
 */

import type { TFunction } from 'i18next';
import { ApiError, getErrorMessage } from '@/shared/lib/api';

/** A plain-text email shape check, the same one the server applies. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailShaped(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/** Whether a typed amount is a finite number of zero or more. Empty is allowed (read as 0). */
export function isNonNegativeAmount(value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0;
}

/** The English wording of each code, used as the default for its `api_errors.*` key. */
const CODE_DEFAULTS: Record<string, string> = {
  amount_negative: 'Amounts must be zero or more. A bid cannot be negative.',
  amount_not_a_number: 'Enter the amount as a number.',
  greater_than_equal: 'Amounts must be zero or more. A bid cannot be negative.',
  invalid_email: 'Enter a valid email address, for example name@company.com.',
  scope_position_not_in_bill: 'A chosen position is no longer in this bill of quantities. Reload and pick again.',
  scope_section_not_in_bill: 'A chosen section is no longer in this bill of quantities. Reload and pick again.',
  package_scope_locked: 'This package is awarded or closed, so its scope can no longer change.',
  package_has_no_bill: 'This package is not linked to a bill of quantities, so it has no lines to pick.',
  package_bill_unreadable: "The package's bill of quantities could not be read.",
};

function codedMessage(code: string, t: TFunction): string | null {
  const fallback = CODE_DEFAULTS[code];
  if (!fallback) return null;
  return String(t(`api_errors.${code}`, { defaultValue: fallback }));
}

/** The stable codes a response body carries, in the order the server sent them. */
export function errorCodes(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const detail = (body as Record<string, unknown>).detail;
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const e = entry as Record<string, unknown>;
        if (e.type === 'greater_than_equal') {
          const ctx = e.ctx as Record<string, unknown> | undefined;
          // Only "at least zero" means "not negative"; another bound is not ours to word.
          return ctx && Number(ctx.ge) === 0 ? 'greater_than_equal' : '';
        }
        return typeof e.type === 'string' ? e.type : '';
      })
      .filter(Boolean);
  }
  if (detail && typeof detail === 'object') {
    const code = (detail as Record<string, unknown>).code;
    return typeof code === 'string' ? [code] : [];
  }
  return [];
}

export function tenderingErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    for (const code of errorCodes(err.body)) {
      const text = codedMessage(code, t);
      if (text) return text;
    }
  }
  return getErrorMessage(err);
}

/** A recipient's send failure, worded by its code; the server's raw reason stays in the tooltip. */
export function recipientFailureText(code: string | null | undefined, t: TFunction): string {
  switch (code) {
    case 'missing_email':
      return String(t('tendering.send_error.missing_email', { defaultValue: 'No email address on file for this recipient.' }));
    case 'missing_recipient_id':
      return String(
        t('tendering.send_error.missing_recipient_id', {
          defaultValue: 'This recipient entry is incomplete. Remove it and add it again.',
        }),
      );
    default:
      return String(
        t('tendering.send_error.delivery_failed', {
          defaultValue: 'The email could not be delivered. Check the address and send again.',
        }),
      );
  }
}
