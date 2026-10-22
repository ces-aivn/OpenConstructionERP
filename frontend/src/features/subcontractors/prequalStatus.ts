import type { TFunction } from 'i18next';
import type { InsuranceState, PrequalStatus } from './api';

export const PREQUAL_STATUSES: readonly PrequalStatus[] = ['pending', 'approved', 'suspended', 'rejected'];

const PREQUAL_STATUS_DEFAULTS: Record<PrequalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

/** A prequalification status as the reader's language writes it, never the wire value. */
export function prequalStatusLabel(t: TFunction, status: string): string {
  const known = (PREQUAL_STATUSES as readonly string[]).includes(status);
  return known
    ? t(`subcontractors.prequal_status_${status}`, {
        defaultValue: PREQUAL_STATUS_DEFAULTS[status as PrequalStatus],
      })
    : status;
}

/**
 * Whether approving a firm now needs a stated reason, because it is not insured.
 *
 * The server's `insurance_state` decides when the response carries it. A row
 * without it falls back to the insurance date on the vendor row, the same
 * reading as the register's insurance column. A firm being created has no
 * certificate on file yet, so approving it at creation always needs a reason.
 */
export function approvalNeedsInsuranceOverride(
  existing: { insurance_state?: InsuranceState | null; insurance_expiry_date?: string | null } | undefined,
  today: Date = new Date(),
): boolean {
  if (!existing) return true;
  if (existing.insurance_state) return existing.insurance_state !== 'valid';
  const expiry = existing.insurance_expiry_date;
  if (!expiry) return true;
  const exp = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return true;
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  return exp.getTime() < day.getTime();
}
