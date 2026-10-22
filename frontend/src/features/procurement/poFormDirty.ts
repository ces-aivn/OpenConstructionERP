// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Whether the purchase-order form holds something the user would lose by
// closing it. Escape, the close button, Cancel and a click outside the dialog
// all close the form; when this answers true they ask first.
//
// A new order is compared with the blank form it opened as, ignoring the two
// values the form fills in by itself (the project's currency and VAT rate), so
// opening and closing an untouched form never asks. An existing order is
// compared with the state it was loaded in.

export interface DirtyCheckLine {
  description: string;
  quantity: string;
  unit: string;
  unit_rate: string;
  boq_position_id?: string | null;
  required_certificate_type?: string;
  requires_inspection?: boolean;
}

export interface DirtyCheckForm {
  vendor_contact_id: string;
  po_type: string;
  delivery_date: string;
  currency: string;
  payment_terms: string;
  notes: string;
  invoice_tolerance_pct: string;
  invoice_tolerance_abs: string;
  items: DirtyCheckLine[];
}

const DEFAULT_PAYMENT_TERMS = '30';

function lineTouched(line: DirtyCheckLine): boolean {
  const qty = line.quantity.trim();
  return (
    line.description.trim() !== '' ||
    line.unit.trim() !== '' ||
    line.unit_rate.trim() !== '' ||
    (qty !== '' && qty !== '1') ||
    Boolean(line.boq_position_id) ||
    Boolean(line.required_certificate_type) ||
    Boolean(line.requires_inspection)
  );
}

function comparable(form: DirtyCheckForm): string {
  return JSON.stringify({
    vendor: form.vendor_contact_id,
    type: form.po_type,
    delivery: form.delivery_date,
    currency: form.currency,
    terms: form.payment_terms,
    notes: form.notes,
    pct: form.invoice_tolerance_pct,
    abs: form.invoice_tolerance_abs,
    items: form.items
      .filter((li) => lineTouched(li))
      .map((li) => [
        li.description.trim(),
        li.quantity.trim(),
        li.unit.trim(),
        li.unit_rate.trim(),
        li.boq_position_id ?? null,
        li.required_certificate_type ?? '',
        Boolean(li.requires_inspection),
      ]),
  });
}

/**
 * True when closing the form would discard input.
 *
 * @param form    The form as it stands.
 * @param base    The state an existing order was loaded in, or null for a new one.
 * @param taxChanged Whether the VAT rate or tax amount was edited by the user.
 */
export function isPOFormDirty(form: DirtyCheckForm, base: DirtyCheckForm | null, taxChanged = false): boolean {
  if (taxChanged) return true;
  if (base) return comparable(form) !== comparable(base);
  return (
    form.vendor_contact_id.trim() !== '' ||
    form.po_type !== 'standard' ||
    form.delivery_date.trim() !== '' ||
    form.notes.trim() !== '' ||
    form.payment_terms.trim() !== DEFAULT_PAYMENT_TERMS ||
    form.invoice_tolerance_pct.trim() !== '' ||
    form.invoice_tolerance_abs.trim() !== '' ||
    form.items.some(lineTouched)
  );
}
