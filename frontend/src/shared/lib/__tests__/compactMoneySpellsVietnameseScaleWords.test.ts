// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { formatCompactMoney, formatSpelledCompactMoney, spellsOutCompactScale } from '../money';

describe('compact money in Vietnamese', () => {
  it('is recognised by the reader locale', () => {
    expect(spellsOutCompactScale('vi-VN')).toBe(true);
    expect(spellsOutCompactScale('vi')).toBe(true);
    expect(spellsOutCompactScale('en-US')).toBe(false);
    expect(spellsOutCompactScale(undefined)).toBe(false);
  });

  it('writes the ISO code instead of the symbol when asked', () => {
    expect(formatSpelledCompactMoney(10_504_250_000_000, 'VND', 'vi-VN', { showCode: true })).toBe('10,5 nghìn tỷ VND');
  });

  it('keeps an explicit plus on a movement', () => {
    expect(formatSpelledCompactMoney(250_000, 'VND', 'vi-VN', { signDisplay: 'always' })).toBe('+250 nghìn ₫');
  });

  it('drops a malformed currency rather than echo it as a unit', () => {
    expect(formatSpelledCompactMoney(2_500_000_000, 'dong', 'vi-VN')).toBe('2,5 tỷ');
  });

  it('routes each locale to its own compact style', () => {
    expect(formatCompactMoney(2_593_679_470, 'USD', 'vi-VN')).toBe('2,59 tỷ US$');
    expect(formatCompactMoney(2_593_679_470, 'USD', 'en-US')).toBe('$2.6B');
  });
});
