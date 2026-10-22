// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The partner-pack vocabulary overlay.
 *
 * Two things here are easy to get wrong and invisible on screen when you do.
 *
 * The first is which code goes on the wire. A pack's locale file is a key of
 * ``additional_locales`` (``vi-VN``), while the language it is merged into is
 * the normalized one (``vi``). Fetching with the normalized code 404s, so the
 * assertions below check the request path, not just the resulting strings.
 *
 * The second is the clobber. ``loadLocaleResource`` merges a lazily fetched
 * locale chunk with ``overwrite=true``, so a chunk that lands after the overlay
 * silently erases the pack's words. That is reproduced literally: the test
 * writes a bundle the way ``loadLocaleResource`` writes one, and then asserts
 * the pack's words are still there.
 *
 * This build offers vi and en-US. Pack locales that normalize to either of them
 * are exercised here (``vi-VN`` -> vi, ``en-CA``/``en-NZ``/``en-AU``/``en-GB``
 * -> en-US). A pack locale that normalizes to nothing offered falls to ``en``,
 * which is not a UI language, so it never reaches a bundle.
 *
 * The real ``@/app/i18n`` singleton is used deliberately - ``normalizePackLocale``
 * and ``SUPPORTED_LANGUAGES`` are exactly what decides ``vi-VN`` -> ``vi``, and a
 * hand-written stand-in would assert the stand-in. Only the network is faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the network is faked. Everything else in the api module stays real —
// `@/app/i18n` pulls the module registry in behind it, and a half-populated
// stub would break imports that have nothing to do with this test.
vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()),
  apiGet: vi.fn(),
}));

import i18n from '@/app/i18n';
import { apiGet } from '@/shared/lib/api';

import {
  __resetPackVocabularyForTests,
  packVocabularyFrom,
  resolvePackVocabularyCode,
  revertPackVocabulary,
  syncPackVocabulary,
} from './partnerPackVocabulary';
import type { PartnerPackManifest } from './usePartnerPack';

const mockedApiGet = vi.mocked(apiGet);

function manifest(overrides: Partial<PartnerPackManifest> = {}): PartnerPackManifest {
  return {
    slug: 'batimatech-vn',
    partner_name: 'Test Partner',
    partner_url: null,
    pack_version: '1.0.0',
    description: '',
    default_locale: 'vi-VN',
    additional_locales: ['en-CA', 'vi-VN'],
    cwicr_regions: [],
    default_currency: 'VND',
    default_tax_template: null,
    validation_rule_packs: [],
    validation_rule_sets: [],
    default_modules: [],
    hidden_modules: [],
    branding: {
      primary_color: '#000000',
      accent_color: null,
      has_logo: false,
      has_favicon: false,
      powered_by_text: '',
    },
    has_onboarding_script: false,
    metadata: {},
    ...overrides,
  };
}

/** Write a bundle exactly the way ``loadLocaleResource`` writes a locale chunk. */
function writeLocaleChunk(language: string, entries: Record<string, string>): void {
  i18n.addResourceBundle(language, 'translation', entries, false, true);
}

function bundleValue(language: string, key: string): string | undefined {
  const stored = i18n.store.data[language];
  const bundle = stored === undefined ? undefined : stored.translation;
  if (bundle === undefined || typeof bundle !== 'object') return undefined;
  return (bundle as Record<string, string>)[key];
}

/**
 * Languages this file seeds, torn down so no test inherits another's store.
 * Only ``vi`` is seeded wholesale: the en-US bundle is the real overlay file and
 * is left in place, because every overlay here is reverted by the test itself.
 */
const SEEDED = ['vi'];

beforeEach(() => {
  mockedApiGet.mockReset();
});

afterEach(() => {
  __resetPackVocabularyForTests();
  // Not ``removeResourceBundle``: that also drops 'translation' from the
  // instance's namespace list, which would take the rest of the file with it.
  for (const language of SEEDED) {
    const stored = i18n.store.data[language];
    if (stored !== undefined) delete stored.translation;
  }
});

