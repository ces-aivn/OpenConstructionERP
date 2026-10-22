// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import type { NCR } from '../ncr/api';
import type { PunchItem } from '../punchlist/api';
import type { RFI } from '../rfi/api';
import { isActiveIssue, isOverdue, mapNcr, mapPunch, mapRfi } from './issueSources';

const NOW = new Date('2026-10-22T09:00:00Z');

function punch(overrides: Partial<PunchItem> = {}): PunchItem {
  return {
    id: 'p1',
    title: 'Touch up paint at grid C4',
    status: 'open',
    priority: 'high',
    due_date: '2026-10-01',
    created_at: '2026-09-20T08:00:00Z',
    ...overrides,
  } as PunchItem;
}

function ncr(overrides: Partial<NCR> = {}): NCR {
  return {
    id: 'n1',
    project_id: 'proj',
    ncr_number: 4,
    title: 'Validation errors in BOQ (13)',
    ncr_type: 'documentation',
    severity: 'major',
    status: 'identified',
    created_at: '2026-10-01T08:00:00Z',
    metadata: { source: 'validation', error_count: 13 },
    ...overrides,
  } as NCR;
}

function rfi(overrides: Partial<RFI> = {}): RFI {
  return {
    id: 'r1',
    rfi_number: 'RFI-001',
    subject: 'Hybrid OR MEP clearance',
    status: 'open',
    priority: 'high',
    assigned_to: null,
    response_due_date: '2018-09-14',
    is_overdue: true,
    created_at: '2018-09-01T08:00:00Z',
    ...overrides,
  } as RFI;
}

describe('one open rule for list, chips and KPIs', () => {
  it('counts an open past-due punch item as active and overdue', () => {
    const mapped = mapPunch(punch())!;
    expect(isActiveIssue(mapped)).toBe(true);
    expect(isOverdue(mapped, NOW)).toBe(true);
  });

  it('keeps a resolved punch item reachable but neither open nor overdue', () => {
    const mapped = mapPunch(punch({ status: 'resolved' }))!;
    expect(mapped.status).toBe('resolved');
    expect(isActiveIssue(mapped)).toBe(false);
    expect(isOverdue(mapped, NOW)).toBe(false);
  });
});

describe('validation-raised NCRs', () => {
  it('files a BOQ validation NCR under its own source with a localizable title', () => {
    const mapped = mapNcr(ncr())!;
    expect(mapped.source).toBe('validation');
    expect(mapped.titleKey).toBe('issues.title_validation_errors');
    expect(mapped.titleParams).toEqual({ code: 'NCR-004', count: 13 });
  });

  it('leaves a quality NCR under the NCR source with its own title', () => {
    const mapped = mapNcr(ncr({ title: 'Weld porosity at B2', metadata: { source: 'clash' } }))!;
    expect(mapped.source).toBe('ncr');
    expect(mapped.titleKey).toBeUndefined();
    expect(mapped.title).toBe('Weld porosity at B2');
  });
});

describe('RFIs in the hub', () => {
  it('brings an overdue open RFI in as open, overdue work', () => {
    const mapped = mapRfi(rfi(), NOW)!;
    expect(mapped).toMatchObject({ id: 'rfi:r1', source: 'rfi', status: 'open', deepLink: '/rfi/r1' });
    expect(mapped.title).toBe('RFI-001: Hybrid OR MEP clearance');
    expect(isOverdue(mapped, NOW)).toBe(true);
  });

  it('brings in a past-due draft too, by the same rule the register uses', () => {
    expect(mapRfi(rfi({ status: 'draft', is_overdue: true }), NOW)).not.toBeNull();
  });

  it('leaves out an answered RFI even when a stale flag says overdue', () => {
    expect(mapRfi(rfi({ status: 'answered', is_overdue: true }), NOW)).toBeNull();
  });

  it('leaves out an open RFI that is not yet due', () => {
    expect(mapRfi(rfi({ is_overdue: false, response_due_date: '2026-12-01' }), NOW)).toBeNull();
  });
});
