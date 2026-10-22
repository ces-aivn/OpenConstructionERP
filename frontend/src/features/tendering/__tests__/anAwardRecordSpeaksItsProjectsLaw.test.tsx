// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The award record is worded against the rules of the project's own country.
// It used to open every record with German public procurement law (the
// Vergabevermerk, VOB/A section 20, VgV section 8), for a private stadium in
// the US and a factory in Vietnam alike.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AwardRecord, AwardRecordSection } from '../api';

/* -- Toast mock ------------------------------------------------------- */

const toastMocks = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/stores/useToastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: typeof toastMocks.addToast }) => unknown) =>
      selector({ addToast: toastMocks.addToast }),
    { getState: () => ({ addToast: toastMocks.addToast }) },
  ),
}));

/* -- i18n shim - return defaultValue with interpolation. -------------- */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      if (typeof opts === 'object' && opts && 'defaultValue' in opts) {
        let dv = String(opts.defaultValue ?? '');
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          dv = dv.replaceAll(`{{${k}}}`, String(v));
        }
        return dv;
      }
      return _key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
  I18nextProvider: ({ children }: { children: unknown }) => children,
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

/* -- API mock --------------------------------------------------------- */

const apiMocks = vi.hoisted(() => ({
  getAwardRecord: vi.fn(),
  recordAwardRecordNote: vi.fn(),
}));
vi.mock('../api', () => ({
  getAwardRecord: apiMocks.getAwardRecord,
  recordAwardRecordNote: apiMocks.recordAwardRecordNote,
}));

import { AwardRecordPanel } from '../AwardRecordPanel';

function section(overrides: Partial<AwardRecordSection> & { key: string }): AwardRecordSection {
  return {
    source: 'reasoning',
    state: 'missing',
    facts: [],
    statement: '',
    value: '',
    recorded_at: null,
    recorded_by: null,
    superseded: [],
    ...overrides,
  };
}

function makeRecord(overrides?: Partial<AwardRecord>): AwardRecord {
  return {
    package_id: 'p-1',
    package_name: 'Dachabdichtung BA 2',
    project_name: 'Neubau Halle 3',
    stage: 'draft',
    currency: 'EUR',
    started: false,
    started_at: null,
    is_complete: false,
    sections: [
      section({
        key: 'subject',
        source: 'procedure',
        state: 'recorded',
        facts: [
          { key: 'package_name', text: 'Dachabdichtung BA 2', amount: null, currency: '', count: null, at: null, state: '' },
        ],
      }),
      section({ key: 'procedure_type' }),
      section({ key: 'procedure_reason' }),
      section({ key: 'award_reason', state: 'not_due_yet' }),
    ],
    gaps: [
      { section: 'procedure_type', source: 'reasoning' },
      { section: 'procedure_reason', source: 'reasoning' },
    ],
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AwardRecordPanel packageId="p-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMocks.getAwardRecord.mockReset();
  apiMocks.recordAwardRecordNote.mockReset();
  toastMocks.addToast.mockReset();
});

afterEach(cleanup);

const GERMAN = /Vergabevermerk|VOB\/A|VgV|Ausschreibung|Vergabe\b/;

describe('the award record and the project country', () => {
  it('cites the Vietnamese Law on Bidding for a project in Vietnam', async () => {
    apiMocks.getAwardRecord.mockResolvedValue(makeRecord({ legal_framework: 'vn', country_code: 'VN' }));
    renderPanel();
    expect(await screen.findByText(/Law on Bidding No\. 22\/2023\/QH15/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(GERMAN);
  });

  it('words a US record as a private procurement', async () => {
    apiMocks.getAwardRecord.mockResolvedValue(makeRecord({ legal_framework: 'us', country_code: 'US' }));
    renderPanel();
    expect(await screen.findByText(/private procurement/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(GERMAN);
  });

  it('names no body of rules when the project names no country', async () => {
    apiMocks.getAwardRecord.mockResolvedValue(makeRecord({ legal_framework: 'neutral', country_code: null }));
    renderPanel();
    expect(await screen.findByText(/A written record of how this package was awarded/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(GERMAN);
  });

  it('keeps the German wording for a German project', async () => {
    apiMocks.getAwardRecord.mockResolvedValue(makeRecord({ legal_framework: 'de', country_code: 'DE' }));
    renderPanel();
    expect(await screen.findByText(/VOB\/A section 20/)).toBeTruthy();
  });
});
