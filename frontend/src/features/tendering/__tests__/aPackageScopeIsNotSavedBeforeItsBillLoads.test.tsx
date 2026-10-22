// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The scope dialog of a tender package shows nothing picked until the bill's
// rows arrive, and an empty scope means "the whole bill". Saving in that
// moment widened a package to the whole bill, and every bid was then compared
// against the full budget. Save waits for the rows, and a save with nothing
// changed sends the stored scope back as it was.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const apiGet = vi.fn();
vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()),
  apiGet: (...args: unknown[]) => apiGet(...args),
}));

const setPackageScope = vi.fn();
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  setPackageScope: (...args: unknown[]) => setPackageScope(...args),
}));

import { PackageScopeModal } from '../PackageScopePicker';

const ROWS = [
  { id: 's1', parent_id: null, ordinal: '01', description: 'Earthworks', unit: '', quantity: 0, unit_rate: 0, total: 300 },
  { id: 'p1', parent_id: 's1', ordinal: '01.01', description: 'Excavation', unit: 'm3', quantity: 1, unit_rate: 100, total: 100 },
  { id: 'p2', parent_id: 's1', ordinal: '01.02', description: 'Backfill', unit: 'm3', quantity: 1, unit_rate: 200, total: 200 },
];

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PackageScopeModal
        packageId="pkg-1"
        boqId="boq-1"
        scope={{ position_ids: ['p1'] } as never}
        currency="EUR"
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
}

beforeEach(() => {
  apiGet.mockReset();
  setPackageScope.mockReset();
  setPackageScope.mockResolvedValue({ position_ids: ['p1'] });
});
afterEach(cleanup);

describe('the package scope dialog', () => {
  it('cannot be saved while the bill is still loading', () => {
    apiGet.mockReturnValue(new Promise(() => undefined));
    renderModal();
    expect(saveButton().disabled).toBe(true);
  });

  it('sends the stored scope back unchanged when nothing was edited', async () => {
    apiGet.mockResolvedValue({ positions: ROWS });
    renderModal();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(setPackageScope).toHaveBeenCalledWith('pkg-1', { position_ids: ['p1'] }));
  });
});
