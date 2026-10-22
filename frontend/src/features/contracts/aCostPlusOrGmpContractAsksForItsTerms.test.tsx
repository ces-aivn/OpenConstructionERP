// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A cost-plus or GMP contract can be created from the form.
//
// The server refuses a GMP contract without its cap and target and a
// cost-plus one without its fee, and the form used to have no field for any
// of them, so neither could be created at all. The form now asks for each
// figure the type needs, marks the field the server refuses, picks the
// counterparty by name, and takes a template's terms as its starting values.
//
// The API layer runs for real (the mock is on apiGet/apiPost), so a wrong URL
// or payload shape fails the test rather than passing it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/shared/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/api')>('@/shared/lib/api');
  return { ...actual, ...api };
});

const toast = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof toast.addToast }) => unknown) =>
    sel({ addToast: toast.addToast }),
}));

import { ApiError } from '@/shared/lib/api';
import { CreateContractModal } from './ContractsPage';
import { minimumAdvance, templatePrefill } from './ContractCreateTerms';
import type { ClauseTemplate } from './api';

const VN_ADJUSTABLE: ClauseTemplate = {
  code: 'vn_nd37_adjustable_unit_price',
  name: 'Hợp đồng thi công xây dựng theo đơn giá điều chỉnh',
  family: 'vietnam',
  retention_release_event: 'defects_period_end',
  clause_count: 12,
  source: 'builtin',
  editable: false,
  version: 0,
  status: 'published',
  country_code: 'VN',
  contract_types: ['unit_price'],
  default_terms: {
    performance_security_percent: '5',
    warranty_retention_percent: '5',
    warranty_period_months: '12',
    price_basis: 'adjustable',
  },
  advance_tiers: [
    ['9999999999', '20'],
    ['50000000000', '15'],
    [null, '10'],
  ],
};

const AIA_A102: ClauseTemplate = {
  code: 'aia_a102_2017',
  name: 'AIA A102-2017 - Owner & Contractor (Cost-Plus, GMP)',
  family: 'aia',
  retention_release_event: 'substantial_completion',
  clause_count: 4,
  source: 'builtin',
  editable: false,
  version: 0,
  status: 'published',
  country_code: 'US',
  contract_types: ['gmp', 'cost_plus'],
  default_terms: {},
  advance_tiers: [],
};

function serve() {
  api.apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/v1/contracts/country-defaults/')) {
      return Promise.resolve({
        project_id: 'p-1',
        country_code: 'US',
        has_defaults: false,
        standard_form: null,
        values: {},
        sources: {},
        release_split_source: null,
      });
    }
    if (path.startsWith('/v1/contracts/contract-templates/')) return Promise.resolve([VN_ADJUSTABLE, AIA_A102]);
    if (path.startsWith('/v1/subcontractors/')) {
      return Promise.resolve({
        items: [
          { id: 'sub-2', legal_name: 'Turner Construction', trade_categories: [], prequalification_status: 'approved', rating_score: 0 },
          { id: 'sub-1', legal_name: 'Schuff Steel', trade_categories: [], prequalification_status: 'approved', rating_score: 0 },
        ],
        total: 2,
        limit: 200,
        offset: 0,
      });
    }
    return Promise.reject(new Error(`not mocked: ${path}`));
  });
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateContractModal projectId="p-1" defaultCurrency="USD" onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function startGmp() {
  renderModal();
  fireEvent.change(screen.getByPlaceholderText('C-2026-001'), { target: { value: 'PENN-GMP-01' } });
  // The retention field is required when the country has no usual figure.
  await waitFor(() => expect(screen.getByTestId('contract-retention')).toBeTruthy());
  fill('contract-retention', '5');
  fill('contract-type', 'gmp');
}

function sentPayload(): Record<string, unknown> {
  expect(api.apiPost).toHaveBeenCalledTimes(1);
  const call = api.apiPost.mock.calls[0]!;
  expect(call[0]).toBe('/v1/contracts/contracts/');
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiPost.mockResolvedValue({ id: 'c-1' });
  toast.addToast.mockReset();
  serve();
});

afterEach(cleanup);

