// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Pick the part of a bill a tender package covers.
 *
 * A package is compared against the budget of its own lines. Without a pick a
 * roof-steel package covered the whole bill, so a 190 m steel bid read -90 %
 * against a budget that also held the earthworks and the services. Any row can
 * be picked, a section or a single line, and a picked row brings every row
 * under it. Nothing picked means the whole bill, which is what the server
 * stores for it too.
 *
 * The budget shown is a preview summed here from the bill as loaded; the
 * server sums the same rows when it compares bids.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { Button } from '@/shared/ui';
import { WideModal } from '@/shared/ui/WideModal';
import { apiGet } from '@/shared/lib/api';
import { fmtCurrency } from '@/shared/lib/formatters';
import { useToastStore } from '@/stores/useToastStore';

import { setPackageScope, type PackageScope } from './api';
import { tenderingErrorMessage } from './tenderingErrors';

export interface ScopeRow {
  id: string;
  parent_id: string | null;
  ordinal: string;
  description: string;
  unit: string;
  quantity: number | string;
  unit_rate?: number | string;
  total?: number | string;
}

function childrenIndex(rows: ScopeRow[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = index.get(row.parent_id) ?? [];
    list.push(row.id);
    index.set(row.parent_id, list);
  }
  return index;
}

/** The rows a pick covers: each picked row and every row beneath it. */
export function scopeClosure(rows: ScopeRow[], picked: ReadonlySet<string>): Set<string> {
  const kids = childrenIndex(rows);
  const out = new Set<string>();
  const stack = [...picked];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/**
 * The smallest pick that covers a stored scope: the declared rows whose parent
 * is not declared too. The server stores every row in scope, and ticking all
 * of them one by one would leave the lines ticked when their section is
 * unticked.
 */
export function minimalPick(rows: ScopeRow[], declared: readonly string[]): Set<string> {
  const ids = new Set(declared);
  const out = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id) && !(row.parent_id && ids.has(row.parent_id))) out.add(row.id);
  }
  return out;
}

function rowAmount(row: ScopeRow): number {
  const total = Number(row.total ?? 0);
  if (Number.isFinite(total) && total !== 0) return total;
  const qty = Number(row.quantity ?? 0);
  const rate = Number(row.unit_rate ?? 0);
  return Number.isFinite(qty * rate) ? qty * rate : 0;
}

/** The budget of a pick, the whole bill when nothing is picked. */
export function scopeBudget(rows: ScopeRow[], picked: ReadonlySet<string>): number {
  const covered = picked.size > 0 ? scopeClosure(rows, picked) : new Set(rows.map((r) => r.id));
  return rows.reduce((sum, row) => (covered.has(row.id) ? sum + rowAmount(row) : sum), 0);
}

function depthOf(rows: ScopeRow[]): Map<string, number> {
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  const depth = new Map<string, number>();
  for (const row of rows) {
    let d = 0;
    let cur = row.parent_id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur) && d < 12) {
      seen.add(cur);
      d += 1;
      cur = parent.get(cur) ?? null;
    }
    depth.set(row.id, d);
  }
  return depth;
}

export function useBillRows(boqId: string) {
  return useQuery({
    queryKey: ['tendering', 'scope-rows', boqId],
    queryFn: () => apiGet<{ positions?: ScopeRow[] }>(`/v1/boq/boqs/${boqId}`),
    enabled: !!boqId,
    select: (data) => data.positions ?? [],
  });
}

