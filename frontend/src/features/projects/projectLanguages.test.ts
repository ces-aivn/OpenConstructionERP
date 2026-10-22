// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// A language a person can pick for the interface must also be one they can pick
// for a project. Ukrainian was the case that was reported: offered in the
// header, missing from the project form, so the project went out as "other".

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { PROJECT_LANGUAGES } from './projectLanguages';

const BACKEND_LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../../../../backend/locales');

describe('project languages', () => {
  it('offers exactly the Vietnamese and US English interface languages', () => {
    expect(PROJECT_LANGUAGES.map((l) => l.value)).toEqual(['vi', 'en']);
  });

  it('leaves the regional variants out', () => {
    expect(PROJECT_LANGUAGES.some((l) => l.value.includes('-'))).toBe(false);
  });

  it('offers only languages the backend has a locale file for', () => {
    const files = new Set(readdirSync(BACKEND_LOCALES).map((f) => f.replace(/\.json$/, '')));
    const missing = PROJECT_LANGUAGES.map((l) => l.value).filter((c) => !files.has(c));
    expect(missing).toEqual([]);
  });

  it('offers English to a reader whose interface is US English', () => {
    // A US business sets its interface to en-US and expects the same language
    // for its projects. The base-code filter above drops every tag with a
    // hyphen, so en-US has no project option unless it is mapped to the `en`
    // locale the backend ships.
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === 'en-US')).toBe(true);
    expect(PROJECT_LANGUAGES.map((l) => l.value)).toContain('en');
  });
});
