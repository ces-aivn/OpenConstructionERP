// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A compliance gate that ran no rule says so; it does not say "passed".
//
// The universal pack on a contract with an empty schedule of values produces
// no result at all: 0 passed, 0 warnings, 0 errors. The gate used to show
// "Compliance checks passed" for that, which reads as a verified contract.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const preview = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  signContract: vi.fn(),
  asComplianceGateError: vi.fn(() => null),
  listComplianceRulePacks: vi.fn().mockResolvedValue([]),
  previewComplianceGate: preview,
}));

vi.mock('./ContractSigningPanel', () => ({ ContractSigningPanel: () => null }));

import { ComplianceGate, complianceCheckedNothing } from './ComplianceGate';
import type { ComplianceGateReport } from './api';

const EMPTY: ComplianceGateReport = {
  contract_id: 'c-1',
  contract_status: 'draft',
  rule_packs: ['universal'],
  rule_sets: ['boq_quality'],
  status: 'skipped',
  score: null,
  blocked: false,
  counts: { errors: 0, warnings: 0, passed: 0, evaluated: 0 },
  nothing_checked: true,
  errors: [],
  warnings: [],
};

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComplianceGate contractId="c-1" contractCode="LMV-CTD-2022-001" onSigned={vi.fn()} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('a compliance gate that checked nothing', () => {
  it('says no rules are configured instead of passed', async () => {
    preview.mockResolvedValue(EMPTY);
    renderGate();

    expect(await screen.findByTestId('compliance-nothing-checked')).toBeTruthy();
    expect(screen.getByText('No compliance rules configured for this contract')).toBeTruthy();
    expect(screen.queryByText('Compliance checks passed')).toBeNull();
    expect(screen.queryByText(/Every applicable rule passed/)).toBeNull();
  });

  it('still passes a run whose rules all passed', async () => {
    preview.mockResolvedValue({
      ...EMPTY,
      status: 'passed',
      score: 1,
      counts: { errors: 0, warnings: 0, passed: 9, evaluated: 9 },
      nothing_checked: false,
    });
    renderGate();

    expect(await screen.findByText('Compliance checks passed')).toBeTruthy();
    expect(screen.queryByTestId('compliance-nothing-checked')).toBeNull();
  });

  it('reads an older server without the flag from its counts and status', () => {
    const { nothing_checked: _drop, ...legacy } = EMPTY;
    expect(complianceCheckedNothing({ ...legacy, status: 'passed' })).toBe(true);
    expect(
      complianceCheckedNothing({ ...legacy, status: 'passed', counts: { errors: 0, warnings: 0, passed: 3 } }),
    ).toBe(false);
  });
});
