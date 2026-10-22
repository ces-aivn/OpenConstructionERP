// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
import { describe, it, expect } from 'vitest';
import {
  cellEvidence,
  conventionForLocale,
  detectBlockNumberFormat,
  localeForCurrency,
  parseDecimalInConvention,
} from './parseDecimalBlock';

describe('cellEvidence', () => {
  it.each([
    ['1,400.00', 'point'],
    ['12.00', 'point'],
    ['7,000,000', 'point'],
    ['80,000,000.00', 'point'],
    ['8.500.000', 'comma'],
    ['1.234,56', 'comma'],
    ['1,45', 'comma'],
    ['0,500', 'comma'],
    ['450,000', 'ambiguous'],
    ['15.000', 'ambiguous'],
    ['1', 'neutral'],
    ['', 'neutral'],
    ['N/A', 'invalid'],
    ['1,2,3', 'invalid'],
  ])('%s is %s', (cell, expected) => {
    expect(cellEvidence(cell)).toBe(expected);
  });
});

describe('detectBlockNumberFormat', () => {
  it('reads a US block from its unambiguous cells, whatever the fallback says', () => {
    const f = detectBlockNumberFormat(['7,000,000', '12.00', '450,000', '150,000'], 'vi-VN');
    expect(f.convention).toBe('point');
    expect(f.decidedBy).toBe('data');
    expect(f.ambiguousCells).toEqual(['450,000', '150,000']);
  });

  it('reads a Vietnamese block from its unambiguous cells', () => {
    const f = detectBlockNumberFormat(['15.000', '8.500.000', '127.500.000.000'], 'en-US');
    expect(f.convention).toBe('comma');
    expect(f.decidedBy).toBe('data');
  });

  it('lets the fallback locale break a tie and says so', () => {
    expect(detectBlockNumberFormat(['450,000'], 'en-US')).toMatchObject({
      convention: 'point',
      decidedBy: 'locale',
      ambiguousCells: ['450,000'],
    });
    expect(detectBlockNumberFormat(['450,000'], 'vi-VN')).toMatchObject({
      convention: 'comma',
      decidedBy: 'locale',
    });
  });

  it('reports a block that mixes both formats', () => {
    const f = detectBlockNumberFormat(['1,400.00', '12.00', '1,45'], 'en-US');
    expect(f.decidedBy).toBe('conflict');
    expect(f.convention).toBe('point');
    expect(f.conflictingCells).toEqual(['1,45']);
  });
});

describe('parseDecimalInConvention', () => {
  it('reads ambiguous cells in the block convention', () => {
    expect(parseDecimalInConvention('450,000', 'point')).toBe(450000);
    expect(parseDecimalInConvention('450,000', 'comma')).toBe(450);
    expect(parseDecimalInConvention('15.000', 'comma')).toBe(15000);
    expect(parseDecimalInConvention('15.000', 'point')).toBe(15);
  });

  it('keeps an unambiguous cell on its own reading', () => {
    expect(parseDecimalInConvention('1,400.00', 'comma')).toBe(1400);
    expect(parseDecimalInConvention('8.500.000', 'point')).toBe(8500000);
    expect(parseDecimalInConvention('1,45', 'point')).toBe(1.45);
  });

  it('strips currency signs and spacing, keeps the sign, refuses text', () => {
    expect(parseDecimalInConvention('$ 1,234.56', 'point')).toBe(1234.56);
    expect(parseDecimalInConvention('1 234,5 ₫', 'comma')).toBe(1234.5);
    expect(parseDecimalInConvention('-12.5', 'point')).toBe(-12.5);
    expect(parseDecimalInConvention('N/A', 'point')).toBeNull();
    expect(parseDecimalInConvention('', 'point')).toBeNull();
  });
});

describe('locale helpers', () => {
  it('maps the two market currencies to their locale', () => {
    expect(localeForCurrency('VND')).toBe('vi-VN');
    expect(localeForCurrency('usd')).toBe('en-US');
    expect(localeForCurrency('EUR')).toBeNull();
  });

  it('knows which separator a locale writes as its decimal', () => {
    expect(conventionForLocale('vi-VN')).toBe('comma');
    expect(conventionForLocale('en-US')).toBe('point');
  });
});
