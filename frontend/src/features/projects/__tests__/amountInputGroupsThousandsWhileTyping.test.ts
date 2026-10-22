// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { caretAfterRegroup, displayAmount, readTypedAmount } from '../amountInput';

describe('an amount typed into a project form', () => {
  it('groups a fourteen-digit budget the Vietnamese way', () => {
    const typed = readTypedAmount('10000000000000', 'vi-VN');
    expect(typed.value).toBe('10000000000000');
    expect(typed.display).toBe('10.000.000.000.000');
  });

  it('groups the same budget the US way', () => {
    const typed = readTypedAmount('9174287000000', 'en-US');
    expect(typed.value).toBe('9174287000000');
    expect(typed.display).toBe('9,174,287,000,000');
  });

  it('drops a grouping mark the reader typed instead of reading it as a decimal point', () => {
    expect(readTypedAmount('9.174.287', 'vi-VN').value).toBe('9174287');
    expect(readTypedAmount('2,180,000,000', 'en-US').value).toBe('2180000000');
  });

  it('keeps the reader decimal mark and caps the fraction', () => {
    expect(readTypedAmount('1234,567', 'vi-VN')).toEqual({ value: '1234.56', display: '1.234,56' });
    expect(readTypedAmount('1234.5', 'en-US')).toEqual({ value: '1234.5', display: '1,234.5' });
  });

  it('reads an amount written with both marks by its last mark', () => {
    expect(readTypedAmount('1,500,000.50', 'vi-VN').value).toBe('1500000.50');
    expect(readTypedAmount('1.500.000,50', 'en-US').value).toBe('1500000.50');
    expect(readTypedAmount('1.500.000,5', 'vi-VN').value).toBe('1500000.5');
  });

  it('keeps a trailing decimal mark so the fraction can be typed next', () => {
    expect(readTypedAmount('1500,', 'vi-VN')).toEqual({ value: '1500', display: '1.500,' });
  });

  it('treats an empty box as no amount', () => {
    expect(readTypedAmount('', 'vi-VN')).toEqual({ value: '', display: '' });
    expect(readTypedAmount('abc', 'en-US')).toEqual({ value: '', display: '' });
  });

  it('renders a stored value in the reader format', () => {
    expect(displayAmount('9174287000000', 'vi-VN')).toBe('9.174.287.000.000');
    expect(displayAmount('2593679470.2', 'en-US')).toBe('2,593,679,470.2');
    expect(displayAmount(null, 'en-US')).toBe('');
  });

  it('puts the caret back after the digit it followed', () => {
    // "1234|5" typed into "1.234" → regrouped to "12.345"; the caret follows the 4.
    const next = readTypedAmount('12345', 'vi-VN').display;
    expect(next).toBe('12.345');
    expect(caretAfterRegroup('12345', 4, next, 'vi-VN')).toBe(5);
  });
});
