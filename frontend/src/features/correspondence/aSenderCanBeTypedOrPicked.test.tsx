// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A letter's sender is often not in the contacts directory. The party input
// keeps a typed name as the value, and a picked contact is stored by its id
// with its name shown. Recipients are one comma-separated line in which a pick
// replaces only the name being typed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/shared/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/api')>('@/shared/lib/api');
  return { ...actual, ...api };
});

vi.mock('@/features/insights', () => ({
  InsightsPanel: () => null,
  InsightsToggleButton: () => null,
  useModuleInsights: () => ({ open: false, toggle: vi.fn(), setOpen: vi.fn(), custom: [] }),
}));

vi.mock('@/features/tasks', () => ({ CreateTaskFromSourceDialog: () => null }));

import { PartyInput, currentSegment, replaceCurrentSegment } from './PartyInput';
import { buildCorrespondencePatch, correspondenceFormData } from './CorrespondencePage';
import type { Correspondence } from './api';

const CONTACT = {
  id: '11111111-2222-3333-4444-555555555555',
  company_name: 'FabriTec Structures',
  first_name: 'Estimating',
  last_name: 'Dept',
  contact_type: 'supplier',
  primary_email: 'estimating@fabritec.example',
};

function Harness({ multiple, onValue }: { multiple?: boolean; onValue: (v: string, d: string) => void }) {
  const [state, setState] = useState({ value: '', display: '' });
  return (
    <PartyInput
      id="party"
      multiple={multiple}
      value={state.value}
      display={state.display}
      placeholder="party"
      onChange={(value, display) => {
        setState({ value, display });
        onValue(value, display);
      }}
    />
  );
}

function renderHarness(props: { multiple?: boolean; onValue: (v: string, d: string) => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.apiGet.mockReset();
});

describe('correspondence party input', () => {
  it('keeps a typed name that is not in the directory', async () => {
    api.apiGet.mockResolvedValue({ items: [] });
    const onValue = vi.fn();
    renderHarness({ onValue });
    fireEvent.change(screen.getByPlaceholderText('party'), { target: { value: 'Turner-AECOM Hunt JV' } });
    expect(onValue).toHaveBeenLastCalledWith('Turner-AECOM Hunt JV', 'Turner-AECOM Hunt JV');
    expect((screen.getByPlaceholderText('party') as HTMLInputElement).value).toBe('Turner-AECOM Hunt JV');
  });

  it('stores a picked contact by id and shows its name', async () => {
    api.apiGet.mockResolvedValue({ items: [CONTACT] });
    const onValue = vi.fn();
    renderHarness({ onValue });
    fireEvent.change(screen.getByPlaceholderText('party'), { target: { value: 'Fabri' } });
    const option = await screen.findByText('FabriTec Structures - Estimating Dept', {}, { timeout: 2000 });
    fireEvent.click(option);
    expect(onValue).toHaveBeenLastCalledWith(CONTACT.id, 'FabriTec Structures - Estimating Dept');
    await waitFor(() =>
      expect((screen.getByPlaceholderText('party') as HTMLInputElement).value).toBe(
        'FabriTec Structures - Estimating Dept',
      ),
    );
  });

  it('caps a single party at the server limit', () => {
    renderHarness({ onValue: vi.fn() });
    expect((screen.getByPlaceholderText('party') as HTMLInputElement).maxLength).toBe(255);
  });
});

describe('recipient line helpers', () => {
  it('reads the name being typed after the last comma', () => {
    expect(currentSegment('StadCo LA, Turn')).toBe('Turn');
    expect(currentSegment('StadCo')).toBe('StadCo');
  });

  it('replaces only the name being typed', () => {
    expect(replaceCurrentSegment('StadCo LA, Turn', 'Turner AECOM')).toBe('StadCo LA, Turner AECOM');
    expect(replaceCurrentSegment('Fab', 'FabriTec')).toBe('FabriTec');
  });
});

describe('editing the sender', () => {
  const entry = {
    id: 'c-1',
    project_id: 'p-1',
    reference_number: 'COR-001',
    subject: 'Delay notice',
    direction: 'outgoing',
    correspondence_type: 'letter',
    from_contact_id: CONTACT.id,
    from_name: 'FabriTec Structures - Estimating Dept',
    to_contact_ids: [],
    date_sent: null,
    date_received: null,
    linked_document_ids: [],
    linked_transmittal_id: null,
    linked_rfi_id: null,
    status: 'open',
    response_required_by: null,
    contract_clause_ref: null,
    is_overdue: false,
    days_until_due: null,
    attachments: [],
    notes: null,
    created_by: null,
    created_at: '2026-10-22T00:00:00Z',
    updated_at: '2026-10-22T00:00:00Z',
  } as Correspondence;

  it('opens with the saved name, not the contact id', () => {
    const form = correspondenceFormData(entry);
    expect(form.from_contact).toBe(CONTACT.id);
    expect(form.from_display).toBe('FabriTec Structures - Estimating Dept');
  });

  it('sends the id and the name together when the sender changes', () => {
    const base = correspondenceFormData(entry);
    const patch = buildCorrespondencePatch(
      { ...base, from_contact: 'Turner-AECOM Hunt JV', from_display: 'Turner-AECOM Hunt JV' },
      base,
    );
    expect(patch).toEqual({ from_contact_id: 'Turner-AECOM Hunt JV', from_name: 'Turner-AECOM Hunt JV' });
  });

  it('leaves the sender out when it did not change', () => {
    const base = correspondenceFormData(entry);
    expect(buildCorrespondencePatch({ ...base, subject: 'Revised' }, base)).toEqual({ subject: 'Revised' });
  });
});
