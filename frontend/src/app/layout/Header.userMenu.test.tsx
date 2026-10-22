// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The account menu in the top bar. Profile and Sign out are for everyone;
// system Settings and user management are for admins only, because the
// sidebar carries no configuration rows any more.
//
// The global react-i18next mock answers `t(key, 'literal')` with the key, not
// the literal, so the menu items are asserted by their translation keys.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';
import { useAuthStore } from '@/stores/useAuthStore';

function renderHeaderAs(role: 'admin' | 'editor' | 'viewer') {
  useAuthStore.setState({
    isAuthenticated: true,
    userRole: role,
    userEmail: 'person@example.com',
    userId: 'user-a',
    accessToken: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Header title="Dashboard" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  const menu = screen.getByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim());
}

beforeEach(() => {
  localStorage.clear();
});

describe('the account menu in the top bar', () => {
  it('gives a non-admin Profile and Sign out, and no Settings or Users', () => {
    const items = renderHeaderAs('editor');
    expect(items).toEqual(['auth.profile', 'auth.logout']);
  });

  it('gives a viewer the same two items as an editor', () => {
    const items = renderHeaderAs('viewer');
    expect(items).toEqual(['auth.profile', 'auth.logout']);
  });

  it('gives an admin Profile, Settings, Users and Sign out', () => {
    const items = renderHeaderAs('admin');
    expect(items).toEqual(['auth.profile', 'nav.settings', 'sidebar.admin_grid.users', 'auth.logout']);
  });
});
