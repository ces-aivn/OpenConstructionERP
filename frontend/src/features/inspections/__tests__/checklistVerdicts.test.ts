// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Each checklist item carries its own verdict, and the inspection's result
 * cannot claim more than its items do: one failed item makes the whole
 * inspection a fail, and an item nobody has assessed is not shown as passed.
 */
import { describe, expect, it } from 'vitest';

import { checklistVerdict, type Inspection } from '../api';
import { ncrDraftFromInspection, resultForVerdicts } from '../InspectionsPage';

const t = ((key: string, opts: Record<string, unknown> = {}) =>
  String(opts.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k] ?? ''))) as never;

describe('reading an item verdict', () => {
  it('only treats an explicit answer as a pass or a fail', () => {
    expect(checklistVerdict({ response: 'pass' })).toBe('pass');
    expect(checklistVerdict({ response: 'fail' })).toBe('fail');
    expect(checklistVerdict({ response: 'na' })).toBe('na');
    expect(checklistVerdict({ passed: false })).toBe('fail');
  });

  it('leaves an unanswered item as not assessed instead of passed', () => {
    expect(checklistVerdict({})).toBeNull();
    expect(checklistVerdict({ response: '' })).toBeNull();
  });
});

describe('the inspection result follows its items', () => {
  it('is forced to fail when any item failed', () => {
    expect(resultForVerdicts('pass', ['pass', 'fail', null])).toBe('fail');
    expect(resultForVerdicts('partial', ['fail'])).toBe('fail');
  });

  it('keeps the chosen result when no item failed', () => {
    expect(resultForVerdicts('pass', ['pass', 'na', null])).toBe('pass');
    expect(resultForVerdicts('partial', [])).toBe('partial');
  });
});

describe('an NCR drafted from a failed inspection', () => {
  const inspection = {
    id: 'i1',
    inspection_number: 'INS-004',
    title: 'Slab L2 rebar',
    inspection_type: 'structural',
    location: 'Block A, L2',
    result: 'partial',
    notes: '',
    checklist: [
      { id: 'a', description: 'Cover to rebar', passed: false, result: 'fail', critical: true, notes: '20 mm' },
      { id: 'b', description: 'Lap length', passed: true, result: 'pass', critical: false, notes: '' },
    ],
  } as unknown as Inspection;

  it('lists only the failed items and goes through translation', () => {
    const draft = ncrDraftFromInspection(inspection, t);
    expect(draft.title).toBe('NCR from inspection INS-004: Slab L2 rebar');
    expect(draft.description).toContain('Cover to rebar (Critical) - 20 mm');
    expect(draft.description).not.toContain('Lap length');
    expect(draft.location).toBe('Block A, L2');
  });

  it('suggests a critical severity when a critical item failed', () => {
    expect(ncrDraftFromInspection(inspection, t).severity).toBe('critical');
  });
});
