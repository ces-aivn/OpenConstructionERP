// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Pure presentation helpers for the Feature 2 line-level BOQ compare.
 *
 * The classification itself (added / removed / qty / rate / delta) is
 * computed authoritatively on the backend with exact Decimal + FX
 * rebase. These helpers only shape the already-classified rows for the
 * drawer (filtering + change-type → Badge variant + signed-number
 * formatting) so the UI stays a thin, well-tested view.
 */

import type { ComparePositionRow, CompareChangeType } from './api';

export type BadgeVariant = 'neutral' | 'blue' | 'success' | 'warning' | 'error';

/** Stable change-type → Badge variant map (single source of truth). */
export const CHANGE_VARIANT: Record<CompareChangeType, BadgeVariant> = {
  added: 'success',
  removed: 'error',
  qty_changed: 'warning',
  rate_changed: 'warning',
  changed: 'warning',
  unchanged: 'neutral',
};

/**
 * Filter compare rows for display. When `hideUnchanged` is true the
 * `unchanged` lines are dropped — every other class is always kept so a
 * removed/added line never disappears.
 */
export function filterCompareRows(
  rows: ComparePositionRow[],
  hideUnchanged: boolean,
): ComparePositionRow[] {
  if (!hideUnchanged) return rows;
  return rows.filter((r) => r.change_type !== 'unchanged');
}

/**
 * Parse a backend decimal *string* into a finite number, or `null` when
 * it is absent / non-finite. Money/qty fields arrive as exact strings
 * (e.g. `"1234.5600"`) so the grid never float-drifts; the drawer only
 * needs a number for locale formatting + sign.
 */
export function toFiniteOrNull(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Sign of a base-currency delta string: 1 / -1 / 0 (0 also for nullish). */
export function deltaSign(v: string | null | undefined): -1 | 0 | 1 {
  const n = toFiniteOrNull(v);
  if (n == null || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

/**
 * Whether a given column should render an old→new pair (vs a single
 * value). Quantity is paired on `qty_changed`/`changed`; rate on
 * `rate_changed`/`changed`.
 */
export function showsPair(
  changeType: CompareChangeType,
  column: 'qty' | 'rate',
): boolean {
  if (column === 'qty') {
    return changeType === 'qty_changed' || changeType === 'changed';
  }
  return changeType === 'rate_changed' || changeType === 'changed';
}

/** The fields of a bill that decide which side of a comparison it is on. */
export interface CompareSide {
  id: string;
  parent_estimate_id?: string | null;
  created_at?: string | null;
}

/**
 * Which of two bills is the older one, so a comparison always reads new − old.
 *
 * A difference only means something with a direction: a rate raised from 9,500
 * to 10,200 is +14 million, whichever of the two bills happens to be open. The
 * drawer used to take the open bill as the baseline, so comparing a revision
 * with its original printed the increase as −14 million. A revision's own
 * original is always the older side; between unrelated bills the one created
 * first is. Returns `[older, newer]`.
 */
export function orderForCompare<T extends CompareSide>(a: T, b: T): [T, T] {
  if (a.parent_estimate_id === b.id) return [b, a];
  if (b.parent_estimate_id === a.id) return [a, b];
  const ta = Date.parse(a.created_at ?? '');
  const tb = Date.parse(b.created_at ?? '');
  if (Number.isFinite(ta) && Number.isFinite(tb) && tb < ta) return [b, a];
  return [a, b];
}