describe('packVocabularyFrom', () => {
  it('reads the {_meta, translation} envelope most packs ship', () => {
    expect(
      packVocabularyFrom({
        _meta: { locale: 'vi-VN', fallback: 'en' },
        translation: { 'nav.boq': 'Bảng khối lượng' },
      }),
    ).toEqual({ 'nav.boq': 'Bảng khối lượng' });
  });

  it('reads a flat file that keeps its metadata under _meta', () => {
    expect(
      packVocabularyFrom({
        _meta: { locale: 'vi' },
        'gaeb.title': 'Trao đổi GAEB',
      }),
    ).toEqual({ 'gaeb.title': 'Trao đổi GAEB' });
  });

  it('reads a flat file that keeps its metadata under $-prefixed fields', () => {
    expect(
      packVocabularyFrom({
        $schema_note: 'x',
        $locale: 'vi',
        'common.formwork': 'Ván khuôn',
      }),
    ).toEqual({ 'common.formwork': 'Ván khuôn' });
  });

  it('drops non-string values rather than passing them to i18next', () => {
    expect(packVocabularyFrom({ translation: { a: 'ok', b: { c: 'nested' }, d: 3 } })).toEqual({
      a: 'ok',
    });
  });

  it('answers an empty map for anything that is not an object', () => {
    expect(packVocabularyFrom(null)).toEqual({});
    expect(packVocabularyFrom('not json')).toEqual({});
    expect(packVocabularyFrom(undefined)).toEqual({});
  });
});

describe('resolvePackVocabularyCode', () => {
  it('finds the regional file for the base language it normalizes to', () => {
    // vi-VN is not in SUPPORTED_LANGUAGES, so the UI language is vi — and the pack
    // file that belongs to that language is still called vi-VN.
    expect(resolvePackVocabularyCode(['en-CA', 'vi-VN'], 'vi-VN', 'vi')).toBe('vi-VN');
    expect(resolvePackVocabularyCode(['en-CA'], 'en-CA', 'en-US')).toBe('en-CA');
    // en-NZ and en-AU write the day first, but en-GB is not offered, so every
    // English region normalizes to en-US and its file follows that reader.
    expect(resolvePackVocabularyCode(['en-NZ'], 'en-NZ', 'en-US')).toBe('en-NZ');
    expect(resolvePackVocabularyCode(['en-AU'], 'en-AU', 'en-US')).toBe('en-AU');
    expect(resolvePackVocabularyCode(['en-NZ'], 'en-NZ', 'vi')).toBeNull();
  });

  it('serves a pack’s English file to the English reader, not to the Vietnamese one', () => {
    // A British pack normalizes to en-US, so its file reaches the English reader
    // only. Folding it onto vi would be the defect this guards against.
    expect(resolvePackVocabularyCode(['en-GB'], 'en-GB', 'en-US')).toBe('en-GB');
    expect(resolvePackVocabularyCode(['en-GB'], 'en-GB', 'vi')).toBeNull();
  });

  it('serves the pack’s second file when the user picks that language', () => {
    // batimatech-vn ships en-CA as well, and a pack whose default is English still
    // ships a Vietnamese file. Both are unreachable if the overlay is bound to the
    // activation-time language instead of the current one.
    expect(resolvePackVocabularyCode(['en-CA', 'vi-VN'], 'vi-VN', 'en-US')).toBe('en-CA');
    expect(resolvePackVocabularyCode(['vi-VN'], 'en-US', 'vi')).toBe('vi-VN');
  });

  it('leaves a plain base-language pack exactly as it resolves today', () => {
    // Packs that declare `vi` with no region at all. The inheritance that already
    // works must keep working.
    expect(resolvePackVocabularyCode(['vi'], 'vi', 'vi')).toBe('vi');
    expect(resolvePackVocabularyCode(['vi'], 'vi', 'en-US')).toBeNull();
  });

  it('answers null when the pack ships nothing for this language', () => {
    expect(resolvePackVocabularyCode([], 'en-US', 'en-US')).toBeNull();
    expect(resolvePackVocabularyCode(['en-GB'], 'en-GB', 'vi')).toBeNull();
  });

  it('prefers an exact code, then the pack default, over sort order', () => {
    // Exact match wins even when the pack default points elsewhere.
    expect(resolvePackVocabularyCode(['en-CA', 'en-US'], 'en-CA', 'en-US')).toBe('en-US');
    // With no exact code, the pack default wins over the alphabetical first entry.
    expect(resolvePackVocabularyCode(['en-CA', 'en-GB'], 'en-GB', 'en-US')).toBe('en-GB');
    // Two English regions collapse to en-US; the default breaks the tie.
    expect(resolvePackVocabularyCode(['en-AU', 'en-NZ'], 'en-NZ', 'en-US')).toBe('en-NZ');
  });
});

