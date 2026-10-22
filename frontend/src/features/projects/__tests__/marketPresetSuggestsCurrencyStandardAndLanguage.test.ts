// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import {
  PROJECT_ROLES,
  ROLE_OPT_LABELS,
  applyMarketPreset,
  marketPreset,
  projectLanguageForUi,
} from '../projectCreateDefaults';

const blank = { currency: 'VND', classification_standard: '', locale: 'en' };

describe('picking a market for a new project', () => {
  it('suggests dollars, MasterFormat and US English for the United States', () => {
    expect(applyMarketPreset('US', blank, {})).toEqual({
      currency: 'USD',
      classification_standard: 'masterformat',
      locale: 'en',
    });
  });

  it('suggests dong, the TT 12/2021 codes and Vietnamese for Vietnam', () => {
    expect(applyMarketPreset('Vietnam', { ...blank, currency: 'USD' }, {})).toEqual({
      currency: 'VND',
      classification_standard: 'vn_tt12',
      locale: 'vi',
    });
  });

  it('never overwrites a field the user picked by hand', () => {
    const picked = { currency: 'EUR', classification_standard: 'din276', locale: 'de' };
    expect(applyMarketPreset('US', picked, { currency: true, locale: true })).toEqual({
      currency: 'EUR',
      classification_standard: 'masterformat',
      locale: 'de',
    });
  });

  it('leaves the fields alone for a region that names no known market', () => {
    expect(applyMarketPreset('DACH', blank, {})).toBe(blank);
    expect(applyMarketPreset('', blank, {})).toBe(blank);
    expect(marketPreset(null)).toBeNull();
  });
});

describe('the language a new project starts in', () => {
  it('follows the interface language', () => {
    expect(projectLanguageForUi('vi')).toBe('vi');
    expect(projectLanguageForUi('en-US')).toBe('en');
  });

  it('falls back to US English when the interface language is not offered', () => {
    expect(projectLanguageForUi('')).toBe('en');
    expect(projectLanguageForUi(undefined)).toBe('en');
    expect(projectLanguageForUi('xx-YY')).toBe('en');
  });
});

describe('the role options', () => {
  it('include the US delivery roles, each with a properly written label', () => {
    for (const role of ['owners_rep', 'construction_manager_at_risk', 'ipd_partner']) {
      expect(PROJECT_ROLES).toContain(role);
    }
    for (const role of PROJECT_ROLES) {
      expect(ROLE_OPT_LABELS[role], role).toBeTruthy();
    }
    expect(ROLE_OPT_LABELS.bim_consultant).toBe('BIM Consultant');
    expect(ROLE_OPT_LABELS.designer_architect).toBe('Designer / Architect');
  });
});
