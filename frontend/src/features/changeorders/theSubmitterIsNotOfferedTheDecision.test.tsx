// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Four-eyes on the single-step path: the server refuses an approval or a
// rejection by the person who submitted the change order, so the detail view
// must not offer those buttons to them. A manager who did not submit the
// order still gets them; that is the control that pins the rule.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
    useSearchParams: () => [new URLSearchParams('?highlight=co-1'), vi.fn()],
  };
});

vi.mock('react-i18next', () => {
  type Opts = Record<string, unknown>;
  const fill = (template: string, opts?: Opts): string => {
    if (!opts) return template;
    const scope = (opts.replace as Opts | undefined) ?? opts;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      scope[name] === undefined ? `{{${name}}}` : String(scope[name]),
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

/* ── Transport ─────────────────────────────────────────────────────────────
   One router keyed by URL, spread over the real module so `ApiError` stays
   the class the page's `instanceof` check is written against. Unknown URLs
   answer an empty list rather than throwing: the detail view pulls in an
   evidence panel, a contracts lookup and a user directory that have nothing
   to do with the picker, and each of them failing loudly would bury it. */

const apiGetMock = vi.fn();

vi.mock('@/shared/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/api')>();
  return {
    ...actual,
    apiGet: (url: string, ...rest: unknown[]) => apiGetMock(url, ...rest),
    apiPost: vi.fn(() => Promise.resolve({})),
    apiDelete: vi.fn(() => Promise.resolve({})),
  };
});

/* Feature api: spread the real module so `isWritebackRefusal` keeps its real
   behaviour, and replace only the calls that would hit the network. */
const getApprovalsMock = vi.fn();

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    getApprovals: (...args: unknown[]) => getApprovalsMock(...args),
    advanceApproval: vi.fn(() => Promise.resolve({})),
    startApprovalChain: vi.fn(() => Promise.resolve([])),
    simulateImpact: vi.fn(() => Promise.resolve({})),
    publishScenario: vi.fn(() => Promise.resolve({})),
    aiDraftChangeOrder: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock('@/features/contracts/api', () => ({
  listContracts: vi.fn(() => Promise.resolve([])),
}));

/* Panels that own their own data and none of this question. Stubbing them
   keeps a failure here about the picker. */
vi.mock('@/features/claims-evidence', () => ({
  ProvabilityGauge: () => null,
  EvidenceThreadPanel: () => null,
}));

vi.mock('@/features/insights', () => ({
  InsightsPanel: () => null,
  InsightsToggleButton: () => null,
  useModuleInsights: () => ({ open: false, toggle: vi.fn(), insights: [], kpis: [], series: [] }),
}));

vi.mock('./ImpactSimulator', () => ({ ImpactSimulator: () => null }));
vi.mock('./AIDraftModal', () => ({ AIDraftModal: () => null }));

vi.mock('@/stores/useProjectContextStore', () => {
  const state = { activeProjectId: 'proj-1' };
  return {
    useProjectContextStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/stores/useToastStore', () => {
  const state = { addToast: vi.fn(), toasts: [], removeToast: vi.fn() };
  return {
    useToastStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

/* Auth is what the tests vary, so it reads a mutable box rather than a
   frozen literal. */
const auth = { userRole: 'admin', accessToken: '' };

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (selector?: (s: typeof auth) => unknown) => (selector ? selector(auth) : auth),
}));

import { ChangeOrdersPage } from './ChangeOrdersPage';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

function tokenFor(userId: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId })}.signature`;
}

function order(submittedBy: string) {
  return {
    id: 'co-1',
    project_id: 'proj-1',
    code: 'CO-001',
    title: 'Record rainfall delay',
    description: '',
    reason_category: 'weather_force_majeure',
    status: 'submitted',
    submitted_by: submittedBy,
    submitted_by_name: null,
    approved_by: null,
    approved_by_name: null,
    rejected_by: null,
    rejected_by_name: null,
    submitted_at: '2026-08-01T10:00:00Z',
    approved_at: null,
    rejected_at: null,
    cost_impact: '0.00',
    schedule_impact_days: 60,
    currency: 'USD',
    metadata: {},
    item_count: 0,
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    current_approval_step: null,
    items: [],
  };
}

function setTransport(submittedBy: string): void {
  apiGetMock.mockImplementation((url: string) => {
    if (url.startsWith('/v1/boq/boqs/')) return Promise.resolve([{ id: 'boq-a', name: 'Main', is_locked: false }]);
    if (url.startsWith('/v1/projects/?')) {
      return Promise.resolve([{ id: 'proj-1', name: 'SoFi', currency: 'USD' }]);
    }
    if (url.startsWith('/v1/changeorders/co-1')) return Promise.resolve(order(submittedBy));
    return Promise.resolve([]);
  });
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/changeorders?highlight=co-1']}>
        <ChangeOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('four-eyes on the change order detail view', () => {
  beforeEach(() => {
    auth.userRole = 'manager';
    auth.accessToken = tokenFor(ME);
    apiGetMock.mockReset();
    getApprovalsMock.mockReset();
    getApprovalsMock.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('does not offer Approve or Reject to the submitter', async () => {
    setTransport(ME);
    renderDetail();
    await screen.findByText('Record rainfall delay');
    await screen.findByText(/another manager must approve or reject it/);
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject$/ })).toBeNull();
  });

  it('offers them to a manager who did not submit the order', async () => {
    setTransport(SOMEONE_ELSE);
    renderDetail();
    await screen.findByText('Record rainfall delay');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Approve$/ })).toBeTruthy());
    expect(screen.queryByText(/another manager must approve or reject it/)).toBeNull();
  });
});
