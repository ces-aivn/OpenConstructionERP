// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The tab opens on the newest stored run instead of "No simulation run yet",
// and puts the run's mean next to the register EMV.
//
// The test setup's i18n mock renders each label's English defaultValue.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import * as api from '@/shared/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { MonteCarloTab } from './MonteCarloTab';
import type { RiskSimulationResult } from './api';

const getMock = vi.mocked(api.apiGet);

const storedRun: RiskSimulationResult = {
  run_id: 'run-1',
  created_at: '2026-10-22T03:00:00+00:00',
  seed: 20261022,
  impact_spread: 0.2,
  iterations: 10000,
  risk_count: 6,
  mode: 'both',
  p50_cost: '200000000000',
  p80_cost: '290000000000',
  p95_cost: '370000000000',
  mean_cost: '204100000000',
  emv_cost: '204000000000',
  p50_schedule_days: 55,
  p80_schedule_days: 80,
  p95_schedule_days: 100,
  mean_schedule_days: 58.2,
  emv_schedule_days: 58,
  histogram_basis: 'cost',
  histogram_bins: [
    { lower: '0', upper: '100000000000', count: 4000 },
    { lower: '100000000000', upper: '200000000000', count: 6000 },
  ],
  tornado: [],
  currency: '',
  mixed_currency: false,
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MonteCarloTab projectId="p-1" currency="" />
    </QueryClientProvider>,
  );
}

describe('MonteCarloTab stored run', () => {
  beforeEach(() => {
    getMock.mockReset();
    useAuthStore.setState({ userRole: 'editor' });
  });

  it('shows the last stored run with its seed and its mean next to the EMV', async () => {
    getMock.mockResolvedValue({ items: [storedRun], total: 1, offset: 0, limit: 1 });
    renderTab();

    expect(await screen.findByText(/Last run - 6 risks/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/v1/risk/projects/p-1/simulations?limit=1');
    expect(screen.getByText(/seed 20261022/)).toBeInTheDocument();
    expect(screen.getByText(/register EMV/)).toHaveTextContent(/Mean cost 204[^0-9]?100[^0-9]?000[^0-9]?000/);
    expect(screen.queryByText('No simulation run yet')).not.toBeInTheDocument();
  });

  it('shows the empty state when the project has no stored run', async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 1 });
    renderTab();
    expect(await screen.findByText('No simulation run yet')).toBeInTheDocument();
  });
});
