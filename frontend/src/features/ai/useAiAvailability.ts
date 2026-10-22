// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Whether the AI features can answer, read once when the app starts.
 *
 * Without a provider key the assistant button, its suggested questions, the
 * AI quick estimate and the cost advisor used to stay on screen and fail only
 * when used. Every AI entry point reads this hook and hides itself, or says
 * plainly that AI is not set up, before the user acts.
 *
 * The answer is kept in one small store shared by every entry point, asked
 * once per session and again whenever Settings > AI saves or tests a key
 * (`oe:ai-settings-updated`), so the entry points come back as soon as a key
 * works, without a reload. A store rather than a React Query hook because the
 * floating assistant renders outside any screen's query scope in some shells.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useAuthStore } from '@/stores/useAuthStore';
import { aiApi, type AIAvailability } from './api';

export type AiAvailabilityState = 'checking' | 'ready' | 'unconfigured';

export interface AiAvailabilityView {
  state: AiAvailabilityState;
  /** The user may add a key in Settings > AI. */
  canConfigure: boolean;
  /** `no_key` or `key_undecryptable` when unconfigured. */
  reason: string | null;
}

/**
 * Reduce the server answer to what an entry point needs.
 *
 * A failed check (an older server without the endpoint, a network blip)
 * counts as ready: the feature reports its own error when used, which is how
 * it behaved before this check existed, and a working AI must never vanish
 * because a status probe did.
 */
export function aiAvailabilityView(
  data: AIAvailability | undefined,
  { isError }: { isError: boolean },
): AiAvailabilityView {
  if (isError) return { state: 'ready', canConfigure: false, reason: null };
  if (!data) return { state: 'checking', canConfigure: false, reason: null };
  return {
    state: data.configured ? 'ready' : 'unconfigured',
    canConfigure: data.can_configure,
    reason: data.configured ? null : data.reason,
  };
}

interface AvailabilityStore {
  data: AIAvailability | undefined;
  isError: boolean;
  inFlight: Promise<void> | null;
  load: (force?: boolean) => Promise<void>;
  /** Forget the answer, for the next user who signs in. */
  reset: () => void;
}

export const useAiAvailabilityStore = create<AvailabilityStore>((set, get) => ({
  data: undefined,
  isError: false,
  inFlight: null,
  load: (force = false) => {
    const { inFlight, data, isError } = get();
    if (inFlight) return inFlight;
    if (!force && (data !== undefined || isError)) return Promise.resolve();
    const run = Promise.resolve()
      .then(() => aiApi.getAvailability())
      .then((answer) => set({ data: answer, isError: false }))
      .catch(() => set({ isError: true }))
      .finally(() => set({ inFlight: null }));
    set({ inFlight: run });
    return run;
  },
  reset: () => set({ data: undefined, isError: false }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('oe:ai-settings-updated', () => {
    void useAiAvailabilityStore.getState().load(true);
  });
}

export function useAiAvailability(): AiAvailabilityView {
  const signedIn = useAuthStore((s) => s.isAuthenticated || Boolean(s.accessToken));
  const data = useAiAvailabilityStore((s) => s.data);
  const isError = useAiAvailabilityStore((s) => s.isError);
  useEffect(() => {
    const store = useAiAvailabilityStore.getState();
    if (signedIn) void store.load();
    else store.reset();
  }, [signedIn]);
  return aiAvailabilityView(data, { isError });
}
