// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A bill of Landmark 81 opened by its URL showed Landmark 81 in the
 * breadcrumb while the header picker stayed on Penn, because the page only
 * set the context when none was active. The record's project now wins.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectContextStore, useSyncActiveProjectWithRecord } from '../useProjectContextStore';

beforeEach(() => {
  localStorage.clear();
  useProjectContextStore.setState({ activeProjectId: null, activeProjectName: '', activeBOQId: null });
});

describe('the active project follows the record on screen', () => {
  it('switches from another project to the record project and drops its BOQ', () => {
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    useProjectContextStore.getState().setActiveBOQ('penn-boq');

    renderHook(() => useSyncActiveProjectWithRecord('landmark', 'CS-VN01 Landmark 81'));

    const state = useProjectContextStore.getState();
    expect(state.activeProjectId).toBe('landmark');
    expect(state.activeProjectName).toBe('CS-VN01 Landmark 81');
    expect(state.activeBOQId).toBeNull();
    expect(JSON.parse(localStorage.getItem('oe_active_project') ?? '{}')).toEqual({
      id: 'landmark',
      name: 'CS-VN01 Landmark 81',
      boqId: null,
    });
  });

  it('keeps the BOQ when the record is already in the active project', () => {
    useProjectContextStore.getState().setActiveProject('landmark', 'CS-VN01 Landmark 81');
    useProjectContextStore.getState().setActiveBOQ('landmark-boq');

    renderHook(() => useSyncActiveProjectWithRecord('landmark', 'CS-VN01 Landmark 81'));

    expect(useProjectContextStore.getState().activeBOQId).toBe('landmark-boq');
  });

  it('waits until the record project is known', () => {
    useProjectContextStore.getState().setActiveProject('penn', 'CS-US02 Penn');
    const { rerender } = renderHook(
      ({ id, name }: { id?: string; name?: string }) => useSyncActiveProjectWithRecord(id, name),
      { initialProps: {} },
    );
    expect(useProjectContextStore.getState().activeProjectId).toBe('penn');
    rerender({ id: 'landmark', name: 'CS-VN01 Landmark 81' });
    expect(useProjectContextStore.getState().activeProjectId).toBe('landmark');
  });
});