describe('a cost-plus or GMP contract asks for its terms', () => {
  it('shows the target cost and the GMP cap for a GMP contract', async () => {
    await startGmp();
    expect(screen.getByTestId('contract-term-target_cost')).toBeTruthy();
    expect(screen.getByTestId('contract-term-gmp_cap')).toBeTruthy();
    expect(screen.getByTestId('contract-term-fee_percent')).toBeTruthy();
  });

  it('shows the fee for a cost-plus contract', async () => {
    await startGmp();
    fill('contract-type', 'cost_plus');
    expect(screen.getByTestId('contract-term-fee_percent')).toBeTruthy();
    expect(screen.queryByTestId('contract-term-gmp_cap')).toBeNull();
  });

  it('does not send a GMP contract without its cap and target, and marks both fields', async () => {
    await startGmp();
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(toast.addToast).toHaveBeenCalled());
    expect(api.apiPost).not.toHaveBeenCalled();
    expect(screen.getByText('Enter Target cost.')).toBeTruthy();
    expect(screen.getByText('Enter Guaranteed maximum price (GMP).')).toBeTruthy();
  });

  it('sends the GMP figures and the counterparty picked by name', async () => {
    await startGmp();
    fill('contract-term-target_cost', '11500000');
    fill('contract-term-gmp_cap', '12000000');
    fill('contract-term-fee_percent', '4');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Schuff Steel' })).toBeTruthy());
    fill('contract-counterparty-firm', 'sub-1');

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.contract_type).toBe('gmp');
    expect(payload.counterparty_id).toBe('sub-1');
    expect(payload.terms).toEqual({ target_cost: '11500000', gmp_cap: '12000000', fee_percent: '4' });
  });

  it('marks the field the server refuses instead of printing its code', async () => {
    api.apiPost.mockRejectedValue(
      new ApiError(400, 'Bad Request', {
        detail: {
          error: 'invalid_contract_terms',
          code: 'contract_gmp_below_target',
          field: 'terms.gmp_cap',
          params: { term: 'gmp_cap', contract_type: 'gmp' },
          message: 'gmp_cap must not be below target_cost',
          details: ['gmp_cap must not be below target_cost'],
          fields: [{ field: 'terms.gmp_cap', code: 'contract_gmp_below_target', params: {} }],
        },
      }),
    );
    await startGmp();
    fill('contract-term-target_cost', '12000000');
    fill('contract-term-gmp_cap', '11000000');

    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(
      await screen.findByText('The guaranteed maximum price cannot be below the target cost.'),
    ).toBeTruthy();
    const titles = toast.addToast.mock.calls.map((call) => (call[0] as { title: string }).title);
    expect(titles).toContain('Check the highlighted contract terms.');
    expect(titles.join(' ')).not.toMatch(/invalid_contract_terms/);
  });

  it('moves to the type a template is written for and starts from its terms', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('C-2026-001'), { target: { value: 'LMV-01' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /đơn giá điều chỉnh/ })).toBeTruthy(),
    );
    fill('contract-retention', '5');
    fill('contract-template', 'vn_nd37_adjustable_unit_price');

    expect((screen.getByTestId('contract-type') as HTMLSelectElement).value).toBe('unit_price');
    expect((screen.getByTestId('contract-term-price_basis') as HTMLSelectElement).value).toBe('adjustable');
    expect((screen.getByTestId('contract-term-warranty_period_months') as HTMLInputElement).value).toBe('12');

    // A template figure left as shown is the server's to fill; a typed one is sent.
    fill('contract-term-performance_security_percent', '10');
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.template_code).toBe('vn_nd37_adjustable_unit_price');
    expect(payload.terms).toEqual({ performance_security_percent: '10' });
  });

  it('titles the dates the contract term, not a schedule', async () => {
    renderModal();
    expect(await screen.findByText('Contract term')).toBeTruthy();
  });
});

describe('template prefill', () => {
  it('reads the minimum advance for the contract value', () => {
    expect(minimumAdvance(VN_ADJUSTABLE.advance_tiers, '9000000000')).toBe('20');
    expect(minimumAdvance(VN_ADJUSTABLE.advance_tiers, '10000000000')).toBe('15');
    expect(minimumAdvance(VN_ADJUSTABLE.advance_tiers, '60000000000')).toBe('10');
    expect(minimumAdvance(VN_ADJUSTABLE.advance_tiers, '0')).toBe('');
    expect(minimumAdvance([], '1')).toBe('');
  });

  it('fills nothing for a type the template is not written for', () => {
    expect(templatePrefill(VN_ADJUSTABLE, 'lump_sum', '1000')).toEqual({});
    expect(templatePrefill(VN_ADJUSTABLE, 'unit_price', '8000000000').advance_payment_percent).toBe('20');
  });
});
