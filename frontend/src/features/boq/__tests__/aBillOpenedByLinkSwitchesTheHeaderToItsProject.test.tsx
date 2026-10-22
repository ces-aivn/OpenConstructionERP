// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A bill opened by its link switches the header to the bill's own project.
 *
 * The editor set the project context only when none was active, so a bill of
 * Landmark 81 opened by URL left the header on the SoFi project that was
 * active before, and every module reading the header worked on the wrong one.
 *
 * Run:  npx vitest run src/features/boq/__tests__/aBillOpenedByLinkSwitchesTheHeaderToItsProject.test.tsx
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    const fallback = opts?.defaultValue;
    return typeof fallback === 'string' ? fallback : key;
  };
  const value = { t, i18n: { language: 'en', changeLanguage: () => {} } };
  return {
    useTranslation: () => value,
    Trans: ({ children }: { children: React.ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
    I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

const grid: { rowIds: string[]; select: ((ids: string[]) => void) | undefined } = { rowIds: [], select: undefined };

vi.mock('../BOQGrid', () => ({
  __esModule: true,
  default: React.forwardRef<
    unknown,
    { positions?: { id: string }[]; onSelectionChanged?: (ids: string[]) => void }
  >(function BOQGridStub(props, _ref) {
    grid.rowIds = (props.positions ?? []).map((p) => p.id);
    grid.select = props.onSelectionChanged;
    return <div data-testid="boq-grid-stub" />;
  }),
}));

vi.mock('@/features/bim/api', () => ({
  fetchBIMModels: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

vi.mock('@/shared/hooks/useBackendModuleOff', () => ({
  useBackendModuleOff: () => () => false,
}));

const BOQ_ID = 'boq-1';
const PROJECT_ID = 'landmark';

const row = (id: string, ordinal: string, description: string, parent_id: string | null, unit: string) => ({
  id,
  boq_id: BOQ_ID,
  parent_id,
  ordinal,
  description,
  unit,
  quantity: unit ? 10 : 0,
  unit_rate: unit ? 50 : 0,
  total: unit ? 500 : 0,
  classification: {},
  source: 'manual',
  confidence: null,
  validation_status: 'pending',
  sort_order: 0,
  metadata: {},
});

const api = vi.hoisted(() => ({ deletePosition: vi.fn(async () => undefined) }));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    boqApi: {
      get: vi.fn(async () => ({
        id: BOQ_ID,
        project_id: PROJECT_ID,
        name: 'Landmark 81 Bill',
        status: 'draft',
        is_locked: false,
        positions: [
          row('s1', '01', 'Shell', null, ''),
          row('p1', '01.001', 'Reinforced concrete wall C30/37', 's1', 'm2'),
        ],
      })),
      deletePosition: api.deletePosition,
      getMarkups: vi.fn(async () => ({ markups: [] })),
      getCostBreakdown: vi.fn(async () => ({
        boq_id: BOQ_ID,
        grand_total: 500,
        direct_cost: 500,
        categories: [],
        markups: [],
        top_resources: [],
      })),
      getLimits: vi.fn(async () => ({ max_nesting_depth: 5 })),
      getActivity: vi.fn(async () => []),
    },
  };
});

vi.mock('@/features/projects/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/projects/api')>();
  return {
    ...actual,
    projectsApi: {
      ...actual.projectsApi,
      get: vi.fn(async () => ({ id: PROJECT_ID, name: 'CS-VN01 Landmark 81', currency: 'VND', fx_rates: [] })),
    },
  };
});

import { BOQEditorPage } from '../BOQEditorPage';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/boq/${BOQ_ID}`]}>
        <Routes>
          <Route path="/boq/:boqId" element={<BOQEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  useAuthStore.setState({ userRole: 'editor' });
});

afterEach(() => cleanup());

describe('opening a bill by its link', () => {
  it('switches the header from another active project to the bill\'s project', async () => {
    useProjectContextStore.getState().setActiveProject('sofi', 'CS-US01 SoFi');

    renderEditor();
    await screen.findByTestId('boq-grid-stub', {}, { timeout: 10_000 });

    await waitFor(() => expect(useProjectContextStore.getState().activeProjectId).toBe(PROJECT_ID), { timeout: 10_000 });
    expect(useProjectContextStore.getState().activeProjectName).toBe('CS-VN01 Landmark 81');
    expect(grid.rowIds).toEqual(expect.arrayContaining(['s1', 'p1']));
  });
});
