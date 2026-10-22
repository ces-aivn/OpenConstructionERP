// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Tests for isPOFormDirty(): closing the order form asks first only when the
// user would lose something they entered.

import { describe, it, expect } from 'vitest';

import { isPOFormDirty, type DirtyCheckForm } from './poFormDirty';

function blank(over: Partial<DirtyCheckForm> = {}): DirtyCheckForm {
  return {
    vendor_contact_id: '',
    po_type: 'standard',
    delivery_date: '',
    currency: 'VND',
    payment_terms: '30',
    notes: '',
    invoice_tolerance_pct: '',
    invoice_tolerance_abs: '',
    items: [{ description: '', quantity: '1', unit: '', unit_rate: '' }],
    ...over,
  };
}

describe('isPOFormDirty for a new order', () => {
  it('is clean when untouched, whatever currency the project filled in', () => {
    expect(isPOFormDirty(blank(), null)).toBe(false);
    expect(isPOFormDirty(blank({ currency: 'USD' }), null)).toBe(false);
  });

  it('is dirty once a supplier is picked', () => {
    expect(isPOFormDirty(blank({ vendor_contact_id: 'c-1' }), null)).toBe(true);
  });

  it('is dirty once a line has a description or a price', () => {
    expect(
      isPOFormDirty(blank({ items: [{ description: 'Thep D10', quantity: '1', unit: '', unit_rate: '' }] }), null),
    ).toBe(true);
    expect(
      isPOFormDirty(blank({ items: [{ description: '', quantity: '1', unit: '', unit_rate: '15000' }] }), null),
    ).toBe(true);
  });

  it('is dirty when the tax was edited by hand', () => {
    expect(isPOFormDirty(blank(), null, true)).toBe(true);
  });

  it('treats changed payment terms or notes as input', () => {
    expect(isPOFormDirty(blank({ payment_terms: '45' }), null)).toBe(true);
    expect(isPOFormDirty(blank({ notes: 'Giao tai cong trinh' }), null)).toBe(true);
  });
});

describe('isPOFormDirty for an existing order', () => {
  const loaded = blank({
    vendor_contact_id: 'c-1',
    items: [{ description: 'Xi mang PCB40', quantity: '200', unit: 'bao', unit_rate: '95000' }],
  });

  it('is clean while it matches what was loaded', () => {
    expect(isPOFormDirty({ ...loaded, items: [...loaded.items] }, loaded)).toBe(false);
  });

  it('ignores an extra empty line', () => {
    const withBlankLine = {
      ...loaded,
      items: [...loaded.items, { description: '', quantity: '1', unit: '', unit_rate: '' }],
    };
    expect(isPOFormDirty(withBlankLine, loaded)).toBe(false);
  });

  it('is dirty when a quantity changes', () => {
    const edited = { ...loaded, items: [{ ...loaded.items[0]!, quantity: '250' }] };
    expect(isPOFormDirty(edited, loaded)).toBe(true);
  });
});
