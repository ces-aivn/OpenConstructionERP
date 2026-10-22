// Sidebar rows keep full strength while a page loads; the row being opened
// shows that it is loading instead of every row fading.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, waitFor } from '@testing-library/react';
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
import { sidebarNavGroups } from './navCatalog';
import { useNavPendingStore } from '@/shared/lib/navigationProgress';
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
  useNavPendingStore.getState().clearPending();
  cleanup();
});

describe('sidebar rows while a page loads', () => {
  it('are drawn at full strength, with no entrance fade that can stall half-way', async () => {
    renderSidebar();
    await waitFor(() => expect(document.querySelector('a[href="/costs"]')).not.toBeNull());
    for (const li of Array.from(document.querySelectorAll('.oe-sidebar li'))) {
      expect(li.className).not.toContain('oe-stagger');
      expect((li as HTMLElement).style.animationDelay).toBe('');
      expect((li as HTMLElement).style.opacity).toBe('');
    }
  });

  it('mark the row being opened as busy, and only that row', async () => {
    renderSidebar();
    await waitFor(() => expect(document.querySelector('a[href="/catalog"]')).not.toBeNull());
    act(() => useNavPendingStore.getState().markPending('/catalog'));
    const busy = Array.from(document.querySelectorAll('a[aria-busy="true"]')).map((a) => a.getAttribute('href'));
    expect(busy).toEqual(['/catalog']);
  });
});