export function PackageScopePicker({
  boqId,
  picked,
  onChange,
  currency,
}: {
  boqId: string;
  picked: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  currency?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const rowsQ = useBillRows(boqId);
  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const depth = useMemo(() => depthOf(rows), [rows]);
  const parentOf = useMemo(() => new Map(rows.map((r) => [r.id, r.parent_id])), [rows]);

  // A row whose ancestor is picked is in scope already; ticking it again would
  // say nothing, so it shows as covered and cannot be toggled on its own.
  const coveredByAncestor = (id: string): boolean => {
    let cur = parentOf.get(id) ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (picked.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.ordinal} ${r.description}`.toLowerCase().includes(q));
  }, [rows, search]);

  const covered = useMemo(() => (picked.size > 0 ? scopeClosure(rows, picked) : null), [rows, picked]);
  const budget = useMemo(() => scopeBudget(rows, picked), [rows, picked]);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  if (!boqId) return null;

  return (
    <div className="space-y-2" data-testid="package-scope-picker">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('tendering.scope_search', { defaultValue: 'Search positions' })}
            className="h-9 w-full rounded-lg border border-border bg-surface-primary pl-8 pr-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30"
          />
        </div>
        {picked.size > 0 && (
          <Button variant="ghost" size="sm" type="button" onClick={() => onChange(new Set())}>
            {t('tendering.scope_clear', { defaultValue: 'Clear selection' })}
          </Button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border-light">
        {rowsQ.isLoading ? (
          <p className="px-3 py-2 text-xs text-content-tertiary">
            {t('tendering.scope_loading', { defaultValue: 'Loading the bill of quantities' })}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-content-tertiary">
            {t('tendering.scope_no_rows', { defaultValue: 'No positions match.' })}
          </p>
        ) : (
          visible.map((row) => {
            const inherited = coveredByAncestor(row.id);
            const checked = picked.has(row.id) || inherited;
            return (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-2 border-b border-border-light px-3 py-1.5 text-sm last:border-b-0 hover:bg-surface-secondary"
                style={{ paddingLeft: 12 + (depth.get(row.id) ?? 0) * 16 }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={inherited}
                  onChange={() => toggle(row.id)}
                  aria-label={`${row.ordinal} ${row.description}`.trim()}
                />
                <span className="w-16 shrink-0 font-mono text-xs text-content-tertiary">{row.ordinal}</span>
                <span className={`min-w-0 flex-1 ${row.parent_id ? '' : 'font-semibold'}`}>{row.description}</span>
                <span className="shrink-0 tabular-nums text-xs text-content-secondary">
                  {fmtCurrency(rowAmount(row), currency)}
                </span>
              </label>
            );
          })
        )}
      </div>
      <p className="text-xs text-content-secondary" data-testid="package-scope-summary">
        {picked.size === 0
          ? t('tendering.scope_whole_bill_hint', {
              defaultValue: 'Nothing picked: the package covers the whole bill. Budget {{amount}}.',
              amount: fmtCurrency(budget, currency),
            })
          : t('tendering.scope_picked_summary', {
              defaultValue: '{{count}} positions in scope. Budget of the package {{amount}}.',
              count: covered?.size ?? 0,
              amount: fmtCurrency(budget, currency),
            })}
      </p>
    </div>
  );
}

/** Re-draw the scope of an existing package. */
export function PackageScopeModal({
  packageId,
  boqId,
  scope,
  currency,
  onClose,
}: {
  packageId: string;
  boqId: string;
  scope: PackageScope | undefined;
  currency?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const rowsQ = useBillRows(boqId);
  const stored = useMemo(
    () => minimalPick(rowsQ.data ?? [], scope?.position_ids ?? []),
    [rowsQ.data, scope?.position_ids],
  );
  // Until the reader changes something the stored scope is what is shown.
  const [edited, setEdited] = useState<Set<string> | null>(null);
  const picked = edited ?? stored;

  // Nothing edited sends the stored scope back unchanged: ``stored`` is empty
  // until the bill's rows load, and an empty list means the whole bill.
  const save = useMutation({
    mutationFn: () =>
      setPackageScope(packageId, { position_ids: edited ? [...edited] : [...(scope?.position_ids ?? [])] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tendering-package-scope', packageId] });
      qc.invalidateQueries({ queryKey: ['tendering-comparison', packageId] });
      qc.invalidateQueries({ queryKey: ['tendering-package', packageId] });
      addToast({ type: 'success', title: t('tendering.scope_saved', { defaultValue: 'Package scope updated' }) });
      onClose();
    },
    onError: (err: unknown) => {
      addToast({
        type: 'error',
        title: t('toasts.error', { defaultValue: 'Error' }),
        message: tenderingErrorMessage(err, t),
      });
    },
  });

  return (
    <WideModal
      open
      onClose={onClose}
      title={t('tendering.scope_edit_title', { defaultValue: 'Package scope' })}
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!rowsQ.isSuccess}
            onClick={() => save.mutate()}
          >
            {t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-content-secondary">
        {t('tendering.scope_edit_hint', {
          defaultValue:
            'Pick the sections or single positions this package covers. Bids are compared against the budget of these positions only.',
        })}
      </p>
      <PackageScopePicker boqId={boqId} picked={picked} onChange={setEdited} currency={currency} />
    </WideModal>
  );
}