describe('syncPackVocabulary', () => {
  it('fetches the pack’s own locale code, not the language it merges into', async () => {
    mockedApiGet.mockResolvedValue({ translation: { 'nav.boq': 'Bảng khối lượng' } });
    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng' });

    await syncPackVocabulary(manifest(), 'vi');

    expect(mockedApiGet).toHaveBeenCalledTimes(1);
    expect(mockedApiGet).toHaveBeenCalledWith('/v1/partner-pack/locale/vi-VN');
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');
  });

  it('issues no request for a pack that ships no locale file', async () => {
    await syncPackVocabulary(manifest({ additional_locales: [], default_locale: 'en-US' }), 'en-US');
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it('issues no request when nothing the pack ships matches the language', async () => {
    await syncPackVocabulary(manifest({ additional_locales: ['de'], default_locale: 'de' }), 'vi');
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it('leaves the base locale intact when the declared file is missing', async () => {
    // A pack can declare a locale file it does not ship. That 404 must not reach
    // the reader: the base strings stay exactly as they were.
    mockedApiGet.mockRejectedValue(new Error('404 Not Found'));
    writeLocaleChunk('vi', { 'gaeb.title': 'Trao đổi GAEB XML 3.3' });

    await expect(
      syncPackVocabulary(
        manifest({ slug: 'missing-file', additional_locales: ['vi-VN'], default_locale: 'vi-VN' }),
        'vi',
      ),
    ).resolves.toBeUndefined();

    expect(bundleValue('vi', 'gaeb.title')).toBe('Trao đổi GAEB XML 3.3');
  });

  it('survives a locale chunk that lands on top of it afterwards', async () => {
    mockedApiGet.mockResolvedValue({ translation: { 'nav.boq': 'Bảng khối lượng' } });
    await syncPackVocabulary(manifest(), 'vi');
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');

    // The lazy vi chunk resolves now, overwrite=true, straight over our keys.
    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng', 'nav.costs': 'Cơ sở dữ liệu chi phí' });

    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');
    expect(bundleValue('vi', 'nav.costs')).toBe('Cơ sở dữ liệu chi phí');
  });

  it('changes what t() answers, not merely what the store holds', async () => {
    // The store assertions above prove the bundle was written. This one walks the
    // resolution path a component actually uses: `useTranslation().t` delegates
    // straight to `i18n.t`. `nav.coordination_hub` is the sidebar entry for
    // /coordination (navCatalog.ts), so this is a pack's reading of a string an
    // English user has in front of them.
    //
    // canada-ca, because en-CA normalizes to en-US, the English the app is running
    // in here.
    expect(i18n.t('nav.coordination_hub')).toBe('Coordination Hub');

    mockedApiGet.mockResolvedValue({
      translation: { 'nav.coordination_hub': 'Coordination Centre' },
    });
    await syncPackVocabulary(
      manifest({ slug: 'canada-ca', additional_locales: ['en-CA'], default_locale: 'en-CA' }),
      'en-US',
    );

    expect(i18n.t('nav.coordination_hub')).toBe('Coordination Centre');

    revertPackVocabulary();
    expect(i18n.t('nav.coordination_hub')).toBe('Coordination Hub');
  });

  it('does not re-fetch a locale it has already applied', async () => {
    mockedApiGet.mockResolvedValue({ translation: { 'nav.boq': 'Bảng khối lượng' } });
    await syncPackVocabulary(manifest(), 'vi');
    await syncPackVocabulary(manifest(), 'vi');
    expect(mockedApiGet).toHaveBeenCalledTimes(1);
  });
});

describe('revertPackVocabulary', () => {
  it('restores the string the pack displaced', async () => {
    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng' });
    mockedApiGet.mockResolvedValue({ translation: { 'nav.boq': 'Bảng khối lượng' } });

    await syncPackVocabulary(manifest(), 'vi');
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');

    revertPackVocabulary();
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng tính khối lượng');
  });

  it('deletes a key the pack introduced rather than leaving it behind', async () => {
    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng' });
    mockedApiGet.mockResolvedValue({
      translation: { 'partner_pack.header_chip': 'Phiên bản đối tác' },
    });

    await syncPackVocabulary(manifest(), 'vi');
    expect(bundleValue('vi', 'partner_pack.header_chip')).toBe('Phiên bản đối tác');

    revertPackVocabulary();
    expect(bundleValue('vi', 'partner_pack.header_chip')).toBeUndefined();
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng tính khối lượng');
  });

  it('restores the pre-chunk value, not its own words, after a clobber round-trip', async () => {
    // The snapshot must survive the re-merge that follows a late chunk, or
    // deactivation writes the pack's own strings back as if they were the
    // originals.
    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng' });
    mockedApiGet.mockResolvedValue({ translation: { 'nav.boq': 'Bảng khối lượng' } });
    await syncPackVocabulary(manifest(), 'vi');

    writeLocaleChunk('vi', { 'nav.boq': 'Bảng tính khối lượng' });
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');

    revertPackVocabulary();
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng tính khối lượng');
  });

  it('undoes an overlay that was merged into English', async () => {
    // canada-ca normalizes to en-US, and the English overlay merges into the en-US
    // bundle. Reverting must put back what that bundle held, even though the
    // English strings themselves come from the fallback `en` bundle.
    const before = bundleValue('en-US', 'nav.coordination_hub');
    mockedApiGet.mockResolvedValue({
      translation: { 'nav.coordination_hub': 'Coordination Centre' },
    });

    await syncPackVocabulary(
      manifest({ slug: 'canada-ca', additional_locales: ['en-CA'], default_locale: 'en-CA' }),
      'en-US',
    );
    expect(bundleValue('en-US', 'nav.coordination_hub')).toBe('Coordination Centre');

    revertPackVocabulary();
    expect(bundleValue('en-US', 'nav.coordination_hub')).toBe(before);
  });
});

describe('switching from one pack to another', () => {
  // nzs and aus both normalize to `en-US`, so their overlays land on the same
  // bundle. nzs renames the subcontractor screen and aus does not, which is
  // exactly the shape that leaks: applying a pack does not reload the app, so
  // the outgoing pack's words are still live when the next one arrives.
  const nzs = manifest({ slug: 'nzs', additional_locales: ['en-NZ'], default_locale: 'en-NZ' });
  const aus = manifest({ slug: 'aus', additional_locales: ['en-AU'], default_locale: 'en-AU' });

  it('takes the outgoing pack’s words off screen instead of merging on top', async () => {
    const beforeHub = bundleValue('en-US', 'nav.coordination_hub');
    const beforeSubs = bundleValue('en-US', 'nav.subcontractors');

    mockedApiGet.mockResolvedValueOnce({
      translation: {
        'nav.coordination_hub': 'Coordination Centre',
        'nav.subcontractors': 'Subcontractors',
      },
    });
    await syncPackVocabulary(nzs, 'en-US');
    expect(bundleValue('en-US', 'nav.subcontractors')).toBe('Subcontractors');

    // The Australian pack says nothing about subcontractors, so that key has to
    // go back to the app's own English rather than keep the New Zealand wording.
    mockedApiGet.mockResolvedValueOnce({
      translation: { 'nav.coordination_hub': 'Coordination Centre' },
    });
    await syncPackVocabulary(aus, 'en-US');

    expect(bundleValue('en-US', 'nav.subcontractors')).toBe(beforeSubs);
    expect(bundleValue('en-US', 'nav.coordination_hub')).toBe('Coordination Centre');

    revertPackVocabulary();
    expect(bundleValue('en-US', 'nav.coordination_hub')).toBe(beforeHub);
    expect(bundleValue('en-US', 'nav.subcontractors')).toBe(beforeSubs);
  });

  it('clears the outgoing pack even when the incoming one ships nothing for this language', async () => {
    // The hole the same-language case cannot reach. The Vietnamese pack is active
    // with Vietnamese vocabulary on screen; the user applies nzs, which ships only
    // en-NZ. That resolves to no file for `vi`, so nothing would merge and an early
    // return would leave the outgoing pack's words under the incoming one.
    const before = bundleValue('vi', 'nav.boq');
    mockedApiGet.mockResolvedValueOnce({
      translation: { 'nav.boq': 'Bảng khối lượng' },
    });
    await syncPackVocabulary(manifest(), 'vi');
    expect(bundleValue('vi', 'nav.boq')).toBe('Bảng khối lượng');

    await syncPackVocabulary(nzs, 'vi');
    expect(bundleValue('vi', 'nav.boq')).toBe(before);
  });

  it('reverts to the original wording after a swap, not to the first pack’s', async () => {
    const before = bundleValue('en-US', 'nav.phase_estimation');

    mockedApiGet.mockResolvedValueOnce({ translation: { 'nav.phase_estimation': 'Estimating' } });
    await syncPackVocabulary(nzs, 'en-US');
    mockedApiGet.mockResolvedValueOnce({ translation: { 'nav.phase_estimation': 'Pricing' } });
    await syncPackVocabulary(aus, 'en-US');
    expect(bundleValue('en-US', 'nav.phase_estimation')).toBe('Pricing');

    revertPackVocabulary();
    expect(bundleValue('en-US', 'nav.phase_estimation')).toBe(before);
  });
});
