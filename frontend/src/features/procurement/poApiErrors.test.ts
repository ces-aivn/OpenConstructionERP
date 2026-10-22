// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Tests for describePOActionError(): a refused approval lists the rules that
// failed instead of pointing at a list the screen never showed.

import { describe, it, expect } from 'vitest';

import { ApiError, getErrorMessage } from '@/shared/lib/api';

import { describePOActionError } from './poApiErrors';

describe('describePOActionError', () => {
  it('appends every failing rule to the refusal', () => {
    const err = new ApiError(422, 'Unprocessable Entity', {
      detail: {
        code: 'po_validation_failed',
        message: 'Purchase order failed validation',
        params: { operation: 'approve', count: 2 },
        errors: [
          { rule_id: 'po.line_price', message: 'Line 1 has no unit price' },
          { rule_id: 'po.delivery', message: ' Delivery date is missing ' },
        ],
      },
    });
    const text = describePOActionError(err);
    expect(text.startsWith(getErrorMessage(err))).toBe(true);
    expect(text.endsWith('Line 1 has no unit price; Delivery date is missing')).toBe(true);
  });

  it('skips entries without a message', () => {
    const err = new ApiError(422, 'Unprocessable Entity', {
      detail: { code: 'po_validation_failed', errors: [{ rule_id: 'x' }, { message: '' }, null] },
    });
    expect(describePOActionError(err)).toBe(getErrorMessage(err));
  });

  it('leaves a refusal without rules as it is', () => {
    const err = new ApiError(403, 'Forbidden', {
      detail: { code: 'po_self_approval', field: 'created_by', message: 'You created this order' },
    });
    expect(describePOActionError(err)).toBe(getErrorMessage(err));
  });

  it('handles errors that are not API errors', () => {
    const err = new Error('Network down');
    expect(describePOActionError(err)).toBe(getErrorMessage(err));
  });
});
