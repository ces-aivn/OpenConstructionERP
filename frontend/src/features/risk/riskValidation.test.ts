// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Probability is typed in percent and checked before sending; a 422 from the
 * risk API is shown as a translated message per field, never as Pydantic's
 * English sentence.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api';
import {
  PROBABILITY_ERROR_CODE,
  checkRiskDraft,
  parseLocaleNumber,
  riskApiErrorMessage,
  riskApiFieldErrors,
} from './riskValidation';

// Echo the key with its interpolated values so a test can tell which message
// was chosen without depending on the English wording.
const t = (key: string, opts?: Record<string, unknown>) => {
  const vars = Object.entries(opts ?? {})
    .filter(([k]) => k !== 'defaultValue')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return vars ? `${key}[${vars}]` : key;
};

const draft = (probabilityPercent: string, impactCost = 0, scheduleDays = 0) =>
  checkRiskDraft({ probabilityPercent, impactCost, scheduleDays }, t);

describe('parseLocaleNumber', () => {
  it.each([
    ['15', 15],
    ['15,5', 15.5],
    ['15.5', 15.5],
    ['1,5', 1.5],
    [' 100 ', 100],
    ['1.000,5', 1000.5],
    ['1,000.5', 1000.5],
  ])('reads %s as %s', (raw, expected) => {
    expect(parseLocaleNumber(raw)).toBe(expected);
  });

  it('returns null for a blank entry and NaN for text', () => {
    expect(parseLocaleNumber('  ')).toBeNull();
    expect(Number.isNaN(parseLocaleNumber('abc'))).toBe(true);
    expect(Number.isNaN(parseLocaleNumber('1,2,3'))).toBe(true);
  });
});

describe('checkRiskDraft', () => {
  it('sends a percentage as a 0-1 fraction', () => {
    expect(draft('15')).toEqual({ probability: 0.15, errors: {} });
    expect(draft('0').probability).toBe(0);
    expect(draft('100').probability).toBe(1);
    expect(draft('12,5').probability).toBe(0.125);
  });

  it('refuses a probability above 100 % or below 0 %', () => {
    for (const bad of ['150', '100,1', '-1']) {
      const res = draft(bad);
      expect(res.probability).toBeNull();
      expect(res.errors.probability).toBe('risk.validation.probability_range[min=0,max=100]');
    }
  });

  it('asks for a number when the entry is blank or not numeric', () => {
    expect(draft('').errors.probability).toBe('risk.validation.probability_required');
    expect(draft('abc').errors.probability).toBe('risk.validation.probability_number');
  });

  it('refuses a negative cost or a fractional or negative day count', () => {
    expect(draft('10', -1).errors.impactCost).toBe('risk.validation.impact_cost_min');
    expect(draft('10', 0, -2).errors.scheduleDays).toBe('risk.validation.schedule_days_min');
    expect(draft('10', 0, 1.5).errors.scheduleDays).toBe('risk.validation.schedule_days_min');
  });
});

describe('riskApiFieldErrors / riskApiErrorMessage', () => {
  const probability422 = new ApiError(422, 'Unprocessable Entity', {
    detail: [
      {
        type: PROBABILITY_ERROR_CODE,
        loc: ['body', 'probability'],
        msg: 'Probability must be between 0 and 1 (0 to 100 %).',
        ctx: { min: 0, max: 1, min_percent: 0, max_percent: 100 },
      },
    ],
  });

  it('maps the probability code to the translated range message', () => {
    expect(riskApiFieldErrors(probability422, t)).toEqual({
      probability: 'risk.validation.probability_range[min=0,max=100]',
    });
    expect(riskApiErrorMessage(probability422, t)).not.toMatch(/must be between 0 and 1/);
  });

  it('maps the plain Pydantic bound on probability to the same message', () => {
    const legacy = new ApiError(422, '', {
      detail: [{ type: 'less_than_equal', loc: ['body', 'probability'], msg: 'Input should be less than or equal to 1', ctx: { le: 1 } }],
    });
    expect(riskApiErrorMessage(legacy, t)).toBe('risk.validation.probability_range[min=0,max=100]');
  });

  it('names the field and the bound for other fields', () => {
    const err = new ApiError(422, '', {
      detail: [
        { type: 'greater_than_equal', loc: ['body', 'impact_cost'], msg: 'Input should be greater than or equal to 0', ctx: { ge: 0 } },
        { type: 'less_than_equal', loc: ['body', 'iterations'], msg: 'x', ctx: { le: 100000 } },
        { type: 'int_parsing', loc: ['body', 'impact_schedule_days'], msg: 'x' },
        { type: 'value_error', loc: ['body', 'response_cost'], msg: 'Value error, amount is outside the supported range' },
      ],
    });
    expect(riskApiFieldErrors(err, t)).toEqual({
      impact_cost: 'risk.validation.min_value[field=risk.impact_cost,min=0]',
      iterations: 'risk.validation.max_value[field=risk.montecarlo.iterations,max=100000]',
      impact_schedule_days: 'risk.validation.number[field=risk.schedule_days]',
      response_cost: 'risk.validation.invalid[field=risk.validation.field_response_cost]',
    });
  });

  it('falls back to a translated generic line for a 422 without entries', () => {
    const err = new ApiError(422, '', { detail: 'bad' });
    expect(riskApiErrorMessage(err, t)).toBe('risk.validation.check_form');
  });

  it('keeps the message of a non-validation error', () => {
    expect(riskApiErrorMessage(new Error('Network down'), t)).toBe('Network down');
  });
});
