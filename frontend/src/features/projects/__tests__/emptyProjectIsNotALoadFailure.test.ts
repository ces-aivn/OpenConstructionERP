// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { boqLoadState } from '../ProjectDetailPage';

const base = { listFailed: false, detailsLoaded: false, detailsCount: 0, detailsFailed: 0 };

describe('the project total before and after a BOQ exists', () => {
  it('reads a project with no BOQ as empty, not as a failed load', () => {
    expect(boqLoadState({ ...base, boqCount: 0 })).toEqual({
      unavailable: false,
      empty: true,
      pending: false,
      partial: false,
    });
  });

  it('reads a failed BOQ list as unavailable', () => {
    const state = boqLoadState({ ...base, boqCount: undefined, listFailed: true });
    expect(state.unavailable).toBe(true);
    expect(state.empty).toBe(false);
    expect(state.pending).toBe(false);
  });

  it('is pending while the list or the details are still loading', () => {
    expect(boqLoadState({ ...base, boqCount: undefined }).pending).toBe(true);
    expect(boqLoadState({ ...base, boqCount: 2 }).pending).toBe(true);
  });

  it('reads every detail failing as unavailable and some failing as partial', () => {
    expect(boqLoadState({ ...base, boqCount: 2, detailsLoaded: true, detailsFailed: 2 }).unavailable).toBe(true);
    const some = boqLoadState({ ...base, boqCount: 2, detailsLoaded: true, detailsCount: 1, detailsFailed: 1 });
    expect(some).toEqual({ unavailable: false, empty: false, pending: false, partial: true });
  });

  it('has a plain figure once every BOQ loaded', () => {
    expect(boqLoadState({ ...base, boqCount: 2, detailsLoaded: true, detailsCount: 2 })).toEqual({
      unavailable: false,
      empty: false,
      pending: false,
      partial: false,
    });
  });
});
