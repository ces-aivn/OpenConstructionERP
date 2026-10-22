// With no AI provider configured the assistant is not offered: its floating
// button is hidden before anyone can click it, and it returns as soon as a
// key works. A failed availability check never hides a working assistant.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getAvailability = vi.fn();
vi.mock('@/features/ai/api', () => ({ aiApi: { getAvailability: () => getAvailability() } }));

import { aiAvailabilityView, useAiAvailabilityStore } from '../useAiAvailability';
import { FloatingChatButton } from '@/features/erp-chat/FloatingChatButton';
import { useAuthStore } from '@/stores/useAuthStore';

describe('aiAvailabilityView', () => {
  it('reads the server answer', () => {
    expect(
      aiAvailabilityView({ configured: false, provider: null, reason: 'no_key', can_configure: true }, { isError: false }),
    ).toEqual({ state: 'unconfigured', canConfigure: true, reason: 'no_key' });
    expect(
      aiAvailabilityView({ configured: true, provider: 'openai', reason: null, can_configure: false }, { isError: false })
        .state,
    ).toBe('ready');
  });

  it('is checking until an answer lands, and fails open', () => {
    expect(aiAvailabilityView(undefined, { isError: false }).state).toBe('checking');
    expect(aiAvailabilityView(undefined, { isError: true }).state).toBe('ready');
  });
});

describe('the floating assistant button', () => {
  beforeEach(() => {
    cleanup();
    getAvailability.mockReset();
    useAiAvailabilityStore.getState().reset();
    useAuthStore.setState({ isAuthenticated: true, accessToken: 'token' } as never);
  });

  async function mountButton() {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <FloatingChatButton />
      </MemoryRouter>,
    );
    await act(async () => {
      await useAiAvailabilityStore.getState().inFlight;
    });
  }

  it('is hidden when no provider is configured', async () => {
    getAvailability.mockResolvedValue({ configured: false, provider: null, reason: 'no_key', can_configure: false });
    await mountButton();
    expect(screen.queryByTestId('floating-chat-button')).toBeNull();
  });

  it('shows when a provider is configured', async () => {
    getAvailability.mockResolvedValue({ configured: true, provider: 'anthropic', reason: null, can_configure: true });
    await mountButton();
    expect(screen.getByTestId('floating-chat-button')).toBeTruthy();
  });

  it('comes back after Settings > AI saves a key', async () => {
    getAvailability.mockResolvedValueOnce({ configured: false, provider: null, reason: 'no_key', can_configure: true });
    await mountButton();
    expect(screen.queryByTestId('floating-chat-button')).toBeNull();

    getAvailability.mockResolvedValueOnce({ configured: true, provider: 'openai', reason: null, can_configure: true });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('oe:ai-settings-updated'));
      await useAiAvailabilityStore.getState().inFlight;
    });
    expect(screen.getByTestId('floating-chat-button')).toBeTruthy();
  });
});
