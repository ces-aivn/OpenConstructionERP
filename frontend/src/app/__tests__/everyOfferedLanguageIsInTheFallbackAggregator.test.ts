// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The list of languages we offer and the list every locale test iterates must
 * not drift apart.
 *
 * ``i18n-fallbacks.ts`` aggregates the per-locale resources so that tests can
 * iterate the locales without repeating forty imports. A locale missing from it
 * is simply invisible to every test that iterates the object, which is how
 * Kyrgyz, Greek and Ukrainian each went unchecked while shipping.
 *
 * This build offers vi and en-US only, but the other locale files stay on disk
 * on purpose so they can be re-enabled without re-translating. The aggregator
 * therefore holds every shipped file, not just the offered ones. The invariant
 * is that the aggregator and the files on disk agree exactly, apart from the two
 * overlay files, and that every offered language is aggregated.
 *
 * Writing these as exact set differences rather than as counts is deliberate: a
 * count passes again the moment two mistakes cancel out.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_LANGUAGES } from '../i18n';
import { fallbackResources } from '../i18n-fallbacks';

/**
 * Overlay files that are deliberately not aggregated.
 *
 * ``en-GB`` and ``en-US`` are overrides-only overlays rather than full locales,
 * so a test that iterates the object would compare a deliberate small overlay
 * against a full file and report a gap that is the whole point of those files.
 */
const OVERLAYS = ['en-GB', 'en-US'];

const LOCALES = resolve(__dirname, '..', 'locales');

/** Every locale file on disk, by code, excluding the barrel. */
const shipped = readdirSync(LOCALES)
  .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
  .map((name) => name.slice(0, -3));

describe('the offered languages and the fallback aggregator', () => {
  const offered = new Set(SUPPORTED_LANGUAGES.map((language) => language.code));
  const aggregated = new Set(Object.keys(fallbackResources));

  it('leaves no offered language out of the aggregator except the named overlay', () => {
    const missing = [...offered].filter((code) => !aggregated.has(code)).sort();

    expect(missing).toEqual([...OVERLAYS.filter((code) => offered.has(code))].sort());
  });

  it('aggregates exactly the shipped locale files, no more and no fewer', () => {
    // Retained but unoffered locales are expected here. What must not happen is a
    // file on disk that no test iterates, or an aggregated entry with no file.
    const expected = shipped.filter((code) => !OVERLAYS.includes(code)).sort();

    expect([...aggregated].sort()).toEqual(expected);
  });

  it('names each exception rather than merely counting them', () => {
    // The counts are the weakest form of this check and are asserted only to
    // catch a rewrite that empties one of the lists above and leaves the set
    // comparisons trivially true.
    expect(OVERLAYS.filter((code) => shipped.includes(code))).toEqual(OVERLAYS);
    expect(offered.size).toBe(SUPPORTED_LANGUAGES.length);
    expect(aggregated.size).toBeGreaterThan(offered.size);
  });
});
