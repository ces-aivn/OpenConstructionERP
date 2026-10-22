// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The Quantity Rules, BIM Rules and Clash screens. The curated sidebar
// (navCatalog `sidebarNavGroups`) lists none of them: it carries the eight
// operational groups only, and no module-registry rows. The screens are not
// gone, though. Their routes are still registered in the app, and the full
// catalogue still carries their rows for the route-icon map and page titles,
// so a link or a typed address still reaches them. This renders the real
// sidebar in both views, with every group open, to show that.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: unknown }) =>
      typeof opts?.defaultValue === 'string' ? opts.defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/shared/lib/useI18nReady', () => ({ useI18nReady: () => 0 }));
vi.mock('./CustomBranding', () => ({ CustomBranding: () => null }));
// Each notice renders its own name, so a test can read which one the sidebar
// chose without the version check behind them (pinned in updateBadge.test.tsx).
vi.mock('@/shared/ui/UpdateChecker', () => ({
  UpdateNotification: () => 'update-card',
  UpdateBadge: () => 'update-badge',
}));
vi.mock('@/features/modules/RequestCustomModuleDialog', () => ({
  RequestCustomModuleDialog: () => null,
}));
vi.mock('@/shared/hooks/useSidebarBadges', () => ({
  useSidebarBadges: () => ({ tasks: 0, rfi: 0, safety: 0 }),
}));
vi.mock('@/shared/hooks/useHiddenModules', () => ({
  useHiddenModules: () => ({ hiddenModules: [], setHiddenModules: vi.fn() }),
}));
vi.mock('@/features/projects/useProjectProfile', () => ({
  useActiveProjectProfile: () => ({ projectId: null, profile: undefined, isLoading: false }),
  buildModuleGate: () => ({ active: false, byRoute: () => null }),
}));

import { Sidebar } from './Sidebar';
import { navGroups, sidebarNavGroups } from './navCatalog';
import { useAuthStore } from '@/stores/useAuthStore';
import { useModuleStore } from '@/stores/useModuleStore';
import { useViewModeStore } from '@/stores/useViewModeStore';
import { useSidebarCollapseStore } from '@/stores/useSidebarCollapseStore';

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const hrefs = () => Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');

beforeEach(() => {
  localStorage.clear();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation((path: string) =>
    path === '/v1/users/me/onboarding/'
      ? Promise.resolve({ completed: true, company_type: null })
      : Promise.resolve([]),
  );
  useAuthStore.setState({ isAuthenticated: true, userRole: 'editor', userId: 'user-a', accessToken: null });
  useModuleStore.setState({ enabledModules: {}, hiddenGroups: [] });
  useSidebarCollapseStore.getState().setIconified(false);
});

afterEach(() => cleanup());

const OFF_MENU = ['/bim/rules', '/bim/rules?mode=requirements', '/clash'];

/** Open every curated group, through the collapse state the menu reads on mount. */
function expandAllGroups(): void {
  localStorage.setItem(
    'oe_sidebar_collapsed_v2',
    JSON.stringify(Object.fromEntries(sidebarNavGroups.map((group) => [group.id, false]))),
  );
}

const appSource = () => readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

describe('the BIM rules and clash screens, off the curated menu', () => {
  it.each(['simple', 'advanced'] as const)('are not in the %s view, with every group open', async (mode) => {
    useViewModeStore.getState().setMode(mode);
    expandAllGroups();
    renderSidebar();
    // Positive control: the curated rows did render, so an absence below is
    // the catalogue's choice and not an empty menu.
    await waitFor(() => expect(hrefs()).toContain('/boq'));
    expect(hrefs()).toContain('/schedule');
    expect(hrefs()).toContain('/reports');
    for (const route of OFF_MENU) expect(hrefs(), route).not.toContain(route);
  });

  it('are listed by none of the curated groups', () => {
    const curated = sidebarNavGroups.flatMap((group) => group.items.map((item) => item.to));
    expect(curated.length).toBeGreaterThan(0);
    for (const route of OFF_MENU) expect(curated, route).not.toContain(route);
  });

  it('keep their rows in the full catalogue, for the route-icon map and page titles', () => {
    const all = navGroups.flatMap((group) => group.items.map((item) => item.to));
    for (const route of OFF_MENU) expect(all, route).toContain(route);
  });

  it('stay reachable by route: the app still registers each page', () => {
    const app = appSource();
    expect(app).toContain('<Route path="/bim/rules" element={<BimRulesRoute />} />');
    expect(app).toContain('<Route path="/bim/quantity-rules" element={<Navigate to="/bim/rules" replace />} />');
    expect(app).toMatch(/<Route path="\/clash" element=\{<P title="Clash Detection"><ClashDetectionPage \/><\/P>\} \/>/);
  });
});
