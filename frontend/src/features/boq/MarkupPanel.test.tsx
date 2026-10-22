// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { MarkupPanel, draftToMarkup } from './MarkupPanel';
import { boqApi, type Markup } from './api';

/**
 * Regression tests for audit findings #4 and #5 (BOQ fixed-amount markups).
 *
 * The backend serialises ``BOQMarkup.fixed_amount`` as a Decimal-rendered JSON
 * *string* (e.g. ``"500.00"``), while ``api.ts`` historically typed it as
 * ``number``. Two symptoms followed from that one wire-vs-type mismatch:
 *
 *  - #5 (MarkupPanel): a ``typeof m.fixed_amount === 'number'`` guard rejected
 *    the string and rendered every fixed markup's Amount — and the panel's
 *    Grand Total — as 0.
 *  - #4 (BOQEditorPage footer/exports): the cascade does ``running += amount``
 *    with ``running`` starting as the numeric direct cost, so a string
 *    ``fixed_amount`` triggered STRING CONCATENATION (1000 + "500.00" =>
 *    "1000500.00") and poisoned the Net Total / VAT / Gross footer + exports.
 *
 * MarkupPanel runs the same ``running += amount`` cascade as the editor
 * footer's ``markupTotals`` memo, so rendering it with the real Decimal-string
 * wire value exercises both the display path (#5) and the additive-cascade
 * contract (#4): the fix coerces through ``toNum`` so the markup shows its real
 * value and the total stays a finite, correctly-summed number.
 *
 * Note on the label. The panel's summary line runs over EVERY active markup,
 * ``category === 'tax'`` included, so it is the grand total, not a net total —
 * it mirrors the server's ``_calculate_markup_amounts`` cascade and equals
 * ``cost-breakdown.grand_total``. It was labelled "Net Total" until audit #156,
 * which put a second, VAT-inclusive "Net Total" on the same screen as the grid
 * footer's real (tax-excluded) one. The numbers below are unaffected by that
 * relabel — these markups are ``category: 'overhead'``.
 */

function renderPanel(markups: Markup[], directCost: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarkupPanel
        boqId="boq-1"
        markups={markups}
        directCost={directCost}
        currencySymbol=""
        currencyCode=""
        locale="en-US"
        fmt={new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      />
    </QueryClientProvider>,
  );
}

function fixedMarkup(fixedAmount: number | string): Markup {
  return {
    id: 'm-fixed',
    boq_id: 'boq-1',
    name: 'Site overhead',
    markup_type: 'fixed',
    category: 'overhead',
    percentage: 0,
    // The wire value: a Decimal rendered as a JSON string.
    fixed_amount: fixedAmount,
    apply_to: 'direct_cost',
    sort_order: 0,
    is_active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('MarkupPanel fixed-amount markups (audit #4/#5)', () => {
  it('renders the real fixed amount from a Decimal-as-string wire value (not 0)', () => {
    // fixed_amount arrives as the string "50000.00"; the old typeof-number
    // guard rejected it and rendered the markup's Amount (and its Grand Total
    // contribution) as 0. With a non-zero direct cost the real amount is
    // visible and the Grand Total is the sum (10,000 + 50,000).
    renderPanel([fixedMarkup('50000.00')], 10000);

    // The fixed markup's Amount cell shows its real value, never 0.00.
    expect(screen.getAllByText('50,000.00').length).toBeGreaterThan(0);
    // Grand Total = direct cost + fixed amount, summed as numbers.
    expect(screen.getByText('60,000.00')).toBeInTheDocument();
  });

  it('sums the cascade as numbers, not string concatenation, for the Grand Total', () => {
    // directCost (number) + fixed_amount (string) must add to 1,500.00 — the
    // pre-fix code produced "1000500.00" via string concatenation.
    renderPanel([fixedMarkup('500.00')], 1000);

    expect(screen.getByText('1,500.00')).toBeInTheDocument();
    expect(screen.queryByText('1000500.00')).toBeNull();
  });
});

describe('Adding a markup', () => {
  it('opens a form and adds nothing until the user confirms a rate', async () => {
    const add = vi.spyOn(boqApi, 'addMarkup').mockResolvedValue(fixedMarkup('0'));
    renderPanel([], 1000);

    fireEvent.click(screen.getByRole('button', { name: 'Add Markup' }));
    expect(add).not.toHaveBeenCalled();
    const form = screen.getByRole('form', { name: 'New markup' });
    expect(form).toBeInTheDocument();

    // No rate typed: refused with a message, nothing stored.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chi phí chung' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to estimate' }));
    expect(add).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('percentage');

    fireEvent.change(screen.getByLabelText('%'), { target: { value: '6,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to estimate' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0]?.[1]).toMatchObject({
      name: 'Chi phí chung',
      percentage: 6.5,
      category: 'overhead',
      apply_to: 'direct_cost',
    });
    add.mockRestore();
  });

  it('cancelling the form adds nothing', () => {
    const add = vi.spyOn(boqApi, 'addMarkup').mockResolvedValue(fixedMarkup('0'));
    renderPanel([], 1000);
    fireEvent.click(screen.getByRole('button', { name: 'Add Markup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New markup' })).toBeNull();
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });
});

describe('draftToMarkup', () => {
  const base = { name: 'VAT', percentage: '10', category: 'tax' as const, applyTo: 'cumulative' as const };

  it('builds the payload from what the user typed', () => {
    expect(draftToMarkup(base, 4)).toEqual({
      ok: true,
      data: { name: 'VAT', percentage: 10, category: 'tax', apply_to: 'cumulative', sort_order: 4 },
    });
  });

  it('refuses a missing name or an empty / out-of-range rate', () => {
    expect(draftToMarkup({ ...base, name: '  ' }, 0)).toEqual({ ok: false, error: 'name' });
    expect(draftToMarkup({ ...base, percentage: '' }, 0)).toEqual({ ok: false, error: 'percentage' });
    expect(draftToMarkup({ ...base, percentage: '150' }, 0)).toEqual({ ok: false, error: 'percentage' });
  });

  it('carries the section a scoped markup is for', () => {
    const result = draftToMarkup({ ...base, scopePositionId: 'sec-1' }, 0);
    expect(result.ok && result.data.scope_position_id).toBe('sec-1');
  });
});
