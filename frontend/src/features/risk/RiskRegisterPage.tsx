// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { Fragment, useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { fetchAllPages } from '@/shared/lib/apiHelpers';
import {
  ShieldAlert, Plus, ChevronRight, ArrowLeft, DollarSign,
  AlertTriangle, Shield, Trash2, X, Search, Filter, CalendarDays, TrendingUp,
  LayoutGrid, Activity, Network, ArrowRight,
} from 'lucide-react';
import { Button, Card, Badge, EmptyState, Breadcrumb, ConfirmDialog, DismissibleInfo, IntroRichText, RecoveryCard, SkeletonTable, SkeletonCard, ModuleGuideButton, CollapsibleSection } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { MultiCurrencyTotal } from '@/shared/ui/MultiCurrencyTotal';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { PlanningCrossLinks } from '@/features/schedule/PlanningCrossLinks';
import SimilarItemsPanel from '@/shared/ui/SimilarItemsPanel';
import { UserSearchInput } from '@/shared/ui/UserSearchInput';
import { apiGet, apiPost, apiPatch, apiDelete, type Page } from '@/shared/lib/api';
import { fetchProjectList } from '@/shared/lib/projectList';
import { fmtPercent, fmtFixed } from '@/shared/lib/formatters';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { useTabKeyboardNav } from '@/shared/hooks/useTabKeyboardNav';
import { MonteCarloTab } from './MonteCarloTab';
import { ContingencyCard } from './ContingencyCard';
import { riskGuide } from './riskGuide';
import { InsightsPanel, InsightsToggleButton, useModuleInsights } from '@/features/insights';
import { buildRiskInsights } from './riskInsights';
import { checkRiskDraft, riskApiErrorMessage, riskApiFieldErrors } from './riskValidation';
import { toNum } from '@/shared/lib/money';
import { getNumberLocale } from '@/stores/usePreferencesStore';

const RISK_TAB_IDS = ['register', 'montecarlo'] as const;
type RiskTab = (typeof RISK_TAB_IDS)[number];

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Project { id: string; name: string; currency: string }

interface RiskItem {
  id: string; project_id: string; code: string; title: string; description: string;
  category: string; probability: number; impact_cost: number; impact_schedule_days: number;
  impact_severity: string; risk_score: number; status: string; mitigation_strategy: string;
  contingency_plan: string; owner_name: string; owner_user_id?: string | null;
  response_cost: number; currency: string;
  probability_score?: number | null; impact_score_cost?: number | null;
  // The 5x5 matrix position from the server: score 1-25 and its tier, the one
  // scale the matrix, the cards and the table share.
  matrix_score?: number | null; risk_tier?: string | null;
  // weight x cost impact: this risk's share of the register EMV.
  expected_value?: number | string;
  // Auto-escalation (TOP-30 #24): set server-side when the risk crosses the
  // escalation threshold or its review date lapses.
  escalated?: boolean;
  escalated_at?: string | null;
  escalation_trigger?: string | null;
  escalation_threshold?: number | null;
  metadata: Record<string, unknown>; created_at: string; updated_at: string;
}

interface RiskSummary {
  total_risks: number; by_status: Record<string, number>; by_category: Record<string, number>;
  high_critical_count: number; total_exposure: number; mitigated_count: number; currency: string;
  // Per-currency exposure breakdown. The backend deliberately returns
  // total_exposure = 0 when risks span more than one currency (it refuses
  // to sum unconverted amounts) and puts the real figures here. The UI
  // must read this instead of rendering a misleading "0".
  exposure_by_currency?: Record<string, number>;
}

interface MatrixCell {
  probability_level: string; impact_level: string; count: number; risk_ids: string[];
  // 1-5 axes, their product and the tier band, all computed by the server.
  probability_score: number; impact_score: number; score: number; tier: string;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

// Must mirror the backend STATUS_VALUES vocabulary (schemas.py) exactly —
// seed/demo data uses 'open', 'monitoring' and 'mitigated', which were
// previously missing here, so seeded risks couldn't be filtered, their
// status badges fell back to neutral, and the edit <select> dropped the
// current value (silently changing it on save).
const STATUS_COLORS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  identified: 'blue', assessed: 'warning', mitigating: 'success', monitoring: 'warning',
  mitigated: 'success', open: 'blue', closed: 'neutral', occurred: 'error',
};
// Mirror the backend category set used by seed data (which includes
// 'procurement') so seeded risks remain filterable.
const CATEGORIES = ['technical', 'financial', 'schedule', 'regulatory', 'environmental', 'safety', 'procurement'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['identified', 'assessed', 'mitigating', 'monitoring', 'mitigated', 'open', 'closed', 'occurred'];
// English fallbacks for the computed `risk.cat_*` / `risk.status_*` keys. The
// defaultValue used to be the raw value, so before the key lands in a locale
// the screen shows the bare enum token ('mitigating', 'procurement') to every
// reader, English included. Unknown values still fall through to the raw token.
const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technical', financial: 'Financial', schedule: 'Schedule', regulatory: 'Regulatory',
  environmental: 'Environmental', safety: 'Safety', procurement: 'Procurement',
};
const STATUS_LABELS: Record<string, string> = {
  identified: 'Identified', assessed: 'Assessed', mitigating: 'Mitigating', monitoring: 'Monitoring',
  mitigated: 'Mitigated', open: 'Open', closed: 'Closed', occurred: 'Occurred',
};
// Probability rows of the matrix, high to low: the 1-5 score the server gives
// a probability (<= 20 % is 1, <= 40 % is 2, ... above 80 % is 5).
const PROB_ROWS: { score: number; key: string; fallback: string; upTo: number | null }[] = [
  { score: 5, key: 'risk.probability_very_high', fallback: 'Very High', upTo: null },
  { score: 4, key: 'risk.probability_high', fallback: 'High', upTo: 80 },
  { score: 3, key: 'risk.probability_medium', fallback: 'Medium', upTo: 60 },
  { score: 2, key: 'risk.probability_low', fallback: 'Low', upTo: 40 },
  { score: 1, key: 'risk.probability_very_low', fallback: 'Very Low', upTo: 20 },
];
// Tier bands of the matrix score (probability score x impact score, 1-25).
// Same bands as the server's risk_tier.
const TIER_BANDS: { tier: string; min: number; max: number; cls: string; key: string; fallback: string }[] = [
  { tier: 'low', min: 1, max: 4, cls: 'bg-green-400/70 text-gray-900', key: 'risk.legend_low', fallback: 'Low' },
  { tier: 'medium', min: 5, max: 9, cls: 'bg-yellow-400/80 text-gray-900', key: 'risk.legend_medium', fallback: 'Medium' },
  { tier: 'high', min: 10, max: 15, cls: 'bg-orange-400/80 text-white', key: 'risk.legend_high', fallback: 'High' },
  { tier: 'critical', min: 16, max: 25, cls: 'bg-red-500/80 text-white', key: 'risk.legend_critical', fallback: 'Critical' },
];
const TIER_BADGE: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  low: 'success', medium: 'blue', high: 'warning', critical: 'error',
};
function tierLabel(tier: string | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const band = TIER_BANDS.find((b) => b.tier === tier);
  return band ? t(band.key, { defaultValue: band.fallback }) : '-';
}
const IMPACT_LEVELS = ['very_low', 'low', 'medium', 'high', 'critical'];
const IMPACT_LABEL_FALLBACK: Record<string, string> = {
  very_low: 'Very Low', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};

