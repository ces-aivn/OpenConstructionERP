// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { formatCompactMoney } from '../compactMoney';

describe('formatCompactMoney', () => {
  it('spells the Vietnamese scale words out', () => {
    expect(formatCompactMoney(10_504_250_000_000, 'VND', 'vi-VN')).toBe('10,5 nghìn tỷ ₫');
    expect(formatCompactMoney('2593679470', 'USD', 'vi-VN')).toBe('2,59 tỷ US$');
    expect(formatCompactMoney(57_235_310.82, 'USD', 'vi-VN')).toBe('57,2 triệu US$');
    expect(formatCompactMoney(9_174_000_000_000, 'VND', 'vi-VN')).toBe('9,17 nghìn tỷ ₫');
    expect(formatCompactMoney(250_000, 'VND', 'vi-VN')).toBe('250 nghìn ₫');
  });

  it('keeps small and negative amounts readable', () => {
    expect(formatCompactMoney(-1_900_000_000, 'USD', 'vi-VN')).toBe('-1,9 tỷ US$');
    expect(formatCompactMoney(999, 'VND', 'vi-VN')).toMatch(/^999\s₫$/);
  });

  it('renders the number alone without a currency', () => {
    expect(formatCompactMoney(2_500_000_000, '', 'vi-VN')).toBe('2,5 tỷ');
  });

  it('leaves other locales on the engine compact notation', () => {
    expect(formatCompactMoney(2_593_679_470, 'USD', 'en-US')).toBe('$2.6B');
  });
});
