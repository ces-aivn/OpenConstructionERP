// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Guards the map that keeps relative timestamps out of English.
 *
 * The defect this replaces was invisible to every gate we own, because
 * `formatDistanceToNow(d, { addSuffix: true })` is valid code that returns a
 * valid string. It just returns an English one, forever, in all languages. Nothing throws and nothing renders a raw key, so the only
 * instrument that catches it is one that names the language it expects.
 *
 * The table below is written out rather than derived, because a derived
 * expectation would reproduce whatever the map says and agree with itself.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { dateFnsLocaleFor, LANGUAGES_WITHOUT_DATE_FNS_LOCALE } from './dateFnsLocale';

/**
 * i18next code → the `code` field of the date-fns locale it must resolve to.
 *
 * The product offers only `vi` and `en-US`, but the date-fns map still names
 * the wider set. This table pins the map itself, so re-offering a language
 * later does not need the map rebuilt from memory.
 */
const MAP_CONTRACT: Record<string, string> = {
  // Plain `en` names no region and date-fns ships no region-free English, so
  // it lands on enUS, which is also what CLDR gives unqualified `en`. The two
  // regional entries each get their own, and en-GB having its own is the
  // point of offering it: without the entry it would inherit `en` and a
  // British reader would be shown American dates by the date-fns path while
  // the Intl path showed British ones.
  en: 'en-US',
  'en-GB': 'en-GB',
  'en-US': 'en-US',
  de: 'de',
  fr: 'fr',
  es: 'es',
  'es-MX': 'es',
  'es-CL': 'es',
  'es-CO': 'es',
  pt: 'pt',
  'pt-BR': 'pt-BR',
  ru: 'ru',
  zh: 'zh-CN',
  ar: 'ar',
  hi: 'hi',
  tr: 'tr',
  it: 'it',
  nl: 'nl',
  pl: 'pl',
  cs: 'cs',
  ja: 'ja',
  ko: 'ko',
  sv: 'sv',
  no: 'nb',
  da: 'da',
  fi: 'fi',
  bg: 'bg',
  hr: 'hr',
  hu: 'hu',
  id: 'id',
  ro: 'ro',
  th: 'th',
  vi: 'vi',
  ky: 'en-US',
  et: 'et',
  bn: 'bn',
  kk: 'kk',
  fil: 'en-US',
  ur: 'en-US',
  fa: 'fa-IR',
  he: 'he',
  el: 'el',
  uk: 'uk',
  uz: 'uz',
};

describe('date-fns locale resolution', () => {
  it('resolves every offered language to the locale named for it', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      const expected = MAP_CONTRACT[code];
      expect(expected, `no expectation recorded for language "${code}"`).toBeDefined();
      expect(dateFnsLocaleFor(code).code, `language "${code}"`).toBe(expected);
    }
  });

  it('offers exactly Vietnamese and US English', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort()).toEqual(['en-US', 'vi']);
  });

  it('keeps the whole map contract, so a language re-offered later needs no new code', () => {
    for (const [code, expected] of Object.entries(MAP_CONTRACT)) {
      expect(dateFnsLocaleFor(code).code, `language "${code}"`).toBe(expected);
    }
  });

  it('falls back to English only for the three languages date-fns has no locale for', () => {
    // Asserted in both directions on purpose. The first half says the gap is
    // where we think it is; the second says nothing offered quietly joined it,
    // which is the failure mode that put this defect in front of readers.
    const gaps = [...LANGUAGES_WITHOUT_DATE_FNS_LOCALE];
    for (const code of gaps) {
      expect(dateFnsLocaleFor(code).code, `known gap "${code}"`).toBe('en-US');
    }
    const offeredCodes = SUPPORTED_LANGUAGES.map((l) => l.code);
    const fallingBack = offeredCodes
      .filter((c) => !c.startsWith('en'))
      .filter((c) => dateFnsLocaleFor(c).code === 'en-US')
      .sort();
    // None of the offered non-English languages is one of the gaps.
    expect(fallingBack).toEqual(gaps.filter((g) => offeredCodes.includes(g)).sort());
  });

  it('resolves a regional code through its base language', () => {
    // Regional Spanish is not in the map by name; it must not land on English.
    expect(dateFnsLocaleFor('es-419').code).toBe('es');
    expect(dateFnsLocaleFor('de-AT').code).toBe('de');
  });

  it('answers English for an empty or unknown language rather than throwing', () => {
    expect(dateFnsLocaleFor(undefined).code).toBe('en-US');
    expect(dateFnsLocaleFor('').code).toBe('en-US');
    expect(dateFnsLocaleFor('qqq').code).toBe('en-US');
  });
});
