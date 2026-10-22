// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The market this workspace serves, expressed as the locale tag its documents
 * group numbers in - or `null` when nothing says.
 *
 * This is an INPUT to `resolveNumberLocale`, not a second answer to the
 * question that function asks. `intlLocale` is the same shape and exists for
 * the same reason: the resolver needs a fact that lives outside the
 * preferences store, and importing the store from the place that owns the
 * fact would close a cycle. There is still exactly one function that decides
 * which locale a number is written in; it now has two inputs instead of one,
 * and the reader's own preference still outranks both.
 *
 * What it is for. `'auto'` used to mean "follow the UI language", and the UI
 * language of an Indian workspace is usually English, which resolves to
 * `en-US`. So an Indian bill of quantities printed `476,579,722.78` where its
 * reader expects `47,65,79,722.78`. The grouping belongs to the document's
 * market rather than to whoever opened it, which is why this is consulted
 * before the UI language and why a German reviewing an Indian bill sees the
 * Indian grouping.
 *
 * Why a module variable rather than the preferences store. Writing the tag
 * into `numberLocale` was tried and is actively wrong: every account carries
 * the seeded `1.234,56` server default, and `adoptServerNumberFormat` maps
 * that onto `de-DE` for any local value other than `'auto'`. A stored
 * `en-IN` would therefore be overwritten with German separators on the next
 * boot, leaving an Indian workspace worse off than before the fix. Resolving
 * at read time cannot be clobbered because nothing is stored.
 *
 * The active project outranks the pack. A project carries its own language
 * (`Project.locale`), and a US project written in US English printed
 * "2.593.679.470,20 US$" for a reader whose interface is Vietnamese. The
 * project context store remembers each project's language and reports the
 * active one here through `setProjectNumberLocale`; the pack's tag stands in
 * when no project is active or its language is unknown. The reader's own
 * explicit number-format preference still outranks both.
 */
import { useSyncExternalStore } from 'react';

/** The active market's number locale, or `null` when no pack is applied. */
let marketTag: string | null = null;
/** The active project's number locale, or `null` when none is known. */
let projectTag: string | null = null;

const listeners = new Set<() => void>();

/** Returns the active project's number-locale tag, else the market's, or `null`. */
export function getMarketNumberLocale(): string | null {
  return projectTag ?? marketTag;
}

/**
 * Record (or clear) the active project's number locale. Same no-op rule as
 * {@link setMarketNumberLocale}.
 */
export function setProjectNumberLocale(tag: string | null): void {
  if (projectTag === tag) return;
  projectTag = tag;
  listeners.forEach((cb) => cb());
}

/**
 * The number locale a project language writes in: `en` is US English, `vi`
 * is Vietnam, a full tag is kept as given. `null` for a blank or malformed
 * value, so a bad stored language falls back rather than throws.
 */
export function numberLocaleForProjectLanguage(language: string | null | undefined): string | null {
  const raw = (language ?? '').trim();
  if (!raw) return null;
  const tag = raw === 'en' ? 'en-US' : raw === 'vi' ? 'vi-VN' : raw;
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : null;
  } catch {
    return null;
  }
}

/**
 * Record (or clear) the market's number locale.
 *
 * Called from `usePartnerPackLocale` when a pack activates, and from
 * `resetPackLocale` with `null` when one is un-applied. Clearing matters as
 * much as setting: nothing persists this tag, so a stale value would outlive
 * the pack that justified it for the rest of the session with no control in
 * the UI able to reach it.
 *
 * A no-op when the tag has not actually changed, so an effect that re-runs on
 * every render of its owner does not wake every money surface in the app.
 */
export function setMarketNumberLocale(tag: string | null): void {
  if (marketTag === tag) return;
  marketTag = tag;
  listeners.forEach((cb) => cb());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/**
 * `getMarketNumberLocale` for a component that has to re-render when it moves.
 *
 * The pack manifest arrives over the network well after first paint, so the
 * money already on screen was formatted before the market was known. Without
 * this subscription those figures keep the Western grouping until an
 * unrelated prop repaints them - the same defect `useIntlLocale` exists to
 * prevent for a language switch. The snapshot is a string or `null`, so
 * React's identity check on it is a value comparison.
 */
export function useMarketNumberLocale(): string | null {
  return useSyncExternalStore(subscribe, getMarketNumberLocale, getMarketNumberLocale);
}
