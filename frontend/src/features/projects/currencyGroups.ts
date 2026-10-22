// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Shared currency catalogue — single source of truth for the project
 * currency picker, used by both ``CreateProjectPage`` (modal/page) and
 * ``ProjectDetailPage`` (inline edit form).
 *
 * Extracting this here means a) we don't duplicate the 80-entry list,
 * and b) the edit form on the detail page can pick from the same set
 * instead of accepting free text — which previously let a user save
 * a stub like ``"Eu"`` and break ``Intl.NumberFormat``.
 *
 * Also exports ``COUNTRY_DEFAULTS`` — a tiny country-code → region +
 * currency lookup the create dialog uses to auto-fill sensible defaults
 * after a successful geocode (only fires if the user hasn't picked yet).
 */

export interface OptionGroup {
  group: string;
  options: { value: string; label: string }[];
}

// ── Currencies (all major construction-market currencies) ─────────────────
//
// Kept verbatim to match the previous in-file constant; visual layout in
// both forms relies on the exact label format ``CODE (symbol) — Name``.
// VND and USD only in the VN/US build; "Custom..." still accepts any ISO code.
export const CURRENCY_GROUPS: OptionGroup[] = [
  {
    group: 'Currencies',
    options: [
      { value: 'VND', label: 'VND (₫) - Vietnamese Dong' },
      { value: 'USD', label: 'USD ($) - US Dollar' },
    ],
  },
  {
    group: 'Other',
    options: [{ value: '__custom__', label: 'Custom...' }],
  },
];

/** Sentinel select value that reveals the free-text "type your own code"
 *  input. Kept identical to the literal used across the project forms and
 *  ``CountryCombobox`` so the grouped picker can reuse the same option. */
export const CUSTOM_CURRENCY_SENTINEL = '__custom__';

/** Set of every selectable currency code (excluding `__custom__`) — used
 *  by the detail-page edit form to validate a project's stored currency
 *  against the catalogue before rendering it as the select's value. */
export const CURRENCY_CODES: ReadonlySet<string> = new Set(
  CURRENCY_GROUPS.flatMap((g) => g.options.map((o) => o.value)).filter(
    (v) => v !== CUSTOM_CURRENCY_SENTINEL,
  ),
);

/**
 * Normalize a free-text currency code the same way the money formatter does
 * before it renders a symbol: trim, drop inner whitespace, upper-case. This
 * does NOT hard-reject input - it returns the cleaned string so the caller
 * can store a non-ISO code (the backend ``currency`` column is a free-form
 * ``str`` and ``formatCurrency`` already degrades unknown codes gracefully).
 *
 * Use {@link isValidCurrencyCode} to decide whether to show a soft hint.
 */
export function normalizeCurrencyCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** Whether a (normalized or raw) code matches the ISO-4217 shape the
 *  ``Intl.NumberFormat`` currency style understands (3 ascii letters).
 *  Mirrors ``CURRENCY_CODE_RE`` in ``shared/lib/money.ts``. */
export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrencyCode(code));
}

// ── Country → (region, currency) defaults ────────────────────────────────
//
// Tiny lookup table — covers the existing project mix plus the most common
// markets the user is likely to type into the address field. The values
// must match an option ``value`` in REGION_GROUPS / CURRENCY_GROUPS or the
// auto-fill silently no-ops on submit. Country codes are ISO 3166-1 alpha-2
// as returned by Nominatim's ``address.country_code`` (lowercase).
export interface CountryDefault {
  region: string;
  currency: string;
}

export const COUNTRY_DEFAULTS: Readonly<Record<string, CountryDefault>> = {
  // Only the countries the build offers a region and currency for. Every other
  // country has no option to point at, so it gets no default rather than one
  // that fills nothing.
  vn: { region: 'Vietnam', currency: 'VND' },
  us: { region: 'US', currency: 'USD' },
};

export function lookupCountryDefault(
  countryCode?: string | null,
): CountryDefault | null {
  if (!countryCode) return null;
  return COUNTRY_DEFAULTS[countryCode.toLowerCase()] ?? null;
}
