// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { countRfis, isRfiOpen, isRfiOverdue } from '../rfiStatusRules';

const NOW = new Date('2026-10-22T09:00:00Z');

describe('RFI open and overdue counts', () => {
  it('treats draft and open as open, the rest as not', () => {
    expect(isRfiOpen('draft')).toBe(true);
    expect(isRfiOpen('open')).toBe(true);
    expect(isRfiOpen('answered')).toBe(false);
    expect(isRfiOpen('closed')).toBe(false);
    expect(isRfiOpen('void')).toBe(false);
  });

  it('counts a past-due draft as both open and overdue, never "open 0, overdue 1"', () => {
    const counts = countRfis([{ status: 'draft', response_due_date: '2018-09-14', is_overdue: true }], NOW);
    expect(counts).toEqual({ open: 1, overdue: 1 });
  });

  it('never counts an answered RFI as overdue, whatever its flag says', () => {
    expect(isRfiOverdue({ status: 'answered', response_due_date: '2018-09-14', is_overdue: true }, NOW)).toBe(false);
    expect(countRfis([{ status: 'closed', response_due_date: '2018-09-14', is_overdue: true }], NOW)).toEqual({
      open: 0,
      overdue: 0,
    });
  });

  it('falls back to the due date when the server flag is absent', () => {
    expect(isRfiOverdue({ status: 'open', response_due_date: '2026-10-01' }, NOW)).toBe(true);
    expect(isRfiOverdue({ status: 'open', response_due_date: '2026-11-01' }, NOW)).toBe(false);
    expect(isRfiOverdue({ status: 'open', response_due_date: null }, NOW)).toBe(false);
  });
});
