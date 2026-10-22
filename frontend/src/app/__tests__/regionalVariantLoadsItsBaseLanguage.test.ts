// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A regional variant has to actually *download* the language it falls back to,
 * and a variant the product does not offer must download nothing at all.
 *
 * `i18n.ts` names a fallback chain for regional codes (es-MX -> es -> en).
 * `fallbackLng` only names a bundle; it does not fetch one, so `loadLocaleResource`
 * fetches the base chunk alongside the variant's own.
 *
 * This build offers exactly `vi` and `en-US`. The only regional variant offered is
 * en-US, whose base `en` ships in the main bundle and is seeded as loaded, so the
 * base-chunk path has no offered non-English case left to exercise. The Spanish
 * variants that exercised it are no longer offered, so the loader must refuse them
 * before touching either chunk.
 *
 * Every locale chunk is mocked. The real ones are megabytes of object literal and
 * handing one to the vitest transform pipeline times the worker out, so the stubs
 * are shaped exactly the way a locale file is shaped (one `translation` member of
 * flat dotted keys), and the subject stays on which chunks the loader fetches.
 *
 * The fixtures go through `vi.hoisted` because `vi.mock` factories are hoisted
 * above ordinary `const` declarations, and `../i18n` imports `./locales/en`
 * statically.
 */

const { ONLY_IN_ES, EN_BASE, ES, ES_MX, EN } = vi.hoisted(() => {
  const onlyInEs = 'cases.__probe_only_in_es';
  const inBoth = 'cases.__probe_in_both';
  // Annotated rather than inferred: `addResourceBundle` is handed this shape, and a
  // narrow inferred literal type makes a string-keyed read an implicit any.
  const es: Record<string, string> = {
    [onlyInEs]: 'Encofrado y coste de la partida',
    [inBoth]: 'Certificacion de obra',
  };
  const esMx: Record<string, string> = {
    [inBoth]: 'Estimacion de obra',
  };
  const en: Record<string, string> = {
    [onlyInEs]: 'Formwork and cost of the item',
    [inBoth]: 'Payment certificate',
  };
  return { ONLY_IN_ES: onlyInEs, EN_BASE: inBoth, ES: es, ES_MX: esMx, EN: en };
});

vi.mock('../locales/es.ts', () => ({ default: { translation: ES } }));
vi.mock('../locales/es-MX.ts', () => ({ default: { translation: ES_MX } }));
vi.mock('../locales/en-US.ts', () => ({ default: { translation: {} } }));
vi.mock('../locales/en', () => ({ default: { translation: EN } }));

// Imported statically so the module-level cost of `i18n.ts` is paid during
// collection, not against the hook timeout.
import i18n, { isLocaleLoaded, loadLocaleResource, matchSupportedLanguage } from '../i18n';

beforeAll(async () => {
  await loadLocaleResource('en-US');
});

describe('a regional variant loads only what the product offers', () => {
  it('leaves unsupported Mongolian unloaded, including a regional request', async () => {
    const englishBefore = { ...i18n.getResourceBundle('en', 'translation') };
    for (const code of ['mn', 'mn-MN']) {
      await expect(loadLocaleResource(code)).resolves.toBeUndefined();
      expect(matchSupportedLanguage(code)).toBeNull();
      expect(isLocaleLoaded(code)).toBe(false);
      expect(i18n.getResourceBundle(code, 'translation')).toBeUndefined();
    }
    expect(i18n.getResourceBundle('en', 'translation')).toEqual(englishBefore);
  });

  it('fetches nothing for a regional variant the product does not offer, base included', async () => {
    // es-MX and es are not in SUPPORTED_LANGUAGES. The loader must return before
    // it requests either chunk, so the Spanish strings never reach the store.
    await expect(loadLocaleResource('es-MX')).resolves.toBeUndefined();
    expect(isLocaleLoaded('es-MX')).toBe(false);
    expect(isLocaleLoaded('es')).toBe(false);
    const esBundle = i18n.getResourceBundle('es', 'translation') as Record<string, string> | undefined;
    expect(esBundle?.[ONLY_IN_ES]).toBeUndefined();
    expect(i18n.t(ONLY_IN_ES, { lng: 'es-MX' })).toBe(EN[ONLY_IN_ES]);
  });

  it('answers the offered en-US variant from its English base, without a second chunk', async () => {
    // en-US derives base `en`, which is seeded into `loadedLocales` and ships in
    // the main bundle. Nothing extra should be fetched for it.
    await expect(loadLocaleResource('en-US')).resolves.toBeUndefined();
    const bundle = i18n.getResourceBundle('en', 'translation') as Record<string, string>;
    expect(bundle?.[EN_BASE]).toBe(EN[EN_BASE]);
    expect(i18n.t(EN_BASE, { lng: 'en-US' })).toBe(EN[EN_BASE]);
  });

  it('has a probe that could tell the strings apart in the first place', () => {
    // Guards the fixtures: if these ever became equal the assertions above would
    // pass for the wrong reason.
    expect(ES[EN_BASE]).not.toBe(ES_MX[EN_BASE]);
    expect(ES[ONLY_IN_ES]).not.toBe(EN[ONLY_IN_ES]);
  });
});
