// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The insights panel reads exposure as EMV (the server's expected_value per
 * risk), the figure the summary card shows, and counts High / Critical by the
 * matrix tier, the rule of the summary card.
 */
import { describe, expect, it } from 'vitest';

import { buildRiskInsights } from './riskInsights';

const t = (key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? key);

const base = {
  category: 'technical',
  impact_severity: 'high',
  risk_score: 1,
  impact_schedule_days: 0,
  owner_name: '',
  created_at: '2026-10-01T00:00:00Z',
};

describe('buildRiskInsights', () => {
  it('sums EMV for exposure and keeps the unweighted impact apart', () => {
    const { datasets, builtins } = buildRiskInsights(
      [
        { ...base, title: 'A', status: 'open', impact_cost: 120, expected_value: '60', risk_tier: 'high' },
        { ...base, title: 'B', status: 'open', impact_cost: 100, expected_value: '40', risk_tier: 'low' },
        { ...base, title: 'C', status: 'closed', impact_cost: 500, expected_value: '0', risk_tier: 'critical' },
      ],
      'VND',
      t as never,
    );
    const rows = datasets[0]!.rows;
    expect(rows.reduce((sum, r) => sum + Number(r.exposure), 0)).toBe(100);
    expect(rows.reduce((sum, r) => sum + Number(r.impact), 0)).toBe(720);
    // High / Critical: the open high-tier risk only; the closed one is retired.
    expect(rows.map((r) => r.high)).toEqual([1, 0, 0]);
    const kpi = builtins.find((b) => b.id === 'kpi-exposure');
    expect(kpi?.title).toBe('Exposure (EMV)');
    expect(kpi?.measure).toBe('exposure');
  });
});
