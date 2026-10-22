// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A payment application is billed against the schedule of values.
//
// The schedule is drawn from the contract's bill (on the create form or on a
// draft contract), each line linked to its position. A claim line shows what
// the line is worth, what was billed before, work and stored materials to date
// and the balance, all as the server worked them out, and takes the materials
// stored on site as well as the work of the period.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const http = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/shared/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/api')>('@/shared/lib/api');
  return { ...actual, ...http };
});

const toasts = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/stores/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel(toasts),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const fallback = opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
  I18nextProvider: ({ children }: { children: ReactNode }) => children,
}));

import { ProgressClaimLineTable } from './ProgressClaimLineTable';
import { SovFromBoqAction, SovSourceSelect } from './SovFromBoq';
import type { ContractLine, ProgressClaimLine } from './api';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SOV_LINE: ContractLine = {
  id: 'line-1',
  contract_id: 'ctr-1',
  parent_line_id: null,
  code: '01.001',
  description: 'Bê tông móng',
  scope_section: null,
  line_type: 'work',
  unit: 'm3',
  quantity: 1,
  unit_rate: 60000,
  total_value: 60000,
  order_index: 0,
  metadata: { boq_position_id: 'pos-1' },
  created_at: '',
  updated_at: '',
};

const CLAIM_LINE: ProgressClaimLine = {
  id: 'cl-1',
  progress_claim_id: 'claim-1',
  contract_line_id: 'line-1',
  period_completed_qty: '0',
  period_completed_value: '30000',
  period_completed_pct: '50',
  cumulative_completed_value: '30000',
  prior_completed_value: '0',
  previous_value: '0.00',
  materials_stored_value: '10000',
  scheduled_value: '60000.00',
  total_completed_stored: '40000.00',
  percent_complete: '66.67',
  balance_to_finish: '20000.00',
  created_at: '',
  updated_at: '',
};

beforeEach(() => {
  http.apiGet.mockReset();
  http.apiPost.mockReset();
  http.apiPatch.mockReset();
  toasts.addToast.mockReset();
});

afterEach(cleanup);

describe('a claim line is measured against its schedule of values line', () => {
  it("shows the line's scheduled value, stored materials, to date and balance from the server", () => {
    render(
      wrap(
        <ProgressClaimLineTable
          claimId="claim-1"
          lines={[CLAIM_LINE]}
          currency="USD"
          editable={false}
          contractLines={[SOV_LINE]}
        />,
      ),
    );
    const table = within(screen.getByTestId('claim-line-table'));
    expect(table.getByText('Scheduled value')).toBeTruthy();
    expect(table.getByText('Stored materials')).toBeTruthy();
    expect(table.getByText('Balance to finish')).toBeTruthy();
    const toDate = screen.getByTestId('claim-line-to-date-cl-1').textContent ?? '';
    expect(toDate).toMatch(/40,000/);
    expect(toDate).toMatch(/66\.67/);
    expect(table.getAllByText(/20,000/).length).toBeGreaterThan(0);
    expect(table.getAllByText(/60,000/).length).toBeGreaterThan(0);
  });

  it('sends the stored materials with the edited line', async () => {
    http.apiPatch.mockResolvedValue(CLAIM_LINE);
    render(
      wrap(
        <ProgressClaimLineTable
          claimId="claim-1"
          lines={[CLAIM_LINE]}
          currency="USD"
          editable
          contractLines={[SOV_LINE]}
        />,
      ),
    );
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('Stored materials'), { target: { value: '5000' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(http.apiPatch).toHaveBeenCalledTimes(1));
    expect(http.apiPatch).toHaveBeenCalledWith(
      '/v1/contracts/progress-claim-lines/cl-1',
      expect.objectContaining({ materials_stored_value: 5000, period_completed_value: 30000 }),
    );
  });

  it('bills a new line with the materials stored on site', async () => {
    http.apiPost.mockResolvedValue(CLAIM_LINE);
    render(
      wrap(
        <ProgressClaimLineTable
          claimId="claim-1"
          lines={[]}
          currency="USD"
          editable
          contractLines={[SOV_LINE]}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId('claim-add-line'));
    fireEvent.change(screen.getByLabelText('Line'), { target: { value: 'line-1' } });
    fireEvent.change(screen.getByLabelText('Period value'), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText('Stored materials'), { target: { value: '10000' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(http.apiPost).toHaveBeenCalledTimes(1));
    expect(http.apiPost).toHaveBeenCalledWith('/v1/contracts/progress-claim-lines/', {
      progress_claim_id: 'claim-1',
      contract_line_id: 'line-1',
      period_completed_pct: 0,
      period_completed_value: 30000,
      materials_stored_value: 10000,
    });
  });
});

describe('the schedule of values is drawn from the bill', () => {
  beforeEach(() => {
    http.apiGet.mockImplementation((path: string) => {
      if (path === '/v1/boq/boqs/?project_id=p-1') {
        return Promise.resolve([
          { id: 'boq-1', name: 'Dự toán phần thân' },
          { id: 'boq-2', name: 'Dự toán hoàn thiện' },
        ]);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("offers the project's bills on the create form, and entering the lines later", async () => {
    const onChange = vi.fn();
    render(wrap(<SovSourceSelect projectId="p-1" value="" onChange={onChange} />));
    await screen.findByText('From BOQ: Dự toán phần thân');
    expect(screen.getByText('Enter the lines later')).toBeTruthy();
    fireEvent.change(screen.getByTestId('contract-sov-source'), { target: { value: 'boq-2' } });
    expect(onChange).toHaveBeenCalledWith('boq-2');
  });

  it('draws the lines of the picked bill on a draft contract', async () => {
    http.apiPost.mockResolvedValue({
      lines: [],
      created: 2,
      already_linked: 0,
      removed_placeholder: 0,
      sov_total: '478500000',
      contract_total_value: '478500000',
    });
    const onDrawn = vi.fn();
    render(wrap(<SovFromBoqAction contractId="ctr-1" projectId="p-1" onDrawn={onDrawn} />));
    fireEvent.click(screen.getByTestId('sov-draw-from-boq'));
    const select = await screen.findByTestId('sov-draw-boq-select');
    await screen.findByText('Dự toán hoàn thiện');
    fireEvent.change(select, { target: { value: 'boq-2' } });
    fireEvent.click(screen.getByTestId('sov-draw-confirm'));
    await waitFor(() => expect(http.apiPost).toHaveBeenCalledTimes(1));
    expect(http.apiPost).toHaveBeenCalledWith('/v1/contracts/contracts/ctr-1/lines/from-boq', {
      boq_id: 'boq-2',
    });
    await waitFor(() => expect(onDrawn).toHaveBeenCalled());
    expect(toasts.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: '2 lines drawn from the BOQ' }),
    );
  });
});
