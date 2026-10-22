// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  posted: [] as { url: string; body?: Record<string, unknown> }[],
}));

vi.mock('@/shared/lib/api', () => ({
  apiPost: vi.fn((url: string, body?: Record<string, unknown>) => {
    api.posted.push({ url, body });
    return Promise.resolve({});
  }),
}));

import { localIsoDate, settleAndMarkPaid } from '../markInvoicePaid';

beforeEach(() => {
  api.posted.length = 0;
});

describe('settleAndMarkPaid', () => {
  it('asks the server to settle what is open in one request, on the given date', async () => {
    await settleAndMarkPaid({ id: 'inv-1' }, '2026-09-25');
    expect(api.posted).toEqual([{ url: '/v1/finance/inv-1/settle/', body: { payment_date: '2026-09-25' } }]);
  });

  it('never works out the amount itself, so a part-paid invoice is not paid in full twice', async () => {
    await settleAndMarkPaid({ id: 'inv-1' }, '2026-09-25');
    expect(api.posted[0]?.body).not.toHaveProperty('amount');
    expect(api.posted.some((p) => p.url.endsWith('/pay/') || p.url.includes('record-payment'))).toBe(false);
  });
});

describe('localIsoDate', () => {
  it('is the calendar date where the user is, not the UTC one', () => {
    // 00:30 on 23 October in the user's zone may still be 22 October in UTC.
    expect(localIsoDate(new Date(2026, 9, 23, 0, 30))).toBe('2026-10-23');
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
