// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Live thousands grouping for an amount typed into a text box.
 *
 * A project budget is often 13 or 14 digits ("9174287000000"), and a bare
 * digit run that long is misread by a factor of ten more often than not. The
 * box shows the amount grouped the way the reader writes numbers while they
 * type, and hands the form a plain decimal string ("9174287000000.5") that
 * the backend's Decimal contract accepts unchanged.
 *
 * The reader's own separators decide what a typed mark means: in Vietnamese a
 * "." is a thousands mark and "," the decimal one, in US English the other way
 * round. A grouping mark the reader types is therefore dropped rather than read
 * as a decimal point, which is the mistake that turns 9.174.287 into 9.174.
 */

export interface AmountSeparators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<string, AmountSeparators>();

/** The grouping and decimal marks `locale` writes, with a plain fallback. */
export function amountSeparators(locale: string): AmountSeparators {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  let result: AmountSeparators = { group: ',', decimal: '.' };
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    const group = parts.find((p) => p.type === 'group')?.value;
    const decimal = parts.find((p) => p.type === 'decimal')?.value;
    if (decimal) result = { group: group ?? '', decimal };
  } catch {
    // A malformed tag keeps the plain fallback.
  }
  separatorCache.set(locale, result);
  return result;
}

export interface TypedAmount {
  /** Plain decimal string for the payload: digits, optional "." and fraction. "" when empty. */
  value: string;
  /** What the box shows: the integer part grouped, the reader's decimal mark kept as typed. */
  display: string;
}

/**
 * Read what the user typed and return the canonical value and its display.
 *
 * Only digits and the reader's decimal mark survive; everything else, the
 * grouping mark included, is dropped. A trailing decimal mark is kept in the
 * display so the reader can go on typing the fraction. Leading zeros of the
 * integer part are trimmed to one.
 *
 * An amount carrying both a point and a comma (pasted from a sheet written
 * the other way, "1,500,000.50" for a Vietnamese reader) is read with the
 * last of the two as its decimal mark, so it is not cut to 1.50.
 */
export function readTypedAmount(raw: string, locale: string, maxFractionDigits = 2): TypedAmount {
  const { group } = amountSeparators(locale);
  let { decimal } = amountSeparators(locale);
  if (raw.includes('.') && raw.includes(',')) decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
  let integer = '';
  let fraction = '';
  let sawDecimal = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (sawDecimal) {
        if (fraction.length < maxFractionDigits) fraction += ch;
      } else {
        integer += ch;
      }
    } else if (ch === decimal && !sawDecimal && maxFractionDigits > 0) {
      sawDecimal = true;
    }
  }
  integer = integer.replace(/^0+(?=\d)/, '');
  if (!integer && !sawDecimal) return { value: '', display: '' };
  const intForValue = integer || '0';
  const value = fraction ? `${intForValue}.${fraction}` : intForValue;
  const groupedInt = groupDigits(intForValue, group);
  const display = sawDecimal ? `${groupedInt}${decimal}${fraction}` : groupedInt;
  return { value, display };
}

/** The display of a stored canonical value ("1500000.5" → "1.500.000,5" in vi). */
export function displayAmount(value: string | null | undefined, locale: string): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  const { decimal } = amountSeparators(locale);
  // The stored value always uses "." as its decimal point.
  return readTypedAmount(text.replace('.', decimal), locale, 20).display;
}

/**
 * Where the caret belongs after re-grouping: just after the same number of
 * digits and decimal marks it followed before.
 */
export function caretAfterRegroup(previous: string, caret: number, next: string, locale: string): number {
  const { decimal } = amountSeparators(locale);
  const isSignificant = (ch: string) => (ch >= '0' && ch <= '9') || ch === decimal;
  let wanted = 0;
  for (let i = 0; i < Math.min(caret, previous.length); i += 1) {
    if (isSignificant(previous[i]!)) wanted += 1;
  }
  if (wanted === 0) return 0;
  let seen = 0;
  for (let i = 0; i < next.length; i += 1) {
    if (isSignificant(next[i]!)) seen += 1;
    if (seen === wanted) return i + 1;
  }
  return next.length;
}

function groupDigits(digits: string, group: string): string {
  if (!group) return digits;
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += group;
  }
  return out;
}
