// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Two things the progress page has to get right. The record-progress dialog
// offers every priced BOQ position, measured or not: it used to read the
// quantity-variance report, which lists only measured positions, so a priced
// bill nobody had measured yet could never take its first reading. And the
// S-curve says where its plan line comes from and stops the actual line at
// the last reading instead of drawing a carried-forward value as measured.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => {
  type Opts = Record<string, unknown>;
  const fill = (template: string, opts?: Opts): string => {
    if (!opts) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      opts[name] === undefined ? `{{${name}}}` : String(opts[name]),
    );
  };
  return {
    useTranslation: () => ({
      t: (key: string, second?: string | Opts, third?: Opts) => {
        if (typeof second === 'string') return fill(second, third);
        const dflt = second?.defaultValue;
        return fill(typeof dflt === 'string' ? dflt : key, second);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: unknown }) => children ?? null,
    initReactI18next: { type: '3rdParty', init: () => undefined },
    I18nextProvider: ({ children }: { children?: unknown }) => children ?? null,
  };
});

vi.mock('@/shared/lib/projectList', () => ({
  fetchProjectList: () => Promise.resolve([{ id: 'proj-1' }]),
}));

const store = vi.hoisted(() => ({ activeProjectId: 'proj-1' as string | null, activeProjectName: 'LEGO' }));
vi.mock('@/stores/useProjectContextStore', () => ({
  useProjectContextStore: (selector?: (s: typeof store) => unknown) => (selector ? selector(store) : store),
}));

const dialogProps = vi.hoisted(() => ({ last: null as null | { positions: { boq_position_id: string }[] } }));
vi.mock('./RecordProgressDialog', () => ({
  RecordProgressDialog: (props: { positions: { boq_position_id: string }[] }) => {
    dialogProps.last = props;
    return null;
  },
}));

const priced = Array.from({ length: 14 }, (_v, i) => ({
  boq_position_id: `pos-${i + 1}`,
  boq_id: 'boq-1',
  boq_name: 'LEGO main',
  ordinal: `01.${String(i + 1).padStart(3, '0')}`,
  description: `Item ${i + 1}`,
  unit: 'm3',
  design_quantity: '10',
  total: '1000',
  percent_complete: null,
}));

vi.mock('./api', () => ({
  getProgressCumulative: () =>
    Promise.resolve({ project_id: 'proj-1', boq_position_id: null, periods: [], current_cumulative_pct: 30 }),
  getProgressSCurve: () =>
    Promise.resolve({
      project_id: 'proj-1',
      plan_source: 'schedule',
      plan_uses_baseline: false,
      points: [
        { period_label: '2023-11', actual_cumulative_pct: 30, planned_cumulative_pct: 25, planned_source: 'schedule', actual_recorded: true },
        { period_label: '2023-12', actual_cumulative_pct: 45, planned_cumulative_pct: 40, planned_source: 'schedule', actual_recorded: true },
        { period_label: '2024-01', actual_cumulative_pct: 45, planned_cumulative_pct: 60, planned_source: 'schedule', actual_recorded: false },
      ],
    }),
  getTrackablePositions: () => Promise.resolve({ project_id: 'proj-1', positions: priced }),
  getQuantityVariance: () =>
    Promise.resolve({
      project_id: 'proj-1',
      positions: [],
      rollup: {
        position_count: 0,
        over_run_count: 0,
        under_run_count: 0,
        on_target_count: 0,
        design_quantity_total: '0',
        earned_quantity_total: '0',
        variance_total: '0',
        variance_percent: null,
      },
    }),
}));

import { ProgressPage } from './ProgressPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/progress']}>
        <ProgressPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('the progress page', () => {
  it('offers every priced position to measure, even with none measured yet', async () => {
    renderPage();
    await waitFor(() => expect(dialogProps.last?.positions).toHaveLength(14));
    expect(dialogProps.last?.positions[0]?.boq_position_id).toBe('pos-1');
  });

  it('labels the plan as coming from the 4D schedule and ends the actual line at the last reading', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Planned (4D schedule)')).toBeTruthy();
    // Two recorded periods: two actual markers, three planned ones.
    await waitFor(() => expect(container.querySelectorAll('circle.text-oe-blue')).toHaveLength(2));
    expect(container.querySelectorAll('circle.text-content-tertiary')).toHaveLength(3);
  });
});
