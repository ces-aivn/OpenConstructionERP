// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import type { CreateProjectData, Project } from '../api';
import { changedContractFields, isCreateFormDirty, projectCoreForm } from '../CreateProjectPage';

describe('closing the create dialog', () => {
  // The currency comes from the reader preference and the language from the
  // interface, so an untouched form is not blank; it equals what it opened with.
  const baseline = projectCoreForm(undefined, 'VND', 'vi');

  it('asks nothing when the form still holds what it opened with', () => {
    expect(isCreateFormDirty({ form: { ...baseline }, baseline, extras: ['', '  '] })).toBe(false);
  });

  it('asks when a field was typed in', () => {
    expect(isCreateFormDirty({ form: { ...baseline, name: 'Landmark 81' }, baseline, extras: [] })).toBe(true);
    expect(isCreateFormDirty({ form: { ...baseline, currency: 'USD' }, baseline, extras: [] })).toBe(true);
    expect(isCreateFormDirty({ form: { ...baseline }, baseline, extras: ['9174287000000'] })).toBe(true);
  });

  it('seeds a new project with the reader currency and language', () => {
    expect(baseline).toMatchObject({ currency: 'VND', locale: 'vi', name: '', classification_standard: '' });
  });
});

describe('editing the contract fields', () => {
  const project = {
    id: 'p1',
    name: 'Penn',
    project_code: 'CS-US02',
    contract_value: '10000000000000',
    budget_estimate: '9174287000000',
    planned_start_date: '2026-11-01',
    planned_end_date: null,
    client_id: null,
  } as unknown as Project;

  it('sends only what changed', () => {
    const data: CreateProjectData = {
      name: 'Penn',
      project_code: 'CS-US02',
      contract_value: '10500000000000',
      budget_estimate: '9174287000000',
      planned_start_date: '2026-11-01',
      planned_end_date: '2027-12-31',
      client_id: null,
    };
    expect(changedContractFields(data, project)).toEqual({
      contract_value: '10500000000000',
      planned_end_date: '2027-12-31',
    });
  });

  it('clears a stored value the user blanked', () => {
    const data: CreateProjectData = {
      name: 'Penn',
      project_code: 'CS-US02',
      contract_value: null,
      budget_estimate: '9174287000000',
      planned_start_date: '2026-11-01',
    };
    expect(changedContractFields(data, project)).toEqual({ contract_value: null });
  });
});
