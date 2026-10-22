// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Monte Carlo simulation tab for the Risk Register page.
 *
 * Renders three blocks of UI driven by the
 * ``POST /v1/risk/projects/{id}/simulate`` endpoint:
 *
 *   1. A "Run simulation" panel with iterations, mode and the impact spread
 *      used for risks that have a single impact figure.
 *   2. A "Last run" summary strip — P50 / P80 / P95 chips (cost +
 *      schedule), and the mean of the run next to the register EMV, so a
 *      reader can see the simulation is centred on the same exposure the
 *      register reports.
 *   3. A histogram (Recharts BarChart, equal-width bins) of the simulated
 *      distribution + a tornado chart (top 8 contributors, sorted desc).
 *
 * Every run is stored server-side; the tab opens on the newest stored run.
 *
 * Currency is data-driven — when the project has no currency set we
 * render currency-less numbers rather than mislabelling.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Play, Loader2, TrendingUp, AlertTriangle } from 'lucide-react';

import { Button, Card, EmptyState } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { fmtDate } from '@/shared/lib/formatters';
import { toNum } from '@/shared/lib/money';
import { useHasPermission } from '@/shared/lib/permissionGates';
import { getNumberLocale } from '@/stores/usePreferencesStore';

import {
  DEFAULT_IMPACT_SPREAD,
  listSimulationRuns,
  simulateRisk,
  type RiskHistogramBin,
  type RiskSimulateMode,
  type RiskSimulationResult,
} from './api';
import { riskApiErrorMessage } from './riskValidation';

interface MonteCarloTabProps {
  projectId: string;
  /** Currency from project context — fed into the chips' label. */
  currency: string;
}

const ITERATIONS_MIN = 1000;
const ITERATIONS_MAX = 100_000;
const ITERATIONS_DEFAULT = 10_000;
const TORNADO_TOP_N = 8;
const SPREAD_PERCENT_MAX = 90;

