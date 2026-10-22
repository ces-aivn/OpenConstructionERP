// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
// OpenConstructionERP — DataDrivenConstruction (DDC)
// Tests for normalizePackLocale: maps a partner pack's BCP-47 default_locale to
// the UI language it forces. The build offers Vietnamese (vi) and US English
// (en-US) only. A tag that resolves to neither answers the sentinel 'en', which
// usePartnerPackLocale reads as "nothing to force", so a pack can never switch
// the app into a language it does not offer.
import { describe, expect, it } from 'vitest';

import { normalizePackLocale } from '../i18n';

describe('normalizePackLocale', () => {
  it('strips the region subtag when the UI ships the base language', () => {
    expect(normalizePackLocale('vi-VN')).toBe('vi');
  });

  it('answers the sentinel for a language the UI does not offer', () => {
    // batimatech-ca declares fr-CA. No French interface ships, so the pack
    // forces nothing and the reader keeps the language they chose.
    expect(normalizePackLocale('fr-CA')).toBe('en');
    expect(normalizePackLocale('de')).toBe('en');
    expect(normalizePackLocale('es-MX')).toBe('en');
    expect(normalizePackLocale('pt-BR')).toBe('en'); // brazil-sinapi
  });

  it('answers US English for every English tag, because en-US is the only English offered', () => {
    // Before this build the day-first regions answered en-GB. en-GB is no
    // longer offered, so an Australian, Irish or UK pack is handed the US
    // English entry. That is the scope decision, and it is pinned here so a
    // change to it is deliberate.
    expect(normalizePackLocale('en-AU')).toBe('en-US'); // aus
    expect(normalizePackLocale('en-NZ')).toBe('en-US'); // nzs
    expect(normalizePackLocale('en-IE')).toBe('en-US'); // ireland-ie
    expect(normalizePackLocale('en-IN')).toBe('en-US'); // india-cpwd
    expect(normalizePackLocale('en-GB')).toBe('en-US'); // uk-jct, commercial-london
    expect(normalizePackLocale('en-CA')).toBe('en-US'); // canada-ca
  });

  it('keeps the region when the UI ships it, because the pack asked for it', () => {
    // A pack that names a region has named it deliberately. Stripping en-US left
    // commercial-denver asking for American English and being handed the British
    // strings, which is the one thing the locale exists to prevent.
    expect(normalizePackLocale('en-US')).toBe('en-US'); // commercial-denver, us-costdata
  });

  it('passes through base codes the UI ships', () => {
    expect(normalizePackLocale('vi')).toBe('vi');
    expect(normalizePackLocale('en')).toBe('en-US'); // modular-prefab
  });

  it('is case-insensitive and trims', () => {
    expect(normalizePackLocale('VI-vn')).toBe('vi');
    expect(normalizePackLocale(' vi ')).toBe('vi');
    // A manifest is free to write the region in any case; i18next writes it in
    // one, and that is the one the resource bundle is registered under.
    expect(normalizePackLocale('en-us')).toBe('en-US');
    expect(normalizePackLocale('EN-US')).toBe('en-US');
    expect(normalizePackLocale(' en-Us ')).toBe('en-US');
  });

  it('falls back to the sentinel for unsupported or empty locales', () => {
    expect(normalizePackLocale('xx-YY')).toBe('en');
    expect(normalizePackLocale('')).toBe('en');
    expect(normalizePackLocale(null)).toBe('en');
    expect(normalizePackLocale(undefined)).toBe('en');
  });
});
