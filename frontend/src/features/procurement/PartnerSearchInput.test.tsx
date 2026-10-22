// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Tests for <PartnerSearchInput>: one supplier list over contacts, the vendor
// register and subcontractors. A register entry with no contact yet is linked
// to one through the server before the order takes it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PartnerSearchInput, partnersUrl, type Partner } from './PartnerSearchInput';

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { apiGet, apiPost } from '@/shared/lib/api';

const mockGet = vi.mocked(apiGet);
const mockPost = vi.mocked(apiPost);

const contactRow: Partner = {
  source: 'contact',
  id: 'c-1',
  contact_id: 'c-1',
  name: 'Cong ty Thep Hoa Phat',
  also_in: ['vendor'],
};
const vendorRow: Partner = {
  source: 'vendor',
  id: 'v-2',
  contact_id: null,
  name: 'Xi mang Ha Tien',
  code: 'NCC-002',
};

function renderPicker(onChange = vi.fn(), value = '', displayValue = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerSearchInput value={value} displayValue={displayValue} onChange={onChange} ariaLabel="Supplier" />
    </QueryClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue({ items: [contactRow, vendorRow], total: 2 });
});

describe('partnersUrl', () => {
  it('trims the search and passes the limit', () => {
    expect(partnersUrl('  thep ', 10)).toBe('/v1/procurement/partners/?q=thep&limit=10');
  });
});

describe('PartnerSearchInput', () => {
  it('lists partners from every register with their source', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    expect(await screen.findByText('Cong ty Thep Hoa Phat')).toBeInTheDocument();
    expect(screen.getByText('Xi mang Ha Tien')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(partnersUrl(''));
  });

  it('takes a contact as it is', async () => {
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    await userEvent.click(await screen.findByText('Cong ty Thep Hoa Phat'));
    expect(onChange).toHaveBeenCalledWith('c-1', 'Cong ty Thep Hoa Phat');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('links a register entry to a contact before taking it', async () => {
    mockPost.mockResolvedValue({ contact_id: 'c-9', name: 'Xi mang Ha Tien', created: true });
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    await userEvent.click(await screen.findByText('Xi mang Ha Tien'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('c-9', 'Xi mang Ha Tien'));
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/procurement/partners/resolve/',
      { source: 'vendor', id: 'v-2' },
      { suppressErrorToast: true },
    );
  });

  it('shows why a link failed and keeps the order without a supplier', async () => {
    mockPost.mockRejectedValue(new Error('Partner not found'));
    const onChange = renderPicker();
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    await userEvent.click(await screen.findByText('Xi mang Ha Tien'));
    expect(await screen.findByText('Partner not found')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes the list on Escape without letting the dialog see the key', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    try {
      renderPicker();
      const box = screen.getByRole('combobox', { name: 'Supplier' });
      await userEvent.click(box);
      await screen.findByText('Cong ty Thep Hoa Phat');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(outer).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outer);
    }
  });

  it('un-picks the supplier when the user types over it', async () => {
    const onChange = renderPicker(vi.fn(), 'c-1', 'Cong ty Thep Hoa Phat');
    const box = screen.getByRole('combobox', { name: 'Supplier' });
    await userEvent.type(box, 'x');
    expect(onChange).toHaveBeenCalledWith('', '');
  });
});
