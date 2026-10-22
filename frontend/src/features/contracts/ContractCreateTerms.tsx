// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The parts of the new-contract form that depend on the contract's type and
// template: the figures a cost-plus, GMP, T&M or unit-price contract cannot
// be created without, the commercial terms a template carries (advance,
// performance security, warranty), the firm on the other side, and the
// per-field reading of the server's refusal.
//
// The server is the source of truth for which terms a type requires
// (`contracts.service._REQUIRED_TERM_FIELDS`); the list below mirrors it so
// the form can ask for the figures before the round trip, and the server's
// coded refusal marks the same fields when the two ever disagree.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '@/shared/lib/api';
import { useNameCollator } from '@/shared/lib/collator';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { listSubcontractors } from '@/features/subcontractors/api';
import type { ClauseTemplate, ContractType, CounterpartyType } from './api';

/** A term a new contract can state, keyed as it is stored under `terms`. */
export type ContractTermKey =
  | 'fee_percent'
  | 'max_fee'
  | 'target_cost'
  | 'gmp_cap'
  | 'gainshare_split_pct'
  | 'tm_nte_cap'
  | 'price_basis'
  | 'advance_payment_percent'
  | 'performance_security_percent'
  | 'warranty_retention_percent'
  | 'warranty_period_months';

interface TermSpec {
  key: ContractTermKey;
  required: boolean;
  /** `percent` caps the input at 100; `select` is the price basis. */
  kind: 'money' | 'percent' | 'months' | 'select';
}

/** The terms each contract type asks for, required ones first. */
export const TYPE_TERMS: Partial<Record<ContractType, TermSpec[]>> = {
  cost_plus: [
    { key: 'fee_percent', required: true, kind: 'percent' },
    { key: 'max_fee', required: false, kind: 'money' },
    { key: 'target_cost', required: false, kind: 'money' },
  ],
  gmp: [
    { key: 'target_cost', required: true, kind: 'money' },
    { key: 'gmp_cap', required: true, kind: 'money' },
    { key: 'fee_percent', required: false, kind: 'percent' },
    { key: 'gainshare_split_pct', required: false, kind: 'percent' },
  ],
  tm: [{ key: 'tm_nte_cap', required: true, kind: 'money' }],
  unit_price: [{ key: 'price_basis', required: false, kind: 'select' }],
};

/** Commercial terms a template may carry, whatever the contract type. */
export const COMMERCIAL_TERMS: TermSpec[] = [
  { key: 'advance_payment_percent', required: false, kind: 'percent' },
  { key: 'performance_security_percent', required: false, kind: 'percent' },
  { key: 'warranty_retention_percent', required: false, kind: 'percent' },
  { key: 'warranty_period_months', required: false, kind: 'months' },
];

const TERM_LABELS: Record<ContractTermKey, string> = {
  fee_percent: 'Fee (% of cost)',
  max_fee: 'Fee cap',
  target_cost: 'Target cost',
  gmp_cap: 'Guaranteed maximum price (GMP)',
  gainshare_split_pct: 'Contractor share of savings (%)',
  tm_nte_cap: 'Not-to-exceed cap',
  price_basis: 'Unit-price basis',
  advance_payment_percent: 'Advance payment (% of contract)',
  performance_security_percent: 'Performance security (% of contract)',
  warranty_retention_percent: 'Warranty retention (% of contract)',
  warranty_period_months: 'Warranty period (months)',
};

export function termLabel(t: TFunction, key: string): string {
  const fallback = TERM_LABELS[key as ContractTermKey] ?? key.replace(/_/g, ' ');
  return t(`contracts.term.${key}`, { defaultValue: fallback });
}

/** Whether a built-in template is written for `type` (a template naming no types fits any). */
export function templateFits(template: ClauseTemplate | undefined, type: ContractType): boolean {
  const types = template?.contract_types ?? [];
  return types.length === 0 || types.includes(type);
}

/**
 * The minimum advance a template states for `value`, mirroring the server's
 * `template_library.minimum_advance_percent`: the first `[bound, percent]`
 * row whose bound the value does not exceed, a null bound answering for
 * anything above. Empty when the template has no tiers or there is no value.
 */
export function minimumAdvance(tiers: ClauseTemplate['advance_tiers'], value: string): string {
  const amount = Number(value);
  if (!tiers || tiers.length === 0 || !Number.isFinite(amount) || amount <= 0) return '';
  for (const [bound, percent] of tiers) {
    if (bound === null || amount <= Number(bound)) return String(percent);
  }
  return '';
}

/**
 * What a template fills in for a contract of `type` worth `value`: its
 * default terms, and the minimum advance for the value where it states one.
 * Nothing for a template not written for the type, the same rule the server
 * applies when it merges the template's terms.
 */