function fmtCurrencyOrPlain(
  n: number | string | null | undefined,
  currency: string,
): string {
  if (n === null || n === undefined) return '—';
  // Backend money arrives as a Decimal-rendered string; coerce safely so a
  // raw string never reaches Intl.NumberFormat (which would render "NaN").
  const value = toNum(n);
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : '';
  try {
    if (safe) {
      return new Intl.NumberFormat(getNumberLocale(), {
        style: 'currency',
        currency: safe,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    // No currency known — render a bare number with locale grouping.
    return new Intl.NumberFormat(getNumberLocale(), {
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)}`;
  }
}

function fmtDays(n: number | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (n === null || n === undefined) return '—';
  return t('risk.montecarlo.days_value', { defaultValue: '{{count}} days', count: n });
}

/**
 * Format a histogram bin's midpoint label.
 *
 * ``lower``/``upper`` arrive as Decimal-rendered strings on the wire, so both
 * operands are coerced with ``Number()`` *before* the addition — using the raw
 * values would string-concatenate ("100000.00" + "150000.00") and then ``/ 2``
 * would yield ``NaN``, rendering every bar's label as "NaN". Exported for a
 * focused regression test of that coercion.
 */
export function binMidpointLabel(
  bin: Pick<RiskHistogramBin, 'lower' | 'upper'>,
  currency: string,
  basis: 'cost' | 'schedule' | '' = 'cost',
): string {
  const mid = (Number(bin.lower) + Number(bin.upper)) / 2;
  if (basis === 'schedule') {
    return new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits: 0 }).format(mid);
  }
  return fmtCurrencyOrPlain(mid, currency);
}

function fmtRunTime(iso: string | null | undefined): string {
  if (!iso) return '';
  if (Number.isNaN(new Date(iso).getTime())) return '';
  // A date in the reader's language (month names), not the number preference.
  return fmtDate(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function MonteCarloTab({ projectId, currency }: MonteCarloTabProps) {
  const { t } = useTranslation();
  // The simulate call needs risk.update; a viewer would only collect a 403.
  const canRun = useHasPermission('risk.update');
  const addToast = useToastStore((s) => s.addToast);

  const qc = useQueryClient();
  const [iterations, setIterations] = useState<number>(ITERATIONS_DEFAULT);
  const [mode, setMode] = useState<RiskSimulateMode>('both');
  const [spreadPercent, setSpreadPercent] = useState<number>(Math.round(DEFAULT_IMPACT_SPREAD * 100));

  // The newest stored run, so the tab reopens on the last result instead of
  // an empty state.
  const runsKey = ['risk-simulations', projectId] as const;
  const lastRunQuery = useQuery({
    queryKey: runsKey,
    queryFn: () => listSimulationRuns(projectId, 1),
    enabled: !!projectId,
  });
  const result: RiskSimulationResult | null =
    (Array.isArray(lastRunQuery.data) ? lastRunQuery.data[0] : undefined) ?? null;

  const runMut = useMutation({
    mutationFn: () =>
      simulateRisk(projectId, { iterations, mode, impact_spread: spreadPercent / 100 }),
    onSuccess: (data) => {
      qc.setQueryData(runsKey, [data]);
      addToast({
        type: 'success',
        title: t('risk.montecarlo.run_done', {
          defaultValue: 'Simulation complete',
        }),
        message: t('risk.montecarlo.run_done_detail', {
          defaultValue: '{{iterations}} iterations across {{risks}} risks',
          iterations: data.iterations.toLocaleString(getNumberLocale()),
          risks: data.risk_count,
        }),
      });
    },
    onError: (e: Error) => {
      addToast({
        type: 'error',
        title: t('common.error', { defaultValue: 'Error' }),
        message: riskApiErrorMessage(e, t),
      });
    },
  });

  // Older snapshots carry no basis; their histogram was the cost one.
  const basis = result?.histogram_basis ?? (result ? 'cost' : '');

  // Build histogram data shape for Recharts — bins[i] -> { label, count }.
  const histogramData = useMemo(() => {
    if (!result || result.histogram_bins.length === 0) return [];
    return result.histogram_bins.map((b) => ({
      // Compact bin label — midpoint in money (project currency) or days.
      label: binMidpointLabel(b, currency, basis),
      count: b.count,
    }));
  }, [result, currency, basis]);

  const tornadoData = useMemo(() => {
    if (!result) return [];
    return result.tornado.slice(0, TORNADO_TOP_N).map((e) => ({
      code: e.code,
      // Decimal-as-string on the wire; coerce so the bar lengths are numeric.
      contribution: toNum(e.contribution),
    }));
  }, [result]);

  const fmtBasisValue = (v: number) =>
    basis === 'schedule' ? fmtDays(Math.round(v), t) : fmtCurrencyOrPlain(v, currency);

  const showCostChips = result && (result.mode === 'cost' || result.mode === 'both');
  const showScheduleChips = result && (result.mode === 'schedule' || result.mode === 'both');

  return (
    <div className="space-y-4">
      {/* ── Controls ──────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="mc-iterations"
              className="block text-xs font-medium text-content-secondary mb-1.5 uppercase tracking-wide"
            >
              {t('risk.montecarlo.iterations', { defaultValue: 'Iterations' })}
            </label>
            <input
              id="mc-iterations"
              type="number"
              min={ITERATIONS_MIN}
              max={ITERATIONS_MAX}
              step={1000}
              value={iterations}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) {
                  setIterations(Math.max(ITERATIONS_MIN, Math.min(v, ITERATIONS_MAX)));
                }
              }}
              className="h-10 w-32 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
            />
            <p className="mt-1 text-2xs text-content-tertiary">
              {t('risk.montecarlo.iterations_hint', {
                defaultValue: '1,000 – 100,000',
              })}
            </p>
          </div>

          <div>
            <label
              htmlFor="mc-mode"
              className="block text-xs font-medium text-content-secondary mb-1.5 uppercase tracking-wide"
            >
              {t('risk.montecarlo.mode', { defaultValue: 'Mode' })}
            </label>
            <select
              id="mc-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as RiskSimulateMode)}
              className="h-10 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
            >
              <option value="both">
                {t('risk.montecarlo.mode_both', { defaultValue: 'Cost + Schedule' })}
              </option>
              <option value="cost">
                {t('risk.montecarlo.mode_cost', { defaultValue: 'Cost only' })}
              </option>
              <option value="schedule">
                {t('risk.montecarlo.mode_schedule', { defaultValue: 'Schedule only' })}
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="mc-spread"
              className="block text-xs font-medium text-content-secondary mb-1.5 uppercase tracking-wide"
            >
              {t('risk.montecarlo.spread', { defaultValue: 'Impact spread' })}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-content-secondary">±</span>
              <input
                id="mc-spread"
                type="number"
                min={0}
                max={SPREAD_PERCENT_MAX}
                step={5}
                value={spreadPercent}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) setSpreadPercent(Math.max(0, Math.min(v, SPREAD_PERCENT_MAX)));
                }}
                className="h-10 w-20 rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
              />
              <span className="text-sm text-content-secondary">%</span>
            </div>
            <p className="mt-1 text-2xs text-content-tertiary max-w-[220px]">
              {t('risk.montecarlo.spread_hint', {
                defaultValue: 'Around the stated impact, for risks without a three-point estimate.',
              })}
            </p>
          </div>

          <Button
            variant="primary"
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending || !projectId || !canRun}
            title={
              canRun
                ? undefined
                : t('risk.montecarlo.run_needs_editor', {
                    defaultValue: 'Running a simulation needs the editor role.',
                  })
            }
            icon={
              runMut.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )
            }
          >
            {runMut.isPending
              ? t('risk.montecarlo.running', { defaultValue: 'Running…' })
              : t('risk.montecarlo.run', { defaultValue: 'Run simulation' })}
          </Button>
        </div>
      </Card>

      {/* ── Last-run chips ────────────────────────────────────────── */}
      {result && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-content-tertiary" />
              <h3 className="text-sm font-semibold text-content-primary">
                {t('risk.montecarlo.last_run', {
                  defaultValue: 'Last run - {{risks}} risks, {{iterations}} iterations',
                  risks: result.risk_count,
                  iterations: result.iterations.toLocaleString(getNumberLocale()),
                })}
              </h3>
            </div>
            {(result.created_at || result.seed != null) && (
              <p className="text-2xs text-content-tertiary">
                {t('risk.montecarlo.run_meta', {
                  defaultValue: '{{when}} · seed {{seed}} · impact spread ±{{spread}} %',
                  when: fmtRunTime(result.created_at),
                  seed: result.seed ?? '—',
                  spread: Math.round((result.impact_spread ?? DEFAULT_IMPACT_SPREAD) * 100),
                })}
              </p>
            )}
          </div>

          {result.risk_count === 0 ? (
            <EmptyState
              icon={<AlertTriangle size={24} strokeWidth={1.5} />}
              title={t('risk.montecarlo.no_risks', {
                defaultValue: 'No risks to simulate',
              })}
              description={t('risk.montecarlo.no_risks_desc', {
                defaultValue:
                  'Add risks to the register first; the simulation has nothing to sample.',
              })}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {showCostChips && (
                <>
                  <Chip
                    label={t('risk.montecarlo.p50_cost', { defaultValue: 'P50 Cost' })}
                    value={fmtCurrencyOrPlain(result.p50_cost, currency)}
                    tone="success"
                  />
                  <Chip
                    label={t('risk.montecarlo.p80_cost', { defaultValue: 'P80 Cost' })}
                    value={fmtCurrencyOrPlain(result.p80_cost, currency)}
                    tone="warning"
                  />
                  <Chip
                    label={t('risk.montecarlo.p95_cost', { defaultValue: 'P95 Cost' })}
                    value={fmtCurrencyOrPlain(result.p95_cost, currency)}
                    tone="error"
                  />
                </>
              )}
              {showScheduleChips && (
                <>
                  <Chip
                    label={t('risk.montecarlo.p50_schedule', {
                      defaultValue: 'P50 Schedule',
                    })}
                    value={fmtDays(result.p50_schedule_days, t)}
                    tone="success"
                  />
                  <Chip
                    label={t('risk.montecarlo.p80_schedule', {
                      defaultValue: 'P80 Schedule',
                    })}
                    value={fmtDays(result.p80_schedule_days, t)}
                    tone="warning"
                  />
                  <Chip
                    label={t('risk.montecarlo.p95_schedule', {
                      defaultValue: 'P95 Schedule',
                    })}
                    value={fmtDays(result.p95_schedule_days, t)}
                    tone="error"
                  />
                </>
              )}
            </div>
          )}

          {result.risk_count > 0 && (
            <div className="mt-3 space-y-1 text-xs text-content-secondary">
              {showCostChips && result.mean_cost != null && result.emv_cost != null && (
                <p>
                  {t('risk.montecarlo.mean_vs_emv_cost', {
                    defaultValue: 'Mean cost {{mean}} · register EMV {{emv}} (Σ probability × cost impact)',
                    mean: fmtCurrencyOrPlain(result.mean_cost, currency),
                    emv: fmtCurrencyOrPlain(result.emv_cost, currency),
                  })}
                </p>
              )}
              {showScheduleChips && result.mean_schedule_days != null && result.emv_schedule_days != null && (
                <p>
                  {t('risk.montecarlo.mean_vs_emv_schedule', {
                    defaultValue: 'Mean delay {{mean}} · expected delay {{emv}} (Σ probability × days)',
                    mean: fmtDays(Math.round(result.mean_schedule_days), t),
                    emv: fmtDays(Math.round(result.emv_schedule_days), t),
                  })}
                </p>
              )}
              {result.mixed_currency && (
                <p className="text-amber-700 dark:text-amber-300">
                  {t('risk.montecarlo.mixed_currency', {
                    defaultValue:
                      'Cost figures are hidden: the risks are in more than one currency and cannot be summed.',
                  })}
                </p>
              )}
              <p className="text-content-tertiary">
                {t('risk.montecarlo.method', {
                  defaultValue:
                    'Each iteration decides for every risk whether it occurs, with its probability, and draws the impact of those that do from a triangular distribution: the three-point estimate when there is one, otherwise the spread around the stated impact.',
                })}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* ── Histogram ─────────────────────────────────────────────── */}
      {result && histogramData.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-content-primary mb-3">
            {basis === 'schedule'
              ? t('risk.montecarlo.histogram_schedule', {
                  defaultValue: 'Distribution of total delay (days)',
                })
              : t('risk.montecarlo.histogram', {
                  defaultValue: 'Contingency distribution',
                })}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={histogramData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={8}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value) => [
                  value,
                  t('risk.montecarlo.histogram_count', { defaultValue: 'Iterations' }),
                ]}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Tornado ───────────────────────────────────────────────── */}
      {result && tornadoData.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-content-primary mb-3">
            {t('risk.montecarlo.tornado', {
              defaultValue: 'Top contributors (tornado)',
            })}
          </h3>
          <ResponsiveContainer width="100%" height={Math.max(200, tornadoData.length * 32)}>
            <BarChart data={tornadoData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="code" tick={{ fontSize: 10 }} width={70} />
              <Tooltip
                formatter={(value) => fmtBasisValue(typeof value === 'number' ? value : Number(value))}
              />
              <Bar dataKey="contribution" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Empty state when no run yet ────────────────────────────── */}
      {!result && !runMut.isPending && !lastRunQuery.isLoading && (
        <Card className="p-6">
          <EmptyState
            icon={<TrendingUp size={28} strokeWidth={1.5} />}
            title={t('risk.montecarlo.empty', {
              defaultValue: 'No simulation run yet',
            })}
            description={t('risk.montecarlo.empty_desc', {
              defaultValue:
                'Run a Monte Carlo simulation to model project contingency from your risk register. P50, P80 and P95 confidence bands tell you how much budget reserve to hold against cost and schedule risk.',
            })}
          />
        </Card>
      )}
    </div>
  );
}

/* ── Chip helper ───────────────────────────────────────────────────── */

interface ChipProps {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'error';
}

function Chip({ label, value, tone }: ChipProps) {
  const toneCls: Record<ChipProps['tone'], string> = {
    success: 'bg-green-50 dark:bg-green-950/30 text-semantic-success',
    warning: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    error: 'bg-red-50 dark:bg-red-950/30 text-semantic-error',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${toneCls[tone]}`}>
      <p className="text-2xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default MonteCarloTab;
