// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Tests for validateDeliveryLine() - the per-line received-quantity guard
// in the Record-Delivery (goods-receipt create) modal.
//
// Quantities are Decimal STRINGS on the wire, so the comparison must be
// numeric (a raw string `>` compares lexicographically). These cases pin
// the numeric behaviour AND the mirror of the backend over-receipt cap.

import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { receivablePOsKey, validateDeliveryLine } from './RecordDeliveryModal';

describe('validateDeliveryLine', () => {
  it('accepts received equal to ordered', () => {
    expect(validateDeliveryLine('100', '100')).toBeNull();
  });

  it('accepts a partial delivery (received below ordered)', () => {
    expect(validateDeliveryLine('40', '100')).toBeNull();
  });

  it('accepts zero received (nothing delivered on this line)', () => {
    expect(validateDeliveryLine('0', '100')).toBeNull();
  });

  it('flags received exceeding ordered as over_ordered', () => {
    expect(validateDeliveryLine('120', '100')).toBe('over_ordered');
  });

  // Lexicographic trap: as strings "9" > "100" is true, but numerically
  // 9 of 100 is a valid partial - it must NOT be flagged over_ordered.
  it('does not flag a smaller multi-digit received (lexicographic trap)', () => {
    expect(validateDeliveryLine('9', '100')).toBeNull();
  });

  // Inverse trap: "100" > "20" is false as strings but true as numbers.
  it('flags 100 of 20 as over_ordered (inverse lexicographic trap)', () => {
    expect(validateDeliveryLine('100', '20')).toBe('over_ordered');
  });

  it('compares decimal quantities numerically', () => {
    expect(validateDeliveryLine('5.5', '5.50')).toBeNull();
    expect(validateDeliveryLine('5.6', '5.5')).toBe('over_ordered');
  });

  it('flags a blank received quantity as invalid', () => {
    expect(validateDeliveryLine('', '100')).toBe('invalid');
    expect(validateDeliveryLine('   ', '100')).toBe('invalid');
  });

  it('flags a negative received quantity as invalid', () => {
    expect(validateDeliveryLine('-5', '100')).toBe('invalid');
  });

  it('flags an unparseable received quantity as invalid', () => {
    expect(validateDeliveryLine('abc', '100')).toBe('invalid');
  });

  it('does not flag over_ordered when ordered is unparseable', () => {
    // With no usable ordered quantity we cannot say "over" - only the
    // received value itself must be valid.
    expect(validateDeliveryLine('5', 'xyz')).toBeNull();
  });
});

// The delivery dialog's order list must refresh when an order changes. The
// order register invalidates ['procurement-po', projectId] on issue, approve
// and edit, so the dialog's key has to sit under it.
describe('receivablePOsKey', () => {
  it('is invalidated by a change to the project order register', async () => {
    const qc = new QueryClient();
    qc.setQueryData(receivablePOsKey('p1'), { items: [] });
    qc.setQueryData(receivablePOsKey('p2'), { items: [] });
    await qc.invalidateQueries({ queryKey: ['procurement-po', 'p1'] });
    expect(qc.getQueryState(receivablePOsKey('p1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(receivablePOsKey('p2'))?.isInvalidated).toBe(false);
  });
});
