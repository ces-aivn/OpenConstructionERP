// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ListPlus } from 'lucide-react';
import { apiGet, apiPost, type Page } from '@/shared/lib/api';
import { MoneyDisplay } from '@/shared/ui/MoneyDisplay';
import { isDecimalString, subtractDecimalStrings } from '@/shared/lib/exactDecimal';

/** The slice of a purchase order the picker reads (POResponse on the wire). */
export interface LinkableOrder {
  id: string;
  po_number: string;
  status: string;
  currency_code: string;
  amount_subtotal: string;
  invoiced_net?: string;
  invoice_count?: number;
}

/** One line of an order (POItemResponse on the wire). */
export interface OrderItem {
  id: string;
  description: string;
  quantity: string;
  unit?: string | null;
  unit_rate: string;
  wbs_id?: string | null;
  cost_category?: string | null;
  cost_line_id?: string | null;
}

/** One line of the order's three-way match (POLineMatchStatus on the wire). */
export interface OrderMatchLine {
  line_id: string;
  received_qty: string;
  invoiced_qty: string;
}

/** An order line still to be billed, ready to become an invoice line. */
export interface OrderLineToBill {
  description: string;
  quantity: string;
  unit: string;
  unit_rate: string;
  wbs_id: string | null;
  cost_category: string | null;
  cost_line_id: string | null;
}

/** An invoice line as the match check reads it. */
export interface InvoiceCheckLine {
  description: string;
  quantity: string;
}

/**
 * The order lines still to be billed, at the quantity still to bill.
 *
 * Once anything on the order has been received, a line is billed up to what
 * was received less what is already invoiced, the three-way match the server
 * holds the invoice to before it is approved or paid. Before any receipt (an
 * order for services, or one whose deliveries are not booked here) it is
 * billed up to what was ordered. Lines with nothing left are left out.
 */
export function orderLinesToBill(items: OrderItem[], match: OrderMatchLine[] | undefined): OrderLineToBill[] {
  const byLine = new Map((match ?? []).map((m) => [m.line_id, m]));
  const anyReceived = (match ?? []).some((m) => Number(m.received_qty) > 0);
  const out: OrderLineToBill[] = [];
  for (const item of items) {
    const m = byLine.get(item.id);
    const base = anyReceived ? (m?.received_qty ?? '0') : item.quantity;
    const left = subtractDecimalStrings(base, m?.invoiced_qty ?? '0');
    if (left === null || !(Number(left) > 0)) continue;
    out.push({
      description: item.description,
      quantity: String(Number(left)),
      unit: item.unit ?? '',
      unit_rate: item.unit_rate,
      wbs_id: item.wbs_id ?? null,
      cost_category: item.cost_category ?? null,
      cost_line_id: item.cost_line_id ?? null,
    });
  }
  return out;
}

interface InvoiceCheckResult {
  results: Array<{
    rule_id: string;
    severity: string;
    passed: boolean;
    message: string;
  }>;
}

// The server refuses a link to an order in either of these states, so the
// picker does not offer them.
const UNLINKABLE_STATUSES = new Set(['draft', 'cancelled']);

/**
 * The optional purchase order a supplier invoice bills.
 *
 * Offered only on a payable invoice, and only the orders of this project
 * placed with the invoice's supplier, which is the same rule the server
 * applies when it saves the link. Beside the choice it shows what the order
 * is worth, what has been invoiced on it so far and what is still open, all
 * net of VAT, and the three-way match warnings for the lines being entered.
 * The warnings never block the save; the server holds the invoice back from
 * approval and payment while it bills more than was received. The order's
 * lines still to bill can be copied into the invoice.
 */