export function templatePrefill(
  template: ClauseTemplate | undefined,
  type: ContractType,
  value: string,
): Partial<Record<ContractTermKey, string>> {
  if (!template || !templateFits(template, type)) return {};
  const prefill: Partial<Record<ContractTermKey, string>> = {};
  for (const [key, figure] of Object.entries(template.default_terms ?? {})) {
    if (figure !== null && figure !== undefined) prefill[key as ContractTermKey] = String(figure);
  }
  const advance = minimumAdvance(template.advance_tiers, value);
  if (advance && prefill.advance_payment_percent === undefined) prefill.advance_payment_percent = advance;
  return prefill;
}

/** The commercial terms worth showing for this template: the ones it fills in. */
export function commercialTermsFor(
  template: ClauseTemplate | undefined,
  type: ContractType,
): TermSpec[] {
  if (!template || !templateFits(template, type)) return [];
  const carried = new Set(Object.keys(template.default_terms ?? {}));
  if ((template.advance_tiers ?? []).length > 0) carried.add('advance_payment_percent');
  return COMMERCIAL_TERMS.filter((spec) => carried.has(spec.key));
}

/** The required terms of `type` the form holds no figure for. */
export function missingRequiredTerms(
  type: ContractType,
  value: (key: ContractTermKey) => string,
): ContractTermKey[] {
  return (TYPE_TERMS[type] ?? [])
    .filter((spec) => spec.required && value(spec.key).trim() === '')
    .map((spec) => spec.key);
}

const TERM_ERROR_TEXT: Record<string, string> = {
  contract_term_required: 'Enter {{label}}.',
  contract_term_negative: '{{label}} cannot be negative.',
  contract_term_not_numeric: '{{label}} must be a number.',
  contract_term_over_100: '{{label}} cannot exceed 100%.',
  contract_gmp_below_target: 'The guaranteed maximum price cannot be below the target cost.',
  contract_price_basis_unknown: 'Choose a fixed or an adjustable unit price.',
};

/** The sentence a coded term problem is shown as, beside its field. */
export function termErrorText(t: TFunction, code: string, key: string): string {
  return t(`contracts.terms_error.${code}`, {
    defaultValue: TERM_ERROR_TEXT[code] ?? TERM_ERROR_TEXT.contract_term_required,
    label: termLabel(t, key),
  });
}

/**
 * The fields the server refused, as `term key -> message`, from the coded
 * `invalid_contract_terms` body. Empty for any other error, so the caller
 * falls back to its toast.
 */
export function contractTermErrors(err: unknown, t: TFunction): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const body = err.body as { detail?: unknown } | null;
  const detail = body && typeof body === 'object' ? (body.detail as Record<string, unknown> | undefined) : undefined;
  if (!detail || detail.error !== 'invalid_contract_terms' || !Array.isArray(detail.fields)) return {};
  const out: Record<string, string> = {};
  for (const entry of detail.fields as Array<Record<string, unknown>>) {
    const field = typeof entry.field === 'string' ? entry.field : '';
    const code = typeof entry.code === 'string' ? entry.code : '';
    if (!field.startsWith('terms.') || !code) continue;
    const key = field.slice('terms.'.length);
    if (!(key in out)) out[key] = termErrorText(t, code, key);
  }
  return out;
}

/**
 * The firm on the other side, picked by name.
 *
 * A subcontractor comes from the Subcontractors register; a client from
 * Contacts, searched on the server so a directory past one page still
 * answers. The value sent is the id, the same `counterparty_id` the register
 * resolves back to a name.
 */
export function CounterpartyPicker({
  type,
  value,
  displayName,
  onChange,
  className,
}: {
  type: CounterpartyType;
  value: string;
  displayName: string;
  onChange: (id: string, name: string) => void;
  className: string;
}) {
  const { t } = useTranslation();
  const subsQ = useQuery({
    // Same key as the register's counterparty cell, so the two share a cache.
    queryKey: ['contracts', 'counterparty-subs'],
    queryFn: () => listSubcontractors({ limit: 200 }),
    enabled: type === 'subcontractor',
    staleTime: 5 * 60_000,
  });
  const compareName = useNameCollator();

  if (type === 'client') {
    return (
      <ContactSearchInput
        value={value}
        displayValue={displayName}
        onChange={(id, name) => onChange(id, name)}
        placeholder={t('contracts.counterparty_search', { defaultValue: 'Search contacts by name' })}
      />
    );
  }

  const firms = [...(subsQ.data?.items ?? [])].sort((a, b) => compareName(a.legal_name, b.legal_name));
  return (
    <select
      value={value}
      onChange={(e) => {
        const firm = firms.find((s) => s.id === e.target.value);
        onChange(e.target.value, firm?.legal_name ?? '');
      }}
      className={className}
      data-testid="contract-counterparty-firm"
    >
      <option value="">
        {subsQ.isPending
          ? t('contracts.counterparty_loading', { defaultValue: 'Loading subcontractors…' })
          : t('contracts.counterparty_none', { defaultValue: 'Not chosen yet' })}
      </option>
      {firms.map((firm) => (
        <option key={firm.id} value={firm.id}>
          {firm.trade_name && firm.trade_name !== firm.legal_name
            ? `${firm.legal_name} (${firm.trade_name})`
            : firm.legal_name}
        </option>
      ))}
    </select>
  );
}
