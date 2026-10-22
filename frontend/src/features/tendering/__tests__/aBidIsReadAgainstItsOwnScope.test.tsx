// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The comparison screen of a tender package, read the way a buyer reads it:
//   1. Two bids from the same firm can be told apart under their bars, and a
//      bid a hundred times smaller than the rest is still a visible bar.
//   2. A negative total is never marked as the lowest bid.
//   3. A refused value is worded from its code, not the server's English.
//   4. A package's budget is the budget of the rows it covers.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: unknown) => {
      if (typeof opts === 'string') return opts;
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        return String((opts as { defaultValue?: string }).defaultValue ?? '');
      }
      return _key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
  I18nextProvider: ({ children }: { children: unknown }) => children,
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

import { ApiError } from '@/shared/lib/api';
import { BidComparisonChart, barLabels } from '../BidComparisonChart';
import { errorCodes, isEmailShaped, isNonNegativeAmount, tenderingErrorMessage } from '../tenderingErrors';
import { minimalPick, scopeBudget, scopeClosure, type ScopeRow } from '../PackageScopePicker';

afterEach(cleanup);

// jsdom has no layout, so the chart's width observer gets a stand-in.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const t = ((_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key) as never;

describe('bar labels', () => {
  it('numbers two bids from the same firm instead of cutting both to one prefix', () => {
    const labels = barLabels(['Schuff Steel', 'Schuff Steel', 'FabriTec Structures'], 14);
    expect(labels.map((l) => l.full)).toEqual(['Schuff Steel (1)', 'Schuff Steel (2)', 'FabriTec Structures']);
    expect(new Set(labels.map((l) => l.lines.join(' '))).size).toBe(3);
  });

  it('wraps a long name onto whole-word lines and keeps the end of an overlong one', () => {
    expect(barLabels(['Schuff Steel Pacific'], 14)[0]?.lines).toEqual(['Schuff Steel', 'Pacific']);
    const long = barLabels(['Schuff Steel Company Pacific Southwest Division'], 12)[0];
    expect(long?.lines).toHaveLength(2);
    expect(long?.lines[1]?.endsWith('Division')).toBe(true);
  });
});

describe('the bid totals chart', () => {
  const bid = (id: string, company_name: string, total: number) => ({
    bid_id: id,
    company_name,
    total,
    currency: 'USD',
    deviation_pct: 0,
    status: 'submitted',
    matched_lines: 0,
    total_lines: 0,
  });

  it('draws the smallest bid as a visible bar and names every bidder in full', () => {
    const { container } = render(
      <BidComparisonChart
        bidTotals={[bid('a', 'Schuff Steel', 190_000_000), bid('b', 'Schuff Steel', 205_000_000), bid('c', 'FabriTec', 5_000)]}
        budgetTotal={190_000_000}
        currency="USD"
      />,
    );
    const bars = [...container.querySelectorAll('[data-testid="bid-chart-bar"]')];
    expect(bars).toHaveLength(3);
    const heights = bars.map((g) => Number(g.querySelector('rect')?.getAttribute('height')));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(6);
    const titles = bars.map((g) => g.querySelector('title')?.textContent ?? '');
    expect(titles[0]).toContain('Schuff Steel (1)');
    expect(titles[1]).toContain('Schuff Steel (2)');
    expect(titles[2]).toContain('Lowest');
  });

  it('never marks a negative total as the lowest bid', () => {
    const { container } = render(
      <BidComparisonChart
        bidTotals={[bid('a', 'Schuff Steel', 190_000_000), bid('b', 'Typo Bau', -5_000)]}
        budgetTotal={0}
        currency="USD"
      />,
    );
    const titles = [...container.querySelectorAll('[data-testid="bid-chart-bar"] title')].map((n) => n.textContent ?? '');
    expect(titles[1]).not.toContain('Lowest');
  });
});

describe('refused values', () => {
  it('reads the code of a validation entry and of a business refusal', () => {
    expect(errorCodes({ detail: [{ type: 'amount_negative', loc: ['body', 'total_amount'], msg: 'x' }] })).toEqual([
      'amount_negative',
    ]);
    expect(errorCodes({ detail: { code: 'package_scope_locked', message: 'x' } })).toEqual(['package_scope_locked']);
    expect(errorCodes({ detail: [{ type: 'greater_than_equal', ctx: { ge: 5 } }] })).toEqual([]);
  });

  it('words a negative bid and a malformed email in the reader language, not the server English', () => {
    const negative = new ApiError(422, 'Unprocessable', {
      detail: [{ type: 'amount_negative', loc: ['body', 'total_amount'], msg: 'total_amount must be zero or more' }],
    });
    expect(tenderingErrorMessage(negative, t)).toBe('Amounts must be zero or more. A bid cannot be negative.');
    const email = new ApiError(422, 'Unprocessable', {
      detail: [{ type: 'invalid_email', loc: ['body', 'email'], msg: 'email must be a valid email address' }],
    });
    expect(tenderingErrorMessage(email, t)).toBe('Enter a valid email address, for example name@company.com.');
  });

  it('checks a typed amount and email the way the server does', () => {
    expect(isNonNegativeAmount('-5000')).toBe(false);
    expect(isNonNegativeAmount('abc')).toBe(false);
    expect(isNonNegativeAmount('')).toBe(true);
    expect(isNonNegativeAmount('190000000')).toBe(true);
    expect(isEmailShaped('abc@')).toBe(false);
    expect(isEmailShaped('bids@schuff.com')).toBe(true);
  });
});

describe('package scope', () => {
  const row = (id: string, parent: string | null, total: number): ScopeRow => ({
    id,
    parent_id: parent,
    ordinal: id,
    description: id,
    unit: parent ? 't' : '',
    quantity: 0,
    total,
  });
  const bill = [
    row('earth', null, 0),
    row('dig', 'earth', 491_000_000),
    row('structure', null, 0),
    row('steel', 'structure', 190_000_000),
    row('concrete', 'structure', 1_500_000_000),
  ];

  it('budgets one picked line on its own and the whole bill when nothing is picked', () => {
    expect(scopeBudget(bill, new Set(['steel']))).toBe(190_000_000);
    expect(scopeBudget(bill, new Set())).toBe(2_181_000_000);
  });

  it('brings the lines of a picked section with it', () => {
    expect([...scopeClosure(bill, new Set(['structure']))].sort()).toEqual(['concrete', 'steel', 'structure']);
  });

  it('reads a stored scope back as the smallest pick that covers it', () => {
    expect([...minimalPick(bill, ['structure', 'steel', 'concrete'])]).toEqual(['structure']);
    expect([...minimalPick(bill, ['steel'])]).toEqual(['steel']);
  });
});