export function InvoicePurchaseOrderField({
  projectId,
  contactId,
  value,
  onChange,
  amountSubtotal,
  invoiceId,
  lines,
  onCopyLines,
}: {
  projectId: string;
  contactId: string;
  value: string;
  onChange: (poId: string) => void;
  /** The invoice's net amount as typed, checked against the order. */
  amountSubtotal: number;
  /** Set when editing, so the invoice is not counted against itself. */
  invoiceId?: string;
  /** The invoice's lines as typed, matched by quantity against the order's receipts. */
  lines?: InvoiceCheckLine[];
  /** Offered when set: replaces the invoice's lines with the order's lines still to bill. */
  onCopyLines?: (lines: OrderLineToBill[]) => void;
}) {
  const { t } = useTranslation();
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');

  const { data: ordersPage, isLoading } = useQuery({
    queryKey: ['procurement-po', projectId, 'vendor', contactId],
    queryFn: () =>
      apiGet<Page<LinkableOrder>>(
        `/v1/procurement/?project_id=${encodeURIComponent(projectId)}&vendor_contact_id=${encodeURIComponent(contactId)}&limit=100`,
      ),
    enabled: !!projectId && !!contactId,
  });
  const orders = useMemo(
    () =>
      (ordersPage?.items ?? []).filter(
        (po) => !UNLINKABLE_STATUSES.has(po.status) || po.id === value,
      ),
    [ordersPage, value],
  );
  const selected = orders.find((po) => po.id === value);

  // Weigh the amount and the lines once typing settles, not on every keystroke.
  const checkLines = useMemo(
    () =>
      (lines ?? [])
        .filter((line) => Number(line.quantity) > 0)
        .map((line) => ({ description: line.description.trim(), quantity: String(line.quantity).trim() })),
    [lines],
  );
  const linesKey = JSON.stringify(checkLines);
  const [checked, setChecked] = useState({ amount: amountSubtotal, linesKey });
  useEffect(() => {
    const handle = window.setTimeout(() => setChecked({ amount: amountSubtotal, linesKey }), 400);
    return () => window.clearTimeout(handle);
  }, [amountSubtotal, linesKey]);

  const { data: check } = useQuery({
    queryKey: ['procurement-invoice-check', value, checked.amount, checked.linesKey, invoiceId ?? ''],
    queryFn: () =>
      apiPost<InvoiceCheckResult>(`/v1/procurement/${value}/invoice-check/`, {
        amount_subtotal: String(checked.amount),
        line_items: JSON.parse(checked.linesKey) as InvoiceCheckLine[],
        invoice_id: invoiceId || undefined,
      }),
    enabled: !!value && checked.amount > 0,
  });

  const copyLines = async () => {
    if (!value || !onCopyLines) return;
    setCopying(true);
    setCopyError('');
    try {
      const [order, match] = await Promise.all([
        apiGet<{ items?: OrderItem[] }>(`/v1/procurement/${encodeURIComponent(value)}`),
        apiGet<{ lines?: OrderMatchLine[] }>(`/v1/procurement/${encodeURIComponent(value)}/match-status/`),
      ]);
      const toBill = orderLinesToBill(order?.items ?? [], match?.lines);
      if (toBill.length === 0) {
        setCopyError(
          t('finance.po_copy_lines_nothing', {
            defaultValue: 'Every line of this order is already invoiced up to what was received.',
          }),
        );
        return;
      }
      onCopyLines(toBill);
    } catch (e) {
      setCopyError(
        t('finance.po_copy_lines_failed', {
          defaultValue: 'The lines of the order could not be loaded: {{reason}}',
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setCopying(false);
    }
  };
  const warnings = (check?.results ?? []).filter((r) => !r.passed);

  if (!contactId) {
    return (
      <p className="text-xs text-content-tertiary" data-testid="invoice-po-pick-supplier">
        {t('finance.po_link_pick_supplier', {
          defaultValue: 'Choose the supplier first to see its purchase orders.',
        })}
      </p>
    );
  }

  const ordered = selected?.amount_subtotal ?? '0';
  const invoicedToDate = selected?.invoiced_net ?? '0';
  const difference = subtractDecimalStrings(ordered, invoicedToDate);
  const open = difference?.startsWith('-') ? '0' : difference;

  return (
    <div className="space-y-2">
      <select
        className="h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('finance.po_link_label', { defaultValue: 'Purchase order' })}
        data-testid="invoice-po-select"
      >
        <option value="">{t('finance.po_link_none', { defaultValue: 'Not linked to an order' })}</option>
        {orders.map((po) => (
          <option key={po.id} value={po.id}>
            {po.po_number}
          </option>
        ))}
      </select>

      {!isLoading && orders.length === 0 && (
        <p className="text-xs text-content-tertiary" data-testid="invoice-po-no-orders">
          {t('finance.po_link_no_orders', {
            defaultValue: 'This supplier has no open purchase orders on this project.',
          })}
        </p>
      )}

      {selected && (
        <dl
          className="grid grid-cols-3 gap-2 rounded-lg border border-border-light bg-surface-secondary/50 px-3 py-2 text-xs"
          data-testid="invoice-po-figures"
        >
          <div>
            <dt className="text-content-tertiary">{t('finance.po_link_ordered', { defaultValue: 'Ordered' })}</dt>
            <dd className="tabular-nums font-medium text-content-primary">
              <MoneyDisplay amount={isDecimalString(ordered) ? ordered : null} currency={selected.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-content-tertiary">
              {t('finance.po_link_invoiced', { defaultValue: 'Invoiced to date' })}
            </dt>
            <dd className="tabular-nums font-medium text-content-primary">
              <MoneyDisplay amount={isDecimalString(invoicedToDate) ? invoicedToDate : null} currency={selected.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-content-tertiary">{t('finance.po_link_open', { defaultValue: 'Still open' })}</dt>
            <dd className="tabular-nums font-medium text-content-primary">
              <MoneyDisplay amount={open} currency={selected.currency_code} />
            </dd>
          </div>
          <p className="col-span-3 text-2xs text-content-tertiary">
            {t('finance.basis_net', { defaultValue: 'Net of VAT' })}
          </p>
        </dl>
      )}

      {selected && onCopyLines && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => void copyLines()}
            disabled={copying}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-secondary hover:text-oe-blue disabled:opacity-60"
            data-testid="invoice-po-copy-lines"
          >
            <ListPlus size={14} />
            {t('finance.po_copy_lines', { defaultValue: 'Copy lines from the order' })}
          </button>
          <p className="text-2xs text-content-tertiary">
            {t('finance.po_copy_lines_hint', {
              defaultValue:
                'Replaces the invoice lines with the order lines still to bill, at the quantity received and not yet invoiced.',
            })}
          </p>
          {copyError && (
            <p className="text-xs text-semantic-error" role="alert" data-testid="invoice-po-copy-error">
              {copyError}
            </p>
          )}
        </div>
      )}

      {selected && warnings.length > 0 && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="invoice-po-warnings"
        >
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w.rule_id} className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs opacity-80">
            {t('finance.po_link_warnings_note_release', {
              defaultValue:
                'The invoice can still be saved, but it cannot be approved or paid while it bills more than has been received.',
            })}
          </p>
        </div>
      )}
    </div>
  );
}
