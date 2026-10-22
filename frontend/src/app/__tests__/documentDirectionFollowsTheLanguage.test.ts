// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Writing direction has to follow the active language, and it has to do it at
// three separate moments that fail independently: on <html> at all, from the
// language the reader actually picked, and again when they pick another one at
// runtime. A right-to-left language left in `dir="ltr"` puts the sidebar on the
// wrong edge and every label against the wrong margin while the strings are
// perfectly translated, so the product reads as broken rather than untranslated.
//
// This build offers vi and en-US, and neither is right-to-left. The RTL branch
// of `resolveDirection` therefore has no offered language to exercise. When a
// right-to-left language is offered again, its entry must carry `dir: 'rtl'`
// and the population assertions below will pick it up.
//
// Run:  npx vitest run src/app/__tests__/documentDirectionFollowsTheLanguage.test.ts

import { describe, expect, it, afterAll } from 'vitest';

import i18n, {
  SUPPORTED_LANGUAGES,
  applyDocumentDirection,
  resolveDirection,
} from '../i18n';

/** Languages we offer that declare right-to-left, read off the shipped list. */
const RTL = SUPPORTED_LANGUAGES.filter((l) => 'dir' in l && l.dir === 'rtl').map((l) => l.code);
const LTR = SUPPORTED_LANGUAGES.filter((l) => !('dir' in l && l.dir === 'rtl')).map((l) => l.code);

describe('document direction follows the active language', () => {
  afterAll(async () => {
    // Leave the shared jsdom document and the shared i18next instance the way
    // this file found them, so a test that runs after this one in the same
    // worker does not inherit a stale direction.
    await i18n.changeLanguage('en-US');
  });

  it('offers no right-to-left language in this build, and says so', () => {
    expect(
      `${RTL.length} of ${SUPPORTED_LANGUAGES.length} offered languages are RTL: ${RTL.join(', ')}`,
    ).toBe('0 of 2 offered languages are RTL: ');
  });

  it('resolves ltr for every offered language, so the flip is not indiscriminate', () => {
    // The check that would catch `resolveDirection` answering 'rtl' by accident.
    const wrong = LTR.filter((code) => resolveDirection(code) !== 'ltr');
    expect({ checked: LTR.length, wrong }).toEqual({ checked: SUPPORTED_LANGUAGES.length, wrong: [] });
  });

  it('writes dir and lang onto <html> for each offered language', () => {
    for (const code of LTR) {
      applyDocumentDirection(code);
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe(code);
    }
  });

  it('returns the document to ltr after it was right-to-left', () => {
    // Set rtl directly, then apply an offered language: the reset must happen.
    document.documentElement.dir = 'rtl';
    applyDocumentDirection('vi');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('vi');
  });

  it('updates the document when the language changes at runtime', async () => {
    // This drives the real i18next instance so the production `languageChanged`
    // handler in i18n.ts is what does the work. The direction is pre-set to rtl
    // so a handler that does nothing would leave it visibly wrong.
    for (const code of LTR) {
      document.documentElement.dir = 'rtl';
      await i18n.changeLanguage(code);
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe(code);
    }
  });
});