const selectCls = 'h-8 rounded-lg border border-border bg-surface-primary px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue transition-colors pr-7 appearance-none cursor-pointer';

function fmtCur(n: number, c = 'EUR') {
  const s = /^[A-Z]{3}$/.test(c) ? c : 'EUR';
  try { return new Intl.NumberFormat(getNumberLocale(), { style: 'currency', currency: s, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n); }
  catch { return `${fmtFixed(n, 0)} ${s}`; }
}

/* ── Risk Matrix ──────────────────────────────────────────────────────── */

/**
 * The one risk matrix of the register: probability score (1-5) by impact
 * score (1-5). Cells, scores and tiers come from the server (`/matrix/`), so
 * the colours, the legend, the "High / Critical" card and each row's tier in
 * the table all read the same bands.
 */
function RiskMatrix({ cells }: { cells: MatrixCell[] }) {
  const { t } = useTranslation();
  const map = useMemo(() => {
    const m: Record<string, MatrixCell> = {};
    for (const c of cells) m[`${c.probability_score}|${c.impact_score}`] = c;
    return m;
  }, [cells]);
  const tierCls = (tier: string) => TIER_BANDS.find((b) => b.tier === tier)?.cls ?? 'bg-surface-secondary text-content-quaternary';

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-content-primary mb-1">{t('risk.matrix', { defaultValue: 'Risk Matrix' })}</h3>
      <p className="text-2xs text-content-tertiary mb-3">
        {t('risk.matrix_formula', {
          defaultValue: 'Score = probability score (1-5) × impact score (1-5), from 1 to 25.',
        })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="p-1 text-left text-content-tertiary w-28">{t('risk.probability', { defaultValue: 'Probability' })}</th>
              {IMPACT_LEVELS.map((i, idx) => (
                <th key={i} className="p-1 text-center text-content-tertiary">
                  {t(`risk.impact_${i}`, { defaultValue: IMPACT_LABEL_FALLBACK[i] ?? i })}
                  <span className="block text-2xs font-normal opacity-70">{idx + 1}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROB_ROWS.map((row) => (
              <tr key={row.score}>
                <td className="p-1 text-content-secondary font-medium">
                  {t(row.key, { defaultValue: row.fallback })}
                  <span className="block text-2xs font-normal text-content-tertiary">
                    {row.upTo === null
                      ? t('risk.matrix_prob_above', { defaultValue: '> {{min}} %', min: 80 })
                      : t('risk.matrix_prob_upto', { defaultValue: '≤ {{max}} %', max: row.upTo })}
                    {' · '}{row.score}
                  </span>
                </td>
                {IMPACT_LEVELS.map((_, idx) => {
                  const impactScore = idx + 1;
                  const cell = map[`${row.score}|${impactScore}`];
                  const count = cell?.count ?? 0;
                  const score = cell?.score ?? row.score * impactScore;
                  return (
                    <td key={impactScore} className="p-1">
                      <div
                        className={`flex items-center justify-center h-10 rounded-md text-sm font-bold ${count > 0 && cell ? tierCls(cell.tier) : 'bg-surface-secondary text-content-quaternary'}`}
                        title={t('risk.matrix_cell_title', {
                          defaultValue: '{{p}} × {{i}} = {{score}} ({{tier}}), {{count}} risk(s)',
                          p: row.score, i: impactScore, score, tier: tierLabel(cell?.tier, t), count,
                        })}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-2xs text-content-tertiary">
        {TIER_BANDS.map((b) => (
          <span key={b.tier} className="flex items-center gap-1">
            <span className={`inline-block w-3 h-3 rounded ${b.cls.split(' ')[0]}`} />
            {t('risk.tier_band', {
              defaultValue: '{{tier}} ({{min}}-{{max}})',
              tier: t(b.key, { defaultValue: b.fallback }), min: b.min, max: b.max,
            })}
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ── Input helper ──────────────────────────────────────────────────────── */

const inputCls = 'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';
const textareaCls = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none';

/* ── Create Dialog ─────────────────────────────────────────────────────── */

// Probability is typed in percent (the scale the table shows); it is sent as
// a 0-1 fraction.
const INITIAL_RISK_FORM = { title: '', description: '', category: 'technical', probabilityPercent: '50', impactSeverity: 'medium', impactCost: 0, scheduleDays: 0, ownerName: '', ownerUserId: '' };

function CreateDialog({ projectId, currency, onClose, onCreated }: { projectId: string; currency: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [f, setF] = useState(INITIAL_RISK_FORM);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: unknown) => {
    setF((p) => ({ ...p, [k]: v }));
    setServerErrors({});
  };
  const check = checkRiskDraft(
    { probabilityPercent: f.probabilityPercent, impactCost: f.impactCost, scheduleDays: f.scheduleDays },
    t,
  );
  const hasErrors = Object.keys(check.errors).length > 0;
  const fieldError = (local: keyof typeof check.errors, server: string) =>
    (touched ? check.errors[local] : undefined) ?? serverErrors[server];

  const mut = useMutation({
    mutationFn: () => apiPost<RiskItem>('/v1/risk/', {
      project_id: projectId,
      title: f.title,
      description: f.description,
      category: f.category,
      probability: check.probability,
      impact_severity: f.impactSeverity,
      impact_cost: f.impactCost,
      impact_schedule_days: f.scheduleDays,
      owner_name: f.ownerName,
      owner_user_id: f.ownerUserId || undefined,
      currency,
    }),
    onSuccess: () => { onCreated(); onClose(); addToast({ type: 'success', title: t('risk.created', { defaultValue: 'Risk created' }) }); },
    onError: (e: Error) => {
      setServerErrors(riskApiFieldErrors(e, t));
      addToast({ type: 'error', title: t('common.error', { defaultValue: 'Error' }), message: riskApiErrorMessage(e, t) });
    },
  });
  const submit = () => {
    setTouched(true);
    if (hasErrors) return;
    mut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="risk-create-title" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-surface-primary p-6 shadow-xl border border-border max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 id="risk-create-title" className="text-lg font-semibold text-content-primary">{t('risk.new', { defaultValue: 'New Risk' })}</h2>
          <button onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="text-content-tertiary hover:text-content-primary"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="risk-title" className="block text-sm font-medium text-content-primary mb-1.5">{t('common.title', { defaultValue: 'Title' })} *</label>
            <input id="risk-title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={t('risk.title_placeholder', { defaultValue: 'e.g. Foundation soil instability' })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="risk-description" className="block text-sm font-medium text-content-primary mb-1.5">{t('common.description', { defaultValue: 'Description' })}</label>
            <textarea id="risk-description" value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} className={textareaCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="risk-category" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.category', { defaultValue: 'Category' })}</label>
              <select id="risk-category" value={f.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(`risk.cat_${c}`, { defaultValue: CATEGORY_LABELS[c] ?? c })}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="risk-severity" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.severity', { defaultValue: 'Impact Severity' })}</label>
              <select id="risk-severity" value={f.impactSeverity} onChange={(e) => set('impactSeverity', e.target.value)} className={inputCls}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{t(`risk.severity_${s}`, { defaultValue: s })}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="risk-probability" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.probability_percent', { defaultValue: 'Probability (%)' })}</label>
              <input
                id="risk-probability"
                type="text"
                inputMode="decimal"
                value={f.probabilityPercent}
                onChange={(e) => set('probabilityPercent', e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={!!fieldError('probability', 'probability')}
                aria-describedby="risk-probability-hint"
                className={inputCls + (fieldError('probability', 'probability') ? ' border-semantic-error' : '')}
              />
              <p id="risk-probability-hint" className={`mt-1 text-2xs ${fieldError('probability', 'probability') ? 'text-semantic-error' : 'text-content-tertiary'}`}>
                {fieldError('probability', 'probability') ?? t('risk.probability_hint', { defaultValue: '0 to 100 %' })}
              </p>
            </div>
            <div>
              <label htmlFor="risk-impact-cost" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.impact_cost', { defaultValue: 'Cost Impact' })}</label>
              <input id="risk-impact-cost" type="number" min={0} step="any" value={f.impactCost} onChange={(e) => set('impactCost', parseFloat(e.target.value) || 0)} aria-invalid={!!fieldError('impactCost', 'impact_cost')} className={inputCls} />
              {fieldError('impactCost', 'impact_cost') && <p className="mt-1 text-2xs text-semantic-error">{fieldError('impactCost', 'impact_cost')}</p>}
            </div>
            <div>
              <label htmlFor="risk-schedule-days" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.schedule_days', { defaultValue: 'Days' })}</label>
              <input id="risk-schedule-days" type="number" min={0} step={1} value={f.scheduleDays} onChange={(e) => set('scheduleDays', parseInt(e.target.value) || 0)} aria-invalid={!!fieldError('scheduleDays', 'impact_schedule_days')} className={inputCls} />
              {fieldError('scheduleDays', 'impact_schedule_days') && <p className="mt-1 text-2xs text-semantic-error">{fieldError('scheduleDays', 'impact_schedule_days')}</p>}
            </div>
          </div>
          <div>
            <label htmlFor="risk-owner" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.owner', { defaultValue: 'Risk Owner' })}</label>
            <UserSearchInput
              value={f.ownerUserId}
              displayValue={f.ownerName}
              onChange={(uid, name) => setF((p) => ({ ...p, ownerUserId: uid, ownerName: name }))}
              placeholder={t('risk.owner_placeholder', { defaultValue: 'Search team members...' })}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button variant="primary" disabled={!f.title.trim() || mut.isPending || (touched && hasErrors)} onClick={submit}>
            {mut.isPending ? t('common.creating', { defaultValue: 'Creating...' }) : t('common.create', { defaultValue: 'Create' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail View ───────────────────────────────────────────────────────── */

function DetailView({ riskId, onBack }: { riskId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { data: risk, isLoading } = useQuery({ queryKey: ['risk', riskId], queryFn: () => apiGet<RiskItem>(`/v1/risk/${riskId}`) });

  const [editing, setEditing] = useState(false);
  const [ef, setEf] = useState({ status: '', mitigation: '', contingency: '' });

  const startEdit = useCallback(() => {
    if (!risk) return;
    setEf({ status: risk.status, mitigation: risk.mitigation_strategy, contingency: risk.contingency_plan });
    setEditing(true);
  }, [risk]);

  const upd = useMutation({
    mutationFn: (p: Record<string, unknown>) => apiPatch<RiskItem>(`/v1/risk/${riskId}`, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['risk'] }); qc.invalidateQueries({ queryKey: ['risks'] }); qc.invalidateQueries({ queryKey: ['risk-summary'] }); qc.invalidateQueries({ queryKey: ['risk-matrix'] }); qc.invalidateQueries({ queryKey: ['risk-contingency'] }); setEditing(false); addToast({ type: 'success', title: t('risk.updated', { defaultValue: 'Risk updated' }) }); },
    onError: (e: Error) => addToast({ type: 'error', title: t('common.error', { defaultValue: 'Error' }), message: riskApiErrorMessage(e, t) }),
  });

  if (isLoading || !risk) return <SkeletonCard className="my-6" />;

  return (
    <div>
      <div className="mb-6">
        <button onClick={onBack} aria-label={t('common.back', { defaultValue: 'Back' })} className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content-primary mb-3"><ArrowLeft size={14} />{t('common.back', { defaultValue: 'Back' })}</button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-content-primary">{risk.code}</h2>
              <Badge variant={STATUS_COLORS[risk.status] || 'neutral'}>{t(`risk.status_${risk.status}`, { defaultValue: STATUS_LABELS[risk.status] ?? risk.status })}</Badge>
              <Badge variant="neutral">{t(`risk.cat_${risk.category}`, { defaultValue: CATEGORY_LABELS[risk.category] ?? risk.category })}</Badge>
              {risk.escalated && (
                <Badge variant="error">
                  <AlertTriangle size={12} className="mr-1 inline" />
                  {risk.escalation_trigger === 'review_lapsed'
                    ? t('risk.escalated_review', { defaultValue: 'Escalated: review lapsed' })
                    : t('risk.escalated_severity', { defaultValue: 'Escalated: severity' })}
                </Badge>
              )}
            </div>
            <h3 className="mt-1 text-lg text-content-secondary">{risk.title}</h3>
            {risk.description && <p className="mt-2 text-sm text-content-tertiary max-w-2xl">{risk.description}</p>}
          </div>
          {!editing && <Button variant="secondary" size="sm" onClick={startEdit}>{t('common.edit', { defaultValue: 'Edit' })}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          [t('risk.probability', { defaultValue: 'Probability' }), fmtPercent(risk.probability * 100, 0)],
          [t('risk.severity', { defaultValue: 'Severity' }), t(`risk.severity_${risk.impact_severity}`, { defaultValue: risk.impact_severity })],
          [t('risk.matrix_score', { defaultValue: 'Matrix score (1-25)' }), risk.matrix_score != null ? `${risk.matrix_score} · ${tierLabel(risk.risk_tier, t)}` : '-'],
          [t('risk.impact_cost', { defaultValue: 'Cost Impact' }), fmtCur(risk.impact_cost, risk.currency)],
          [t('risk.exposure_emv', { defaultValue: 'Exposure (EMV)' }), fmtCur(toNum(risk.expected_value ?? 0), risk.currency)],
          [t('risk.owner', { defaultValue: 'Owner' }), risk.owner_name || '-'],
        ].map(([label, val]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-content-tertiary uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold text-content-primary capitalize">{val}</p>
          </Card>
        ))}
      </div>

      {/* Cross-module impact: a risk with schedule/cost impact ties back to
          the 4D Schedule (timeline buffer) and the 5D Cost Model
          (contingency). Make those relationships navigable. */}
      {(risk.impact_schedule_days > 0 || risk.impact_cost > 0) && (
        <Card className="p-4 mb-6">
          <p className="text-xs text-content-tertiary uppercase tracking-wide mb-2">
            {t('risk.cross_impact', { defaultValue: 'Project Impact' })}
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {risk.impact_schedule_days > 0 && (
              <div className="flex items-center gap-2">
                <CalendarDays size={15} className="text-content-tertiary" />
                <span className="text-sm text-content-primary">
                  {t('risk.schedule_impact_value', {
                    defaultValue: '+{{days}} days schedule slip',
                    days: risk.impact_schedule_days,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/schedule')}
                  className="text-xs font-medium text-oe-blue hover:underline"
                >
                  {t('risk.open_schedule', { defaultValue: 'View 4D Schedule' })}
                </button>
              </div>
            )}
            {risk.impact_cost > 0 && (
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-content-tertiary" />
                <span className="text-sm text-content-primary">
                  {t('risk.cost_impact_value', {
                    defaultValue: '{{amount}} cost exposure',
                    amount: fmtCur(risk.impact_cost, risk.currency),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/5d')}
                  className="text-xs font-medium text-oe-blue hover:underline"
                >
                  {t('risk.open_5d', { defaultValue: 'Reflect in 5D contingency' })}
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {editing ? (
        <Card className="p-5 space-y-4">
          <div>
            <label htmlFor="risk-edit-status" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.status', { defaultValue: 'Status' })}</label>
            <select id="risk-edit-status" value={ef.status} onChange={(e) => setEf((p) => ({ ...p, status: e.target.value }))} className={inputCls + ' max-w-xs'}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`risk.status_${s}`, { defaultValue: STATUS_LABELS[s] ?? s })}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="risk-edit-mitigation" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.mitigation', { defaultValue: 'Mitigation Strategy' })}</label>
            <textarea id="risk-edit-mitigation" value={ef.mitigation} onChange={(e) => setEf((p) => ({ ...p, mitigation: e.target.value }))} rows={3} className={textareaCls} />
          </div>
          <div>
            <label htmlFor="risk-edit-contingency" className="block text-sm font-medium text-content-primary mb-1.5">{t('risk.contingency', { defaultValue: 'Contingency Plan' })}</label>
            <textarea id="risk-edit-contingency" value={ef.contingency} onChange={(e) => setEf((p) => ({ ...p, contingency: e.target.value }))} rows={3} className={textareaCls} />
          </div>
          <div className="flex gap-3">
            <Button variant="primary" size="sm" disabled={upd.isPending} onClick={() => upd.mutate({ status: ef.status, mitigation_strategy: ef.mitigation, contingency_plan: ef.contingency })}>
              {upd.isPending ? t('common.saving', { defaultValue: 'Saving...' }) : t('common.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4">
            <p className="text-xs text-content-tertiary uppercase tracking-wide mb-2">{t('risk.mitigation', { defaultValue: 'Mitigation Strategy' })}</p>
            <p className="text-sm text-content-primary whitespace-pre-wrap">{risk.mitigation_strategy || t('risk.no_mitigation', { defaultValue: 'No mitigation strategy defined' })}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-content-tertiary uppercase tracking-wide mb-2">{t('risk.contingency', { defaultValue: 'Contingency Plan' })}</p>
            <p className="text-sm text-content-primary whitespace-pre-wrap">{risk.contingency_plan || t('risk.no_contingency', { defaultValue: 'No contingency plan defined' })}</p>
          </Card>
        </div>
      )}

      {/* Cross-project lessons learned via semantic search.  Defaults to
          cross_project=true so the panel surfaces similar risks (and their
          mitigations) from EVERY project the user has access to. */}
      <div className="mt-6">
        <SimilarItemsPanel module="risks" id={risk.id} crossProject limit={6} />
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

/* ── How it works + connects ─────────────────────────────────────────── */

/** Compact inline link to a sibling module, keeping the flow copy readable. */
function ModLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="font-medium text-oe-blue-text hover:underline">
      {children}
    </Link>
  );
}

/**
 * One-glance explainer: what the Risk Register does and how it connects. Risks
 * are logged with probability and impact, read on a matrix, simulated with
 * Monte Carlo, then their schedule and cost impacts flow into the 4D Schedule,
 * Project Controls and Reports.
 */
function HowRiskWork() {
  const { t } = useTranslation();

  const steps: { icon: React.ReactNode; title: string; desc: string }[] = [
    {
      icon: <ShieldAlert size={14} className="text-oe-blue" />,
      title: t('risk.flow_1_title', { defaultValue: 'Log risks' }),
      desc: t('risk.flow_1_desc', {
        defaultValue: 'Capture threats with probability, cost and schedule impact and an owner.',
      }),
    },
    {
      icon: <LayoutGrid size={14} className="text-oe-blue" />,
      title: t('risk.flow_2_title', { defaultValue: 'Score and map' }),
      desc: t('risk.flow_2_desc_matrix', {
        defaultValue: 'Read exposure on one 5x5 probability-by-impact matrix.',
      }),
    },
    {
      icon: <Activity size={14} className="text-oe-blue" />,
      title: t('risk.flow_3_title', { defaultValue: 'Simulate' }),
      desc: t('risk.flow_3_desc', {
        defaultValue: 'Run a Monte Carlo over the register for P50, P80 and P95 confidence.',
      }),
    },
    {
      icon: <Shield size={14} className="text-oe-blue" />,
      title: t('risk.flow_4_title', { defaultValue: 'Mitigate and connect' }),
      desc: t('risk.flow_4_desc', {
        defaultValue: 'Plan mitigations; schedule and cost impacts flow into planning and reporting.',
      }),
    },
  ];

  return (
    <CollapsibleSection
      storageKey="risk.how"
      icon={<Network size={15} className="text-oe-blue" />}
      title={t('risk.flow_title', { defaultValue: 'How the Risk Register fits together' })}
    >
      <p className="text-xs text-content-tertiary">
        {t('risk.flow_intro', {
          defaultValue:
            'Surface project threats before they cost money: log them, score them on the matrix, simulate the range, then feed the impacts into planning and reporting.',
        })}
      </p>

      <ol className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {steps.map((s, i) => (
          <Fragment key={s.title}>
            <li className="flex-1 rounded-lg border border-border-light bg-surface-secondary/40 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oe-blue-subtle text-2xs font-bold text-oe-blue-text">
                  {i + 1}
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-content-primary">
                  {s.icon}
                  {s.title}
                </span>
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-content-tertiary">{s.desc}</p>
            </li>
            {i < steps.length - 1 && (
              <li
                aria-hidden="true"
                className="hidden shrink-0 items-center self-center text-content-quaternary lg:flex"
              >
                <ArrowRight size={16} />
              </li>
            )}
          </Fragment>
        ))}
      </ol>

      <div className="mt-3 flex flex-col gap-1.5 border-t border-border-light pt-3 text-2xs text-content-tertiary sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1">
        <span>
          <span className="font-medium text-content-secondary">
            {t('risk.flow_connects', { defaultValue: 'Connects with:' })}
          </span>{' '}
          <ModLink to="/schedule">
            {t('risk.mod_schedule', { defaultValue: '4D Schedule' })}
          </ModLink>{' '}
          ·{' '}
          <ModLink to="/project-controls">
            {t('risk.mod_controls', { defaultValue: 'Project Controls' })}
          </ModLink>{' '}
          · <ModLink to="/reports">{t('risk.mod_reports', { defaultValue: 'Reports' })}</ModLink>{' '}
          ·{' '}
          <ModLink to="/finance?tab=budgets">
            {t('risk.mod_finance_budget', { defaultValue: 'Finance budget' })}
          </ModLink>
        </span>
      </div>
    </CollapsibleSection>
  );
}

export function RiskRegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  // Quantitative Monte Carlo lives in its own tab next to the existing
  // qualitative register so the 5x5 matrix view stays the default — most
  // users land here to triage and edit risks, not to re-run simulations.
  const [activeTab, setActiveTab] = useState<RiskTab>('register');
  // Arrow-key navigation across the Register / Monte Carlo tabs (WCAG 2.1.1).
  const onTabKeyDown = useTabKeyboardNav<RiskTab>({
    ids: RISK_TAB_IDS,
    activeId: activeTab,
    onChange: setActiveTab,
    orientation: 'horizontal',
  });

  // Deep-link auto-select: Cmd+Shift+K global search lands here with
  // ?id=<risk_id> — open the matching risk detail view immediately and
  // strip the query param so a refresh doesn't reopen it forever.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const deepLinkId = searchParams.get('id');
    if (deepLinkId && deepLinkId !== selectedRiskId) {
      setSelectedRiskId(deepLinkId);
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedRiskId, setSearchParams]);

  // Deep-link to a tab: the retired standalone Monte Carlo tool now
  // redirects here as ?tab=montecarlo so the user lands straight on the
  // simulation. Apply it once, then drop the param so it does not pin the
  // tab on later in-page navigation.
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (!tabParam) return;
    if ((RISK_TAB_IDS as readonly string[]).includes(tabParam)) {
      setActiveTab(tabParam as RiskTab);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjectList<Project[]>(), staleTime: 5 * 60_000 });
  const projectId = activeProjectId || projects[0]?.id || '';
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  // Read every page rather than the first one. This list feeds the Insights
  // panel, whose "Total exposure" tile sums probability x impact_cost, so
  // stopping at the route's 100-row ceiling made a money figure silently short
  // on any project holding more risks than that, with nothing on screen saying
  // so. The route caps `limit` at 100, which makes one request a page and not
  // a data set.
  const { data: risksPage, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['risks', projectId],
    queryFn: () =>
      fetchAllPages<RiskItem>((offset, limit) =>
        apiGet<Page<RiskItem>>(`/v1/risk/?project_id=${projectId}&limit=${limit}&offset=${offset}`),
      ),
    enabled: !!projectId,
  });
  const risks = useMemo(() => risksPage?.items ?? [], [risksPage]);
  const { data: summary } = useQuery({ queryKey: ['risk-summary', projectId], queryFn: () => apiGet<RiskSummary>(`/v1/risk/summary/?project_id=${projectId}`), enabled: !!projectId });
  const { data: matrixData } = useQuery({ queryKey: ['risk-matrix', projectId], queryFn: () => apiGet<{ cells: MatrixCell[] }>(`/v1/risk/matrix/?project_id=${projectId}`), enabled: !!projectId });

  const delMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/risk/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['risks'] }); qc.invalidateQueries({ queryKey: ['risk-summary'] }); qc.invalidateQueries({ queryKey: ['risk-matrix'] }); qc.invalidateQueries({ queryKey: ['risk-contingency'] }); setDeleteTarget(null); addToast({ type: 'success', title: t('risk.deleted', { defaultValue: 'Risk deleted' }) }); },
    onError: (e: Error) => { setDeleteTarget(null); addToast({ type: 'error', title: t('common.error', { defaultValue: 'Error' }), message: e.message }); },
  });

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['risks'] }); qc.invalidateQueries({ queryKey: ['risk-summary'] }); qc.invalidateQueries({ queryKey: ['risk-matrix'] }); qc.invalidateQueries({ queryKey: ['risk-contingency'] }); }, [qc]);

  // Module Insights - the toggleable visualization panel for this module. Its
  // charts are built client-side from the risks already loaded; when the
  // project has none the panel draws nothing rather than inventing rows to
  // fill it. Open state and any user-built charts persist per module via
  // useModuleInsights. Declared before the detail-view early return below so
  // the hook order stays stable.
  const insights = useModuleInsights('risk', { defaultOpen: true });
  const currency = project?.currency || summary?.currency || 'EUR';
  const { datasets: insightDatasets, builtins: insightBuiltins } = useMemo(
    () => buildRiskInsights(risks, currency, t),
    [risks, currency, t],
  );

  // Total Exposure must never render a misleading "0". The backend returns
  // total_exposure = 0 when risks span more than one currency (it refuses
  // to sum unconverted amounts) and puts the real numbers in
  // exposure_by_currency. When the breakdown holds more than one non-empty
  // currency we show an honest per-currency total via <MultiCurrencyTotal>;
  // otherwise the single-currency total_exposure is correct as-is.
  //
  // Declared up here with the other hooks, above the detail-view early
  // return, for the reason the comment on `insights` gives: opening a risk
  // takes the early return and would otherwise run one hook fewer than the
  // list render just did, which React rejects outright.
  const exposureNode = useMemo(() => {
    const byCurrency = summary?.exposure_by_currency ?? {};
    const named = Object.entries(byCurrency).filter(([c, v]) => c && v > 0);
    if (named.length > 1) {
      return (
        <MultiCurrencyTotal
          variant="kpi"
          primaryCurrency={currency}
          items={named.map(([c, v]) => ({ amount: v, currency: c }))}
          className="text-lg font-semibold text-semantic-error"
        />
      );
    }
    return fmtCur(summary?.total_exposure ?? 0, currency);
  }, [summary, currency]);

  // Client-side filtering
  const filteredRisks = useMemo(() => {
    let result = risks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }
    if (filterCategory) result = result.filter((r) => r.category === filterCategory);
    if (filterStatus) result = result.filter((r) => r.status === filterStatus);
    return result;
  }, [risks, searchQuery, filterCategory, filterStatus]);

  if (selectedRiskId) return <div className="w-full"><DetailView riskId={selectedRiskId} onBack={() => setSelectedRiskId(null)} /></div>;

  const hasRisks = (summary?.total_risks ?? 0) > 0;

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb items={[
        ...(project ? [{ label: project.name, to: `/projects/${project.id}` }] : []),
        { label: t('nav.risk_register', { defaultValue: 'Risk Register' }) },
      ]} />

      <PageHeader
        srTitle={t('nav.risk_register', { defaultValue: 'Risk Register' })}
        subtitle={t('risk.subtitle', {
          defaultValue: 'Track project threats with probability x impact scoring, matrix and Monte Carlo analysis.',
        })}
        actions={
          <>
            {/* Insights toggle - shows or hides this module's visualization
                panel. Leads the cluster so charts are one obvious click away. */}
            <InsightsToggleButton open={insights.open} onClick={insights.toggle} />
            <ModuleGuideButton content={riskGuide} />
            <Button variant="primary" onClick={() => setShowCreate(true)} disabled={!projectId}>
              <Plus size={16} className="mr-1.5" />{t('risk.new', { defaultValue: 'Add Risk' })}
            </Button>
          </>
        }
      />

      {/* Module Insights panel - toggled by the header button. Placed high so
          its charts are visible the moment the register opens. */}
      <InsightsPanel
        open={insights.open}
        title={t('risk.insights.title', { defaultValue: 'Risk insights' })}
        datasets={insightDatasets}
        builtins={insightBuiltins}
        custom={insights.custom}
        onAdd={insights.addCustom}
        onUpdate={insights.updateCustom}
        onRemove={insights.removeCustom}
        onCollapse={() => insights.setOpen(false)}
      />

      <HowRiskWork />

      <DismissibleInfo
        storageKey="risks"
        title={t('risk.intro_title', {
          defaultValue: 'Surface risk before it costs money',
        })}
        more={t('risk.intro_more', { defaultValue: '' }) ? <IntroRichText text={t('risk.intro_more')} /> : undefined}
        links={[
          { label: t('risk.intro_link_analysis', { defaultValue: 'Cost risk analysis' }), onClick: () => navigate('/risk-analysis') },
          { label: t('risk.intro_link_schedule', { defaultValue: '4D Schedule' }), onClick: () => navigate('/schedule') },
        ]}
      >
        {t('risk.intro_body', {
          defaultValue:
            'Log project risks with probability, cost and schedule impact and an owner, then read exposure on a probability-by-impact matrix and per-currency totals that refuse to blend currencies. A second tab runs a Monte Carlo simulation over the register, and the planning cross-links carry the project context into schedule and cost work.',
        })}
      </DismissibleInfo>

      {/* Cross-module navigation — connects the planning value chain */}
      <PlanningCrossLinks active="risks" />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: ShieldAlert, label: t('risk.total', { defaultValue: 'Total Risks' }), value: summary.total_risks, cls: 'text-content-primary', bg: 'bg-surface-secondary', hint: '' },
            { icon: AlertTriangle, label: t('risk.high_critical', { defaultValue: 'High / Critical' }), value: summary.high_critical_count, cls: 'text-semantic-error', bg: 'bg-red-50 dark:bg-red-950/30', hint: t('risk.high_critical_hint', { defaultValue: 'Matrix score 10-25, open risks' }) },
            { icon: DollarSign, label: t('risk.exposure_emv', { defaultValue: 'Exposure (EMV)' }), value: exposureNode, cls: 'text-semantic-error', bg: 'bg-surface-secondary', hint: t('risk.exposure_emv_hint', { defaultValue: 'Σ probability × cost impact' }) },
            { icon: Shield, label: t('risk.mitigated', { defaultValue: 'Mitigated' }), value: summary.mitigated_count, cls: 'text-semantic-success', bg: 'bg-green-50 dark:bg-green-950/30', hint: '' },
          ].map(({ icon: Icon, label, value, cls, bg, hint }) => (
            <Card key={label} className="p-4">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}><Icon size={16} className={cls} /></div>
                <div>
                  <p className="text-2xs text-content-tertiary uppercase tracking-wide">{label}</p>
                  <p className={`text-lg font-semibold ${cls}`}>{value}</p>
                  {hint && <p className="text-2xs text-content-tertiary">{hint}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Contingency: the register's expected value against the contingency
          lines of the finance budget, with drawdowns a manager confirms when
          a risk occurs. Links through to Finance > Budgets. */}
      {projectId && <ContingencyCard projectId={projectId} />}

      {/* ── Tabs: Register (qualitative) vs Monte Carlo (quantitative) ──
          The register tab keeps the 5x5 matrix + filter table. The Monte Carlo tab adds enterprise-CPM-style PERT
          simulation with P50/P80/P95 confidence bands. */}
      {projectId && (
        <div
          role="tablist"
          aria-label={t('risk.tabs_aria', { defaultValue: 'Risk register tabs' })}
          onKeyDown={onTabKeyDown}
          className="flex items-center gap-1 border-b border-border-light"
        >
          <button
            type="button"
            role="tab"
            id="risk-tab-register"
            aria-selected={activeTab === 'register'}
            aria-controls="risk-panel-register"
            tabIndex={activeTab === 'register' ? 0 : -1}
            onClick={() => setActiveTab('register')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === 'register'
                ? 'border-oe-blue text-content-primary'
                : 'border-transparent text-content-tertiary hover:text-content-secondary'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            {t('risk.tab_register', { defaultValue: 'Register' })}
          </button>
          <button
            type="button"
            role="tab"
            id="risk-tab-montecarlo"
            aria-selected={activeTab === 'montecarlo'}
            aria-controls="risk-panel-montecarlo"
            tabIndex={activeTab === 'montecarlo' ? 0 : -1}
            onClick={() => setActiveTab('montecarlo')}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === 'montecarlo'
                ? 'border-oe-blue text-content-primary'
                : 'border-transparent text-content-tertiary hover:text-content-secondary'
            }`}
          >
            <Activity className="h-4 w-4" />
            {t('risk.tab_montecarlo', { defaultValue: 'Monte Carlo' })}
          </button>
        </div>
      )}

      {/* Monte Carlo tab content — render and stop here. */}
      {projectId && activeTab === 'montecarlo' && (
        <div>
          <MonteCarloTab projectId={projectId} currency={currency} />
        </div>
      )}

      {/* Only show matrix when there are actual risks */}
      {activeTab === 'register' && hasRisks && matrixData?.cells && <div><RiskMatrix cells={matrixData.cells} /></div>}

      {/* Search & filter bar (only when there are risks) */}
      {activeTab === 'register' && risks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-content-tertiary" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('risk.search', { defaultValue: 'Search risks...' })}
              aria-label={t('risk.search', { defaultValue: 'Search risks...' })}
              className="h-8 w-full rounded-lg border border-border bg-surface-primary ps-8 pe-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)} className={showFilters ? 'text-oe-blue' : ''} icon={<Filter size={14} />}>
            {t('common.filters', { defaultValue: 'Filters' })}
          </Button>
        </div>
      )}

      {activeTab === 'register' && showFilters && (
        <div className="flex items-center gap-2 flex-wrap animate-fade-in">
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label={t('risk.filter_category', { defaultValue: 'Filter by category' })} className={selectCls + ' max-w-[150px]'}>
            <option value="">{t('risk.all_categories', { defaultValue: 'All Categories' })}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`risk.cat_${c}`, { defaultValue: CATEGORY_LABELS[c] ?? c })}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label={t('risk.filter_status', { defaultValue: 'Filter by status' })} className={selectCls + ' max-w-[150px]'}>
            <option value="">{t('risk.all_statuses', { defaultValue: 'All Statuses' })}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`risk.status_${s}`, { defaultValue: STATUS_LABELS[s] ?? s })}</option>)}
          </select>
          {(filterCategory || filterStatus) && (
            <button onClick={() => { setFilterCategory(''); setFilterStatus(''); }} className="text-xs text-oe-blue hover:underline">
              {t('risk.clear_filters', { defaultValue: 'Clear' })}
            </button>
          )}
        </div>
      )}

      {activeTab === 'register' && <div>
        {!projectId ? (
          <Card><RequiresProject
            emptyHint={t('risk.no_project_desc', { defaultValue: 'Open a project first to view and manage risks.' })}
          >{null}</RequiresProject></Card>
        ) : isLoading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : isError ? (
          <Card className="py-12"><RecoveryCard error={error} onRetry={() => refetch()} /></Card>
        ) : filteredRisks.length === 0 ? (
          <Card><EmptyState
            icon={<ShieldAlert size={28} strokeWidth={1.5} />}
            title={searchQuery || filterCategory || filterStatus
              ? t('risk.no_match', { defaultValue: 'No matching risks' })
              : t('risk.empty', { defaultValue: 'No risks registered' })}
            description={searchQuery || filterCategory || filterStatus
              ? t('risk.no_match_desc', { defaultValue: 'Try adjusting your search or filters.' })
              : t('risk.empty_desc', { defaultValue: 'Add risks to track potential issues and mitigation strategies' })}
            action={searchQuery || filterCategory || filterStatus ? undefined : { label: t('risk.new', { defaultValue: 'Add Risk' }), onClick: () => setShowCreate(true) }}
          /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary/50">
                    {([['risk.code', 'Code', 'left'], ['common.title', 'Title', 'left'], ['risk.category', 'Category', 'left'], ['risk.probability_short', 'Prob.', 'center'], ['risk.impact', 'Impact', 'left'], ['risk.matrix_score_short', 'Score (1-25)', 'center'], ['common.status', 'Status', 'left'], ['risk.owner', 'Owner', 'left']] as const).map(([key, dv, align]) => (
                      <th key={key} className={`px-4 py-3 text-${align} font-medium text-content-secondary`}>{t(key, { defaultValue: dv })}</th>
                    ))}
                    <th className="px-4 py-3 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRisks.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-secondary/30 cursor-pointer" onClick={() => setSelectedRiskId(r.id)}>
                      <td className="px-4 py-3 font-mono text-xs text-content-secondary">{r.code}</td>
                      {/* The cell truncated and the wrapper was inline-flex, which
                          is an atomic inline box: the cell's ellipsis has nowhere
                          to render inside one, and the inner span could not shrink
                          without min-w-0, so a long title was cut mid-word with no
                          ellipsis and read as damaged data rather than as clipped
                          text. A shrinkable flex row ellipsises, and title carries
                          the whole thing for anyone who needs it. */}
                      <td className="px-4 py-3 text-content-primary font-medium max-w-[200px]">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {r.escalated && (
                            <AlertTriangle
                              size={14}
                              className="text-semantic-error shrink-0"
                              aria-label={t('risk.escalated', { defaultValue: 'Escalated' })}
                            />
                          )}
                          <span className="truncate" title={r.title}>{r.title}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3"><Badge variant="neutral">{t(`risk.cat_${r.category}`, { defaultValue: CATEGORY_LABELS[r.category] ?? r.category })}</Badge></td>
                      <td className="px-4 py-3 text-center text-content-secondary tabular-nums">{fmtPercent(r.probability * 100, 0)}</td>
                      <td className="px-4 py-3"><Badge variant={r.impact_severity === 'critical' ? 'error' : r.impact_severity === 'high' ? 'warning' : r.impact_severity === 'medium' ? 'blue' : 'neutral'}>{t(`risk.severity_${r.impact_severity}`, { defaultValue: r.impact_severity })}</Badge></td>
                      <td className="px-4 py-3 text-center">
                        {r.matrix_score != null ? (
                          <Badge variant={TIER_BADGE[r.risk_tier ?? ''] ?? 'neutral'}>
                            <span className="tabular-nums">{r.matrix_score}</span>{' · '}{tierLabel(r.risk_tier, t)}
                          </Badge>
                        ) : (
                          <span className="tabular-nums text-content-primary">{fmtFixed(r.risk_score, 1)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge variant={STATUS_COLORS[r.status] || 'neutral'}>{t(`risk.status_${r.status}`, { defaultValue: STATUS_LABELS[r.status] ?? r.status })}</Badge></td>
                      <td className="px-4 py-3 text-content-secondary text-xs truncate max-w-[100px]" title={r.owner_name || undefined}>{r.owner_name || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(r.id); }} className="text-content-tertiary hover:text-semantic-error transition-colors p-1" title={t('common.delete', { defaultValue: 'Delete' })} aria-label={t('common.delete', { defaultValue: 'Delete' })}><Trash2 size={14} /></button>
                          <ChevronRight size={14} className="text-content-tertiary" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>}

      {showCreate && projectId && <CreateDialog projectId={projectId} currency={currency} onClose={() => setShowCreate(false)} onCreated={refresh} />}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={() => deleteTarget && delMut.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        title={t('risk.delete_title', { defaultValue: 'Delete Risk' })}
        message={t('risk.delete_message', { defaultValue: 'This risk will be permanently removed. This action cannot be undone.' })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        variant="danger"
        loading={delMut.isPending}
      />
    </div>
  );
}

export default RiskRegisterPage;
