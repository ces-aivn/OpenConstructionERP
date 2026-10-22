// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * What a new project is seeded with, and what picking a market suggests.
 *
 * The build serves two markets. Choosing the United States used to leave the
 * currency on VND and the standard blank, so a US project was easily created
 * in dong; choosing Vietnam left the language on English (US) for a reader
 * whose whole interface is Vietnamese. A market now suggests its currency,
 * classification standard and project language. A suggestion never overwrites
 * a value the user picked themselves.
 */
import { PROJECT_LANGUAGES } from './projectLanguages';

export interface MarketPreset {
  currency: string;
  classificationStandard: string;
  /** Project language code as `PROJECT_LANGUAGES` spells it (`en` is US English). */
  locale: string;
}

/** Keyed by the region picker's option values. */
export const MARKET_PRESETS: Readonly<Record<string, MarketPreset>> = {
  Vietnam: { currency: 'VND', classificationStandard: 'vn_tt12', locale: 'vi' },
  US: { currency: 'USD', classificationStandard: 'masterformat', locale: 'en' },
};

export function marketPreset(region: string | null | undefined): MarketPreset | null {
  if (!region) return null;
  return MARKET_PRESETS[region] ?? null;
}

/**
 * The project language that matches the interface language, so a Vietnamese
 * reader's new project is in Vietnamese and a US reader's in US English.
 * Falls back to `en` when the interface language is not a project language.
 */
export function projectLanguageForUi(uiLanguage: string | null | undefined): string {
  const lang = (uiLanguage ?? '').trim();
  if (!lang) return 'en';
  const offered = new Set(PROJECT_LANGUAGES.map((l) => l.value));
  if (offered.has(lang)) return lang;
  const base = lang.split('-')[0]!.toLowerCase();
  if (base === 'en') return 'en';
  return offered.has(base) ? base : 'en';
}

/** The fields a market suggests, and whether the user has set each by hand. */
export interface SuggestableFields {
  currency: string;
  classification_standard: string;
  locale: string;
}

export type TouchedFields = Partial<Record<keyof SuggestableFields, boolean>>;

/**
 * Apply a market's suggestions to the fields the user has not chosen.
 * Returns the fields unchanged when the region names no known market.
 */
export function applyMarketPreset(
  region: string | null | undefined,
  current: SuggestableFields,
  touched: TouchedFields,
): SuggestableFields {
  const preset = marketPreset(region);
  if (!preset) return current;
  return {
    currency: touched.currency ? current.currency : preset.currency,
    classification_standard: touched.classification_standard
      ? current.classification_standard
      : preset.classificationStandard,
    locale: touched.locale ? current.locale : preset.locale,
  };
}

/** Role options of the guided setup, US delivery roles included. */
export const PROJECT_ROLES = [
  'client_owner',
  'owners_rep',
  'general_contractor',
  'construction_manager_at_risk',
  'ipd_partner',
  'designer_architect',
  'bim_consultant',
  'bim_manager',
  'cost_engineer',
  'subcontractor',
  'developer',
] as const;

/** English fallbacks for `project_wizard.role_opt.*`, spelt and capitalised properly. */
export const ROLE_OPT_LABELS: Readonly<Record<string, string>> = {
  client_owner: 'Client / Owner',
  owners_rep: "Owner's Representative",
  general_contractor: 'General Contractor',
  construction_manager_at_risk: 'Construction Manager (CM at-risk)',
  ipd_partner: 'IPD Partner',
  designer_architect: 'Designer / Architect',
  bim_consultant: 'BIM Consultant',
  bim_manager: 'BIM Manager',
  cost_engineer: 'Cost Engineer',
  subcontractor: 'Subcontractor',
  developer: 'Developer',
};

export const PROJECT_SIZES = ['small', 'medium', 'large', 'enterprise'] as const;

/** English fallbacks for `project_wizard.size_opt.*`. */
export const SIZE_OPT_LABELS: Readonly<Record<string, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  enterprise: 'Enterprise',
};

/**
 * i18n keys for the picker options that are words rather than names, so
 * "International / Multi-region" and "Custom..." are read in the reader's
 * language. Options absent here are proper names or codes and stay as written.
 */
export const OPTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  INTL: 'projects.region_opt.intl',
  __custom__: 'projects.option_custom',
};

/**
 * i18n keys for the classification standards, whose labels name a country
 * beside the standard ("(Vietnam)") that a Vietnamese reader should read in
 * Vietnamese. The English text stays the default.
 */
export function standardOptionKey(value: string): string {
  return `projects.standard_opt.${value}`;
}
