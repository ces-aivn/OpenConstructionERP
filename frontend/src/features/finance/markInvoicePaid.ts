// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { apiPost } from '@/shared/lib/api';

/** The slice of an invoice that settling it needs (InvoiceResponse on the wire). */
export interface SettleableInvoice {
  id: string;
}

/** Today's calendar date where the user is, as `YYYY-MM-DD`. */
export function localIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Mark an invoice paid: pay what is still open on it, then close it.
 *
 * The server works out what is open (the total less every payment and the
 * retainage they withheld), records one payment for exactly that, holding
 * back the retention not withheld yet, and moves the status, all in one
 * request. An invoice that was paid in part is therefore never paid in full a
 * second time, and one already settled by its payments records nothing more.
 * The payment is keyed on the invoice, so a second click returns the payment
 * already made.
 */
export async function settleAndMarkPaid(invoice: SettleableInvoice, paymentDate: string = localIsoDate()): Promise<void> {
  await apiPost(`/v1/finance/${encodeURIComponent(invoice.id)}/settle/`, { payment_date: paymentDate });
}
