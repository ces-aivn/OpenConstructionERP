// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A USD project whose language is English (US) printed
 * "2.593.679.470,20 US$" for a reader with a Vietnamese interface. With the
 * number format on automatic, the active project's language now decides how
 * its money is written; the reader's explicit choice still wins.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatCurrency } from '@/shared/lib/money';
import {
  getMarketNumberLocale,
  numberLocaleForProjectLanguage,
  setMarketNumberLocale,
} from '@/shared/lib/marketNumberLocale';
import { useProjectContextStore } from '../useProjectContextStore';
import { getNumberLocale, usePreferencesStore } from '../usePreferencesStore';

beforeEach(() => {
  localStorage.clear();
  useProjectContextStore.setState({ projectLocales: {} });
  useProjectContextStore.getState().clearProject();
  usePreferencesStore.setState({ numberLocale: 'auto' });
  setMarketNumberLocale(null);
});

afterEach(() => {
  useProjectContextStore.getState().clearProject();
  setMarketNumberLocale(null);
});

describe('money in the active project', () => {
  it('is written the US way in a US English project', () => {
    useProjectContextStore.getState().rememberProjectLocales([
      { id: 'penn', locale: 'en' },
      { id: 'landmark', locale: 'vi' },
    ]);
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    expect(getNumberLocale()).toBe('en-US');
    expect(formatCurrency('2593679470.20', 'USD', getNumberLocale())).toBe('$2,593,679,470.20');
  });

  it('is written the Vietnamese way in a Vietnamese project', () => {
    useProjectContextStore.getState().rememberProjectLocales([{ id: 'landmark', locale: 'vi' }]);
    useProjectContextStore.getState().setActiveProject('landmark', 'CS-VN01 Landmark 81');
    expect(getNumberLocale()).toBe('vi-VN');
  });

  it('follows a project whose language is learnt after it became active', () => {
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    expect(getMarketNumberLocale()).toBeNull();
    useProjectContextStore.getState().rememberProjectLocales([{ id: 'penn', locale: 'en' }]);
    expect(getMarketNumberLocale()).toBe('en-US');
  });

  it('falls back to the regional pack when no project is active', () => {
    setMarketNumberLocale('en-IN');
    useProjectContextStore.getState().rememberProjectLocales([{ id: 'penn', locale: 'en' }]);
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    expect(getMarketNumberLocale()).toBe('en-US');
    useProjectContextStore.getState().clearProject();
    expect(getMarketNumberLocale()).toBe('en-IN');
  });

  it('leaves an explicit number-format choice alone', () => {
    usePreferencesStore.setState({ numberLocale: 'de-DE' });
    useProjectContextStore.getState().rememberProjectLocales([{ id: 'penn', locale: 'en' }]);
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    expect(getNumberLocale()).toBe('de-DE');
  });

  it('survives a reload', () => {
    useProjectContextStore.getState().rememberProjectLocales([{ id: 'penn', locale: 'en' }]);
    expect(JSON.parse(localStorage.getItem('oe_project_locales') ?? '{}')).toEqual({ penn: 'en' });
  });
});

describe('the number locale of a project language', () => {
  it('maps the short codes the project form stores', () => {
    expect(numberLocaleForProjectLanguage('en')).toBe('en-US');
    expect(numberLocaleForProjectLanguage('vi')).toBe('vi-VN');
    expect(numberLocaleForProjectLanguage('de-AT')).toBe('de-AT');
  });

  it('is null for a blank or malformed language', () => {
    expect(numberLocaleForProjectLanguage('')).toBeNull();
    expect(numberLocaleForProjectLanguage(null)).toBeNull();
    expect(numberLocaleForProjectLanguage('not a tag!')).toBeNull();
  });
});
