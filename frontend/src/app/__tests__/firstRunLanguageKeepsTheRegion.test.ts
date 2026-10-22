// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// OpenConstructionERP — DataDrivenConstruction (DDC)
// Tests for first-run language selection: resolveInitialLanguage asks for the
// full browser code before stripping the region, and detectCountry reads a
// country from the region subtag or, failing that, from the resolved language.
//
// This build offers exactly vi and en-US. Any English browser resolves to en-US,
// any other unoffered browser language resolves to the Vietnamese fallback.
import { afterEach, describe, expect, it } from 'vitest';

import { detectCountry, resolveInitialLanguage, SUPPORTED_LANGUAGES } from '../i18n';

const realLanguage = navigator.language;
const realLanguages = navigator.languages;

/**
 * Point navigator.language and localStorage at a clean first run.
 *
 * defineProperty rather than vi.spyOn: in jsdom `language` is an accessor on
 * Navigator.prototype, not an own property of the instance, and spyOn wants an
 * own descriptor.
 */
function firstRunWith(browserLanguage: string): void {
  Object.defineProperty(window.navigator, 'language', {
    value: browserLanguage,
    configurable: true,
  });
  // A real browser lists its language first in `languages`; jsdom's default
  // list is en-US whatever `language` says, and detectCountry reads the list.
  Object.defineProperty(window.navigator, 'languages', {
    value: [browserLanguage],
    configurable: true,
  });
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
}

afterEach(() => {
  Object.defineProperty(window.navigator, 'language', {
    value: realLanguage,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'languages', {
    value: realLanguages,
    configurable: true,
  });
  window.localStorage.clear();
});

describe('resolveInitialLanguage', () => {
  it('keeps a region the UI ships, so an en-US browser opens in en-US', () => {
    // The regression this guards: the browser code was split on '-' and only the
    // base kept, so a regional file the UI ships sat unused. en-US is the one
    // regional code we offer.
    firstRunWith('en-US');
    expect(resolveInitialLanguage()).toBe('en-US');
  });

  it('keeps every regional code the picker offers', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      firstRunWith(code);
      expect(resolveInitialLanguage()).toBe(code);
    }
  });

  it('normalises the region the way i18next spells it', () => {
    // A browser is free to send 'en-us' or 'EN-us'; the resource bundle is
    // registered under 'en-US' and that is the only spelling that finds it.
    firstRunWith('en-us');
    expect(resolveInitialLanguage()).toBe('en-US');
    firstRunWith('EN-us');
    expect(resolveInitialLanguage()).toBe('en-US');
  });

  it('maps every English browser to en-US, because en-GB is not offered', () => {
    // en-GB and the day-first English regions only resolve to en-GB when the
    // picker offers it. It does not, so they all read in American English.
    for (const browser of ['en-GB', 'en-AU', 'en']) {
      firstRunWith(browser);
      expect(resolveInitialLanguage(), browser).toBe('en-US');
    }
  });

  it('falls back to Vietnamese for a region or language we do not offer', () => {
    // No vi-VN file and no de-CH, fr-CA or pt-BR file: the base is not offered
    // either, so the final fallback applies.
    for (const browser of ['vi-VN', 'de-CH', 'fr-CA', 'pt-BR']) {
      firstRunWith(browser);
      expect(resolveInitialLanguage(), browser).toBe('vi');
    }
  });

  it('falls back to Vietnamese for a language we do not ship at all', () => {
    firstRunWith('is-IS');
    expect(resolveInitialLanguage()).toBe('vi');
  });

  it('lets a stored choice beat the browser, region and all', () => {
    firstRunWith('vi-VN');
    window.localStorage.setItem('i18nextLng', 'en-US');
    expect(resolveInitialLanguage()).toBe('en-US');
  });

  it('ignores a stored choice the picker does not offer', () => {
    firstRunWith('en-US');
    window.localStorage.setItem('i18nextLng', 'de');
    expect(resolveInitialLanguage()).toBe('en-US');
  });
});

describe('detectCountry', () => {
  it('reads the region subtag when the browser sends one', () => {
    firstRunWith('pt-BR');
    expect(detectCountry()).toBe('br');
    firstRunWith('en-AU');
    expect(detectCountry()).toBe('au');
    firstRunWith('en-ZA');
    expect(detectCountry()).toBe('za');
  });

  it('reaches past a script subtag to the region behind it', () => {
    firstRunWith('zh-Hans-CN');
    expect(detectCountry()).toBe('cn');
  });

  it('falls back to the language country when the browser sends no region', () => {
    // The half that matters for the offered languages: a bare 'vi' carries no
    // region, so region-only detection would answer null. The language is passed
    // explicitly so the fallback half is deterministic.
    firstRunWith('vi');
    expect(detectCountry('vi')).toBe('vn');
    firstRunWith('en');
    expect(detectCountry('en-US')).toBe('us');
    // Bare English names no country on its own, and an unoffered language names
    // none either. Both answer null, which resolveCountryOffer treats as no offer.
    expect(detectCountry('en')).toBeNull();
    expect(detectCountry('de')).toBeNull();
    expect(detectCountry('en-GB')).toBeNull();
  });

  it('does not mistake a UN M49 region for a country code', () => {
    // en-419 is Latin America, not a country. Answering '41' or '419' would be
    // worse than answering the language's country.
    firstRunWith('en-419');
    expect(detectCountry('en-US')).toBe('us');
  });

  it('can name a country for every language we offer', () => {
    // The fallback half is only as good as the field it reads, and a new
    // language added without a country would make detectCountry answer null
    // for its readers without anything else going red.
    const missing = SUPPORTED_LANGUAGES.filter((l) => !l.country);
    expect(missing).toEqual([]);
  });
});
