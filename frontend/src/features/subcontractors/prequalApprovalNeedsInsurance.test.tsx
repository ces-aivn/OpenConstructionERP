// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A subcontractor with no valid insurance is not marked approved without a
// stated reason, and prequalification statuses are shown in the reader's
// words rather than as the wire values.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { TFunction } from 'i18next';

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

vi.mock('@/features/insights', () => ({
  InsightsPanel: () => null,
  InsightsToggleButton: () => null,
  useModuleInsights: () => ({ open: false, toggle: vi.fn(), custom: [] }),
}));

import { SubcontractorsPage } from './SubcontractorsPage';
import { approvalNeedsInsuranceOverride, prequalStatusLabel } from './prequalStatus';
import type { Subcontractor } from './api';

const SUB: Subcontractor = {
  id: 's-1',
  legal_name: 'Schuff Steel',
  trade_name: null,
  tax_id: null,
  trade_categories: ['steel'],
  prequalification_status: 'pending',
  rating_score: 0,
  country: 'US',
  is_active: true,
  insurance_expiry_date: null,
  insurance_state: 'missing',
  is_blocked: false,
  metadata: {},
  created_at: '2026-01-01T09:00:00Z',
  updated_at: '2026-01-01T09:00:00Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/subcontractors']}>
        <SubcontractorsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/v1/subcontractors/subcontractors/?')) {
      return Promise.resolve({ items: [SUB], total: 1, offset: 0, limit: 200 });
    }
    return Promise.resolve([]);
  });
  api.apiPost.mockResolvedValue({ ...SUB, id: 's-2' });
});

afterEach(() => cleanup());

describe('whether an approval needs a reason', () => {
  const today = new Date('2026-10-22T10:00:00');

  it('follows the server verdict when the response carries one', () => {
    expect(approvalNeedsInsuranceOverride({ insurance_state: 'valid', insurance_expiry_date: null }, today)).toBe(false);
    expect(approvalNeedsInsuranceOverride({ insurance_state: 'expired' }, today)).toBe(true);
    expect(approvalNeedsInsuranceOverride({ insurance_state: 'revoked' }, today)).toBe(true);
  });

  it('falls back to the insurance date on the row', () => {
    expect(approvalNeedsInsuranceOverride({ insurance_expiry_date: '2026-10-22' }, today)).toBe(false);
    expect(approvalNeedsInsuranceOverride({ insurance_expiry_date: '2026-10-21' }, today)).toBe(true);
    expect(approvalNeedsInsuranceOverride({ insurance_expiry_date: null }, today)).toBe(true);
  });

  it('always needs one for a firm being created', () => {
    expect(approvalNeedsInsuranceOverride(undefined, today)).toBe(true);
  });
});

describe('prequalification status labels', () => {
  it('reads each status through its own key', () => {
    const t = vi.fn((key: string, opts?: { defaultValue?: string }) => `${key}|${opts?.defaultValue}`);
    expect(prequalStatusLabel(t as unknown as TFunction, 'suspended')).toBe(
      'subcontractors.prequal_status_suspended|Suspended',
    );
    expect(prequalStatusLabel(t as unknown as TFunction, 'something_new')).toBe('something_new');
  });

  it('shows the register status as a word, not the wire value', async () => {
    renderPage();
    const row = (await screen.findByText('Schuff Steel')).closest('tr');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('Pending')).toBeTruthy();
    expect(within(row as HTMLElement).queryByText('pending')).toBeNull();
  });
});

describe('approving a new firm in the form', () => {
  async function openFormAsApproved() {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Subcontractor/ }));
    fireEvent.change(screen.getByPlaceholderText('Acme Construction Ltd.'), {
      target: { value: 'FabriTec' },
    });
    expect(screen.getByPlaceholderText('VN / US')).toBeTruthy();
    const status = screen.getByDisplayValue('Pending') as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'approved' } });
  }

  it('warns and refuses to send without a reason', async () => {
    await openFormAsApproved();
    expect(screen.getByTestId('prequal-insurance-warning')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByTestId('prequal-override-reason')).toBeTruthy());
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('sends the reason with the approval', async () => {
    await openFormAsApproved();
    fireEvent.change(screen.getByTestId('prequal-override-reason'), {
      target: { value: 'Owner-controlled insurance programme' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    const [, body] = api.apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.prequalification_status).toBe('approved');
    expect(body.prequal_override_reason).toBe('Owner-controlled insurance programme');
  });

  it('asks nothing when the firm stays pending', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Subcontractor/ }));
    expect(screen.queryByTestId('prequal-insurance-warning')).toBeNull();
  });
});
