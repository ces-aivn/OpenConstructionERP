// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * API helpers for the Risk Register module.
 *
 * Endpoints (mounted at /api/v1/risk):
 *   POST   /v1/risk/projects/{project_id}/simulate
 *     — Run a Monte Carlo simulation across the project's risks. Every run
 *       is stored server-side.
 *   GET    /v1/risk/projects/{project_id}/simulations?limit=N
 *     — Stored runs, newest first (the first one is the last run).
 */

import { apiGet, apiPost, type Page } from '@/shared/lib/api';

/* ── Auto-escalation (TOP-30 #24) ──────────────────────────────────────── */

/** Body for a manual escalation sweep over a project's risks. */
export interface RiskEscalateRequest {
  /** Override the default escalation threshold (1-25 PMBOK product scale). */
  threshold?: number;
}

/** Summary returned by an escalation sweep. */
export interface RiskEscalateResult {
  scanned: number;
  escalated: number;
  /** Count of escalations grouped by trigger (severity / review_lapsed). */
  triggers: Record<string, number>;
}

/**
 * Run an on-demand auto-escalation sweep for ``projectId``.
 *
 * Escalates every not-yet-escalated risk whose severity product crosses the
 * threshold or whose next-review date has lapsed. Idempotent: already
 * escalated risks are skipped. Requires the ``risk.escalate`` permission
 * (MANAGER). The same sweep is run periodically by the backend scheduler.
 */
export async function escalateProjectRisks(
  projectId: string,
  body: RiskEscalateRequest = {},
): Promise<RiskEscalateResult> {
  return apiPost<RiskEscalateResult, RiskEscalateRequest>(
    `/v1/risk/projects/${projectId}/escalate`,
    body,
  );
}

/** Mode flag controlling which PERT triple(s) the simulator samples. */
export type RiskSimulateMode = 'cost' | 'schedule' | 'both';

/** POST body for ``/v1/risk/projects/{id}/simulate``. */
export interface RiskSimulateRequest {
  /** Number of Monte Carlo iterations. Backend clamps to [1000, 100000]. */
  iterations?: number;
  mode?: RiskSimulateMode;
  /** Reproduce a run: same seed on the same register, same result. */
  seed?: number;
  /**
   * +/- band (fraction, 0-0.9) of the triangular impact distribution for a
   * risk that has one impact figure and no three-point estimate.
   */
  impact_spread?: number;
}

/** Default impact spread the server applies (0.2 = 80 % to 120 %). */
export const DEFAULT_IMPACT_SPREAD = 0.2;

/**
 * One bin in the contingency histogram (10-bin equal-width by default).
 *
 * ``lower``/``upper`` are Decimal money serialised as a JSON *string* by the
 * backend (e.g. ``"100000.00"``). Keep the type honest so call-sites coerce
 * with ``Number()`` at the boundary instead of string-concatenating
 * ("100000.00" + "150000.00" → "100000.00150000.00", then ``/ 2`` → NaN).
 */
export interface RiskHistogramBin {
  lower: number | string;
  upper: number | string;
  count: number;
}

/** One bar in the tornado / sensitivity chart, sorted desc by contribution. */
export interface RiskTornadoEntry {
  risk_id: string;
  code: string;
  /**
   * Mean probability-weighted contribution to the project contingency.
   * Decimal-as-string on the wire — coerce with ``Number()`` before arithmetic.
   */
  contribution: number | string;
}

/** Result of a Monte Carlo simulation, mirroring the backend Pydantic model. */
export interface RiskSimulationResult {
  /** Stored run id and time (ISO); absent only on very old snapshots. */
  run_id?: string | null;
  created_at?: string | null;
  seed?: number | null;
  impact_spread?: number | null;
  iterations: number;
  risk_count: number;
  mode: RiskSimulateMode;
  /** Mean of the simulated cost totals and the register EMV next to it. */
  mean_cost?: number | string | null;
  emv_cost?: number | string | null;
  mean_schedule_days?: number | null;
  emv_schedule_days?: number | null;
  /** What the histogram bins measure: money ("cost") or days ("schedule"). */
  histogram_basis?: 'cost' | 'schedule' | '';
  // Cost percentiles are Decimal-as-string on the wire (or null when the
  // project mixes currencies / has no cost risks) — coerce with Number().
  p50_cost: number | string | null;
  p80_cost: number | string | null;
  p95_cost: number | string | null;
  p50_schedule_days: number | null;
  p80_schedule_days: number | null;
  p95_schedule_days: number | null;
  histogram_bins: RiskHistogramBin[];
  tornado: RiskTornadoEntry[];
  /** Project currency (data-driven; "" means unknown — render currency-less). */
  currency: string;
  mixed_currency?: boolean;
}

/**
 * Trigger a Monte Carlo simulation for ``projectId``.
 *
 * The backend permission required is ``risk.read`` (re-used from the
 * existing risk endpoints). Returns the full result snapshot — the
 * caller can render histogram + tornado directly without an extra
 * fetch.
 */
export async function simulateRisk(
  projectId: string,
  body: RiskSimulateRequest = {},
): Promise<RiskSimulationResult> {
  const payload: RiskSimulateRequest = {
    iterations: body.iterations ?? 10000,
    mode: body.mode ?? 'both',
    impact_spread: body.impact_spread ?? DEFAULT_IMPACT_SPREAD,
    ...(body.seed !== undefined ? { seed: body.seed } : {}),
  };
  return apiPost<RiskSimulationResult, RiskSimulateRequest>(
    `/v1/risk/projects/${projectId}/simulate`,
    payload,
  );
}

/** Stored Monte Carlo runs for ``projectId``, newest first (the first page of ``limit``). */
export async function listSimulationRuns(projectId: string, limit = 1): Promise<RiskSimulationResult[]> {
  const page = await apiGet<Page<RiskSimulationResult>>(`/v1/risk/projects/${projectId}/simulations?limit=${limit}`);
  return page.items;
}
