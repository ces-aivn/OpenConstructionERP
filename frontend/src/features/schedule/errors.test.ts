// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/lib/api';
import { scheduleErrorDetail, scheduleErrorMessage } from './errors';

const t = (key: string, opts: Record<string, unknown> = {}) =>
  String(opts.defaultValue ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(opts[k] ?? ''));

const coded = (status: number, detail: Record<string, unknown>) =>
  new ApiError(status, 'x', { detail: { message: 'English for API clients', ...detail } });

describe('scheduleErrorDetail', () => {
  it('reads the code and its values', () => {
    const detail = scheduleErrorDetail(coded(409, { error: 'schedule_has_activities', activity_count: 4 }));
    expect(detail?.error).toBe('schedule_has_activities');
    expect(detail?.activity_count).toBe(4);
  });

  it('is null for a plain string detail or a non-API error', () => {
    expect(scheduleErrorDetail(new ApiError(400, 'x', { detail: 'prose' }))).toBeNull();
    expect(scheduleErrorDetail(new Error('boom'))).toBeNull();
  });
});

describe('scheduleErrorMessage', () => {
  it('says each coded refusal from its own key, never the English detail', () => {
    const cases = [
      [{ error: 'boq_has_no_positions' }, /nothing to schedule/],
      [{ error: 'boq_not_found' }, /not found in this project/],
      [{ error: 'schedule_generation_failed', reference: 'ab12cd34' }, /reference ab12cd34/],
      [{ error: 'schedule_dependency_cycle' }, /loop back/],
      [{ error: 'schedule_dependency_self' }, /itself/],
      [{ error: 'schedule_activity_not_in_schedule' }, /same schedule|this schedule/],
      [{ error: 'schedule_has_baselines', baseline_count: 2 }, /2 baselines/],
      [{ error: 'schedule_has_activities', activity_count: 7 }, /7 activities/],
      [{ error: 'predecessors_not_complete', count: 2, names: ['Dig', 'Pour'] }, /predecessors are open: Dig, Pour/],
    ] as const;
    for (const [detail, expected] of cases) {
      const text = scheduleErrorMessage(coded(400, detail), t);
      expect(text).toMatch(expected);
      expect(text).not.toContain('English for API clients');
      expect(text.toLowerCase()).not.toContain('log');
    }
  });

  it('says a refusal by role in words, not the server English', () => {
    const refusal = new ApiError(403, 'Forbidden', { detail: 'Missing permission: schedule.update' });
    expect(scheduleErrorMessage(refusal, t)).toBe('Your role does not allow this. Ask an editor or an administrator.');
    expect(scheduleErrorMessage(coded(404, { error: 'relationship_not_found' }), t)).toMatch(/no longer there/);
  });

  it('says a reversed or impossible date from the validation code, not the English msg', () => {
    const reversed = new ApiError(422, 'x', {
      detail: [
        {
          type: 'date_range_invalid',
          loc: ['body'],
          msg: 'Value error, end_date must be on or after start_date',
          ctx: { field: 'end_date', start_date: '2026-05-10', end_date: '2026-05-01' },
        },
      ],
    });
    const text = scheduleErrorMessage(reversed, t);
    expect(text).toMatch(/finish date \(2026-05-01\) is before the start date \(2026-05-10\)/);
    expect(text).not.toContain('Value error');

    const impossible = new ApiError(422, 'x', {
      detail: [{ type: 'invalid_calendar_date', loc: ['body'], msg: 'x', ctx: { field: 'start_date', value: '2026-02-30' } }],
    });
    expect(scheduleErrorMessage(impossible, t)).toBe('Start date (2026-02-30) is not a real calendar date.');
  });

  it('says a plan that overruns the project finish with both dates', () => {
    const text = scheduleErrorMessage(
      coded(422, { error: 'plan_exceeds_window', planned_end: '2027-03-01', requested_end: '2026-12-31' }),
      t,
    );
    expect(text).toMatch(/finish on 2027-03-01, after the project finish date 2026-12-31/);
    expect(scheduleErrorMessage(coded(422, { error: 'calendar_preset_years_invalid', max_years: 30 }), t)).toMatch(
      /1 to 30 years/,
    );
  });

  it('falls back to the server text for an uncoded error', () => {
    expect(scheduleErrorMessage(new ApiError(500, 'x', { detail: 'Something broke' }), t)).toBe('Something broke');
  });
});
