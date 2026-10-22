// In project focus mode every sidebar row is numbered, and a row the project
// does not need lines up with the others instead of sitting further left.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
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
// Focus mode on: the bill of quantities is needed, the cost database is not,
// and every other route (Timeline, Quantities, Activity log...) is outside
// the profile.
vi.mock('@/features/projects/useProjectProfile', () => ({
  useActiveProjectProfile: () => ({ projectId: 'p1', profile: { profile: { focus_mode_enabled: true } }, isLoading: false }),
  buildModuleGate: () => ({
    active: true,
    byRoute: (route: string) =>
      route === '/boq' ? { enabled: true, ordinal: 1 } : route === '/costs' ? { enabled: false, ordinal: null } : null,
  }),
}));

import { Sidebar } from './Sidebar';
import { sidebarNavGroups } from './navCatalog';
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
  useViewModeStore.getState().setMode('advanced');
  localStorage.setItem(
    'oe_sidebar_collapsed_v2',
    JSON.stringify(Object.fromEntries(sidebarNavGroups.map((group) => [group.id, false]))),
  );
});

afterEach(() => {
  cleanup();
});

describe('sidebar rows in project focus mode', () => {
  it('are all numbered, 1 to N in order, including rows outside the project profile', async () => {
    renderSidebar();
    await waitFor(() => expect(document.querySelector('a[href="/costs"]')).not.toBeNull());
    const rows = Array.from(document.querySelectorAll<HTMLAnchorElement>('.oe-sidebar li > a.oe-nav-row'));
    expect(rows.length).toBeGreaterThan(3);
    const numbers = rows.map((a) => a.querySelector('[data-nav-seq]')?.getAttribute('data-nav-seq'));
    expect(numbers).toEqual(rows.map((_, i) => String(i + 1)));
  });

  it('keep a row the project does not need on the same columns as the others', async () => {
    renderSidebar();
    await waitFor(() => expect(document.querySelector('a[href="/costs"]')).not.toBeNull());
    const notNeeded = document.querySelector<HTMLAnchorElement>('a.oe-nav-row[href="/costs"]')!;
    const needed = document.querySelector<HTMLAnchorElement>('a.oe-nav-row[href="/boq"]')!;
    const columns = (a: HTMLElement) => a.className.split(/\s+/).filter((c) => /^(pl-|pr-|gap-)/.test(c)).sort();
    expect(columns(notNeeded)).toEqual(columns(needed));
    expect(notNeeded.className).toContain('text-[12px]');
  });
});
