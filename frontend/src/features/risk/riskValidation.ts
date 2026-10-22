// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Input checks and error messages for the risk register forms.
 *
 * Probability has one scale in the UI: a percentage, 0-100 %. The API stores a
 * fraction 0-1, so the form divides by 100 before sending. Both sides refuse an
 * out-of-range value; the server answers with the error type
 * `risk_probability_out_of_range` on the `probability` field.
 *
 * A 422 from the server is never shown as Pydantic's English sentence. Every
 * entry is read by its machine fields (`loc` for the field, `type` for the
 * rule) and turned into a translated message.
 */
import { ApiError } from '@/shared/lib/api';

export type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** Error type the risk API uses for a probability outside 0-1. */
export const PROBABILITY_ERROR_CODE = 'risk_probability_out_of_range';

export const PROBABILITY_PERCENT_MIN = 0;
export const PROBABILITY_PERCENT_MAX = 100;

/**
 * Read a number the way a person types it: "15", "15,5", "15.5", "1 000,5".
 *
 * Returns `null` for a blank entry and `NaN` for anything that is not a plain
 * decimal number. When both "," and "." appear, the last one is the decimal
 * separator and the other is grouping.
 */
export function parseLocaleNumber(raw: string): number | null {
  let s = raw.replace(/[\s\u00A0\u202F]/g, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    s = s.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return Number.NaN;
  return Number(s);
}

export interface RiskDraftInput {
  /** Probability as typed, in percent. */
  probabilityPercent: string;
  impactCost: number;
  scheduleDays: number;
}

export type RiskDraftField = 'probability' | 'impactCost' | 'scheduleDays';

export interface RiskDraftCheck {
  /** Probability as the API wants it (0-1), or null when the entry is invalid. */
  probability: number | null;
  errors: Partial<Record<RiskDraftField, string>>;
}

function probabilityRangeMessage(t: Translate): string {
  return t('risk.validation.probability_range', {
    defaultValue: 'Probability must be between {{min}} and {{max}} %.',
    min: PROBABILITY_PERCENT_MIN,
    max: PROBABILITY_PERCENT_MAX,
  });
}

/** Check the create form before it is sent. */
export function checkRiskDraft(input: RiskDraftInput, t: Translate): RiskDraftCheck {
  const errors: Partial<Record<RiskDraftField, string>> = {};
  const pct = parseLocaleNumber(input.probabilityPercent);
  let probability: number | null = null;
  if (pct === null) {
    errors.probability = t('risk.validation.probability_required', {
      defaultValue: 'Enter the probability in percent (0 to 100).',
    });
  } else if (Number.isNaN(pct)) {
    errors.probability = t('risk.validation.probability_number', {
      defaultValue: 'Probability must be a number, for example 15 or 15,5.',
    });
  } else if (pct < PROBABILITY_PERCENT_MIN || pct > PROBABILITY_PERCENT_MAX) {
    errors.probability = probabilityRangeMessage(t);
  } else {
    // Rounded to the 4 decimals a fraction of a hundredth of a percent needs,
    // so 15 % is sent as 0.15 and not 0.15000000000000002.
    probability = Math.round(pct * 100) / 10000;
  }
  if (!Number.isFinite(input.impactCost) || input.impactCost < 0) {
    errors.impactCost = t('risk.validation.impact_cost_min', {
      defaultValue: 'Cost impact cannot be negative.',
    });
  }
  if (!Number.isInteger(input.scheduleDays) || input.scheduleDays < 0) {
    errors.scheduleDays = t('risk.validation.schedule_days_min', {
      defaultValue: 'Schedule impact must be a whole number of days, 0 or more.',
    });
  }
  return { probability, errors };
}

/** Field labels of the risk API, by request field name. */
function fieldLabel(field: string, t: Translate): string {
  switch (field) {
    case 'title':
      return t('common.title', { defaultValue: 'Title' });
    case 'description':
      return t('common.description', { defaultValue: 'Description' });
    case 'probability':
      return t('risk.probability', { defaultValue: 'Probability' });
    case 'impact_cost':
      return t('risk.impact_cost', { defaultValue: 'Cost Impact' });
    case 'impact_schedule_days':
      return t('risk.schedule_days', { defaultValue: 'Days' });
    case 'impact_severity':
      return t('risk.severity', { defaultValue: 'Impact Severity' });
    case 'response_cost':
      return t('risk.validation.field_response_cost', { defaultValue: 'Response cost' });
    case 'status':
      return t('risk.status', { defaultValue: 'Status' });
    case 'category':
      return t('risk.category', { defaultValue: 'Category' });
    case 'mitigation_strategy':
      return t('risk.mitigation', { defaultValue: 'Mitigation Strategy' });
    case 'contingency_plan':
      return t('risk.contingency', { defaultValue: 'Contingency Plan' });
    case 'owner_name':
      return t('risk.owner', { defaultValue: 'Risk Owner' });
    case 'iterations':
      return t('risk.montecarlo.iterations', { defaultValue: 'Iterations' });
    case 'impact_spread':
      return t('risk.montecarlo.spread', { defaultValue: 'Impact spread' });
    case 'seed':
      return t('risk.montecarlo.seed_label', { defaultValue: 'Seed' });
    default:
      return t('risk.validation.field_generic', { defaultValue: 'A field' });
  }
}

interface ValidationEntry {
  loc?: unknown;
  type?: unknown;
  ctx?: unknown;
}

function entryMessage(entry: ValidationEntry, t: Translate): { field: string; message: string } {
  const loc = Array.isArray(entry.loc) ? entry.loc.filter((p): p is string => typeof p === 'string') : [];
  const field = loc.filter((p) => p !== 'body' && p !== 'query').pop() ?? '';
  const type = typeof entry.type === 'string' ? entry.type : '';
  const ctx = (entry.ctx && typeof entry.ctx === 'object' ? entry.ctx : {}) as Record<string, unknown>;
  const label = fieldLabel(field, t);

  if (type === PROBABILITY_ERROR_CODE || (field === 'probability' && /than/.test(type))) {
    return { field, message: probabilityRangeMessage(t) };
  }
  if (type === 'greater_than_equal' || type === 'greater_than') {
    return {
      field,
      message: t('risk.validation.min_value', {
        defaultValue: '{{field}} cannot be less than {{min}}.',
        field: label,
        min: String(ctx.ge ?? ctx.gt ?? 0),
      }),
    };
  }
  if (type === 'less_than_equal' || type === 'less_than') {
    return {
      field,
      message: t('risk.validation.max_value', {
        defaultValue: '{{field}} cannot be more than {{max}}.',
        field: label,
        max: String(ctx.le ?? ctx.lt ?? ''),
      }),
    };
  }
  if (type === 'missing' || type === 'string_too_short') {
    return { field, message: t('risk.validation.required', { defaultValue: '{{field}} is required.', field: label }) };
  }
  if (type === 'string_too_long') {
    return { field, message: t('risk.validation.too_long', { defaultValue: '{{field}} is too long.', field: label }) };
  }
  if (/_parsing$|_type$|^finite_number$/.test(type)) {
    return { field, message: t('risk.validation.number', { defaultValue: '{{field}} must be a number.', field: label }) };
  }
  return { field, message: t('risk.validation.invalid', { defaultValue: '{{field}} has an invalid value.', field: label }) };
}

/**
 * Translated messages of a risk API validation error, by request field.
 * Empty when the error is not a 422 with a list of entries.
 */
export function riskApiFieldErrors(err: unknown, t: Translate): Record<string, string> {
  if (!(err instanceof ApiError) || err.status !== 422) return {};
  const body = err.body as { detail?: unknown } | null;
  if (!body || !Array.isArray(body.detail)) return {};
  const out: Record<string, string> = {};
  for (const entry of body.detail as ValidationEntry[]) {
    const { field, message } = entryMessage(entry, t);
    const key = field || '_';
    if (!(key in out)) out[key] = message;
  }
  return out;
}

/** One translated line for a toast: the field messages, or the error's own message. */
export function riskApiErrorMessage(err: unknown, t: Translate): string {
  const fields = Object.values(riskApiFieldErrors(err, t));
  if (fields.length > 0) return fields.join(' ');
  if (err instanceof ApiError && err.status === 422) {
    return t('risk.validation.check_form', { defaultValue: 'Some values are not valid. Check the form and try again.' });
  }
  return err instanceof Error ? err.message : String(err);
}
