// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * One rule for "open" and "overdue" on an RFI, shared by the register's KPI
 * tiles, its rows and the Issue Hub.
 *
 * It mirrors the server (`rfi/service.py:get_stats` and
 * `rfi/router.py:_compute_rfi_fields`): an RFI is open while it is `draft` or
 * `open`, and it is overdue only while it is open and its response due date
 * has passed. Overdue is therefore always a subset of open, and an answered,
 * closed or void RFI is never overdue. The page used to count only `open` as
 * open while counting a past-due draft as overdue, so a single draft read as
 * "Open 0, Overdue 1".
 */

import type { RFIStatus } from './api';

/** The fields the rule reads; a full `RFI` and the lighter insight rows fit. */
export interface RfiStatusFields {
  status: string;
  response_due_date?: string | null;
  is_overdue?: boolean | null;
}

/** Statuses in which an RFI still waits for an answer. */
export const RFI_OPEN_STATUSES: readonly RFIStatus[] = ['draft', 'open'];

export function isRfiOpen(status: string | null | undefined): boolean {
  return (RFI_OPEN_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * True when the RFI is open and past its response due date. The server's
 * `is_overdue` is trusted when present, but only for an open RFI, so a stale
 * flag on an answered row can never count.
 */
export function isRfiOverdue(rfi: RfiStatusFields, now: Date = new Date()): boolean {
  if (!isRfiOpen(rfi.status)) return false;
  if (typeof rfi.is_overdue === 'boolean') return rfi.is_overdue;
  if (!rfi.response_due_date) return false;
  const due = new Date(rfi.response_due_date);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}

/** Open and overdue counts over a list, using the rule above. */
export function countRfis(
  rfis: ReadonlyArray<RfiStatusFields>,
  now: Date = new Date(),
): { open: number; overdue: number } {
  let open = 0;
  let overdue = 0;
  for (const r of rfis) {
    if (!isRfiOpen(r.status)) continue;
    open += 1;
    if (isRfiOverdue(r, now)) overdue += 1;
  }
  return { open, overdue };
}
