// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Read a whole pasted block of numbers in ONE number format.
 *
 * A single cell often cannot say which separator is the decimal one. `450,000`
 * is four hundred and fifty thousand in a US bill and four hundred and fifty
 * in a German one; `15.000` is fifteen thousand in a Vietnamese bill and
 * fifteen in a US one. Read cell by cell, a US paste came out with
 * `7,000,000` right (several commas can only be grouping) and `450,000` read
 * as 450, and the bill silently lost a quarter of its cost.
 *
 * The block settles it. A spreadsheet is written in one convention, so the
 * cells that ARE unambiguous (`1,400.00`, `12.00`, `7,000,000`, `8.500.000`,
 * `1,45`) vote for it, and the ambiguous ones are read the way the block
 * reads. When nothing in the block decides, the caller's locale (the project
 * currency's market, then the user's number format) breaks the tie, and the
 * result says so, so the paste dialog can warn instead of guessing in silence.
 * When the block contradicts itself, each unambiguous cell keeps its own
 * reading, the ambiguous ones follow the majority, and that is reported too.
 */

/** Which character is the decimal separator. */
export type DecimalConvention = 'point' | 'comma';

/** What a single cell says about the block's convention. */
type CellEvidence = DecimalConvention | 'ambiguous' | 'neutral' | 'invalid';

export interface BlockNumberFormat {
  convention: DecimalConvention;
  /**
   * `data` when the block's own numbers decided, `locale` when nothing in the
   * block did and the fallback locale broke the tie, `conflict` when the block
   * held cells written in both conventions.
   */
  decidedBy: 'data' | 'locale' | 'conflict';
  /** Cells that could be read either way (each listed once, as pasted). */
  ambiguousCells: string[];
  /** Unambiguous cells that disagree with the chosen convention. */
  conflictingCells: string[];
}

/** Fold spacing, signs and currency marks a spreadsheet cell may carry. */
function cleanCell(raw: string): string {
  return raw
    .trim()
    .replace(/−/g, '-')
    .replace(/\p{Sc}/gu, '')
    .replace(/(\d)[ \u00A0\u202F'](?=\d)/g, '$1')
    .trim();
}

const COMMA_GROUPS_RE = /^[1-9]\d{0,2}(,\d{3})+$|^[1-9]\d?(,\d{2})+,\d{3}$/;
const DOT_GROUPS_RE = /^[1-9]\d{0,2}(\.\d{3})+$/;
const PLAIN_RE = /^\d+$/;

/** Classify one cell. Exported for tests. */
export function cellEvidence(raw: string): CellEvidence {
  const s = cleanCell(raw).replace(/^[-+]/, '');
  if (s === '') return 'neutral';
  if (PLAIN_RE.test(s)) return 'neutral';
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (!/^[\d.,]+$/.test(s)) return 'invalid';
  if (commas > 0 && dots > 0) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastDot > lastComma) {
      // 1,234.56: commas group, the single trailing dot is the decimal.
      return dots === 1 && COMMA_GROUPS_RE.test(s.slice(0, lastDot)) ? 'point' : 'invalid';
    }
    return commas === 1 && DOT_GROUPS_RE.test(s.slice(0, lastComma)) ? 'comma' : 'invalid';
  }
  if (commas > 0) {
    if (commas > 1) return COMMA_GROUPS_RE.test(s) ? 'point' : 'invalid';
    // One comma: three digits after it and a 1-3 digit lead could be either.
    if (/^[1-9]\d{0,2},\d{3}$/.test(s)) return 'ambiguous';
    return /^\d+,\d+$/.test(s) ? 'comma' : 'invalid';
  }
  if (dots > 1) return DOT_GROUPS_RE.test(s) ? 'comma' : 'invalid';
  if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) return 'ambiguous';
  return /^\d*\.\d+$|^\d+\.$/.test(s) ? 'point' : 'invalid';
}

/** The decimal separator a BCP-47 locale writes, as a convention. */
export function conventionForLocale(locale: string | null | undefined): DecimalConvention {
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(1.5);
    return parts.find((p) => p.type === 'decimal')?.value === ',' ? 'comma' : 'point';
  } catch {
    return 'point';
  }
}

/**
 * The locale a project's money is written in, for the two markets this
 * product serves. Other currencies return `null` so the caller falls back to
 * the user's own number format.
 */
export function localeForCurrency(currency: string | null | undefined): string | null {
  switch ((currency ?? '').trim().toUpperCase()) {
    case 'VND':
      return 'vi-VN';
    case 'USD':
      return 'en-US';
    default:
      return null;
  }
}

/** Decide the number format of a block of cells. */
export function detectBlockNumberFormat(
  cells: Iterable<string>,
  fallbackLocale?: string | null,
): BlockNumberFormat {
  let point = 0;
  let comma = 0;
  const ambiguous = new Set<string>();
  const pointCells: string[] = [];
  const commaCells: string[] = [];
  for (const raw of cells) {
    const ev = cellEvidence(raw);
    const shown = raw.trim();
    if (ev === 'point') {
      point++;
      pointCells.push(shown);
    } else if (ev === 'comma') {
      comma++;
      commaCells.push(shown);
    } else if (ev === 'ambiguous') {
      ambiguous.add(shown);
    }
  }
  const fallback = conventionForLocale(fallbackLocale);
  if (point > 0 && comma > 0) {
    const convention: DecimalConvention = point === comma ? fallback : point > comma ? 'point' : 'comma';
    return {
      convention,
      decidedBy: 'conflict',
      ambiguousCells: [...ambiguous],
      conflictingCells: convention === 'point' ? commaCells : pointCells,
    };
  }
  if (point > 0 || comma > 0) {
    return {
      convention: point > 0 ? 'point' : 'comma',
      decidedBy: 'data',
      ambiguousCells: [...ambiguous],
      conflictingCells: [],
    };
  }
  return { convention: fallback, decidedBy: 'locale', ambiguousCells: [...ambiguous], conflictingCells: [] };
}

/**
 * Parse one cell of a block. A cell that is unambiguous on its own keeps its
 * own reading; an ambiguous one is read in `convention`. Returns `null` for
 * an empty cell or text that is not a number.
 */
export function parseDecimalInConvention(raw: string, convention: DecimalConvention): number | null {
  const cleaned = cleanCell(raw);
  if (cleaned === '') return null;
  const ev = cellEvidence(cleaned);
  if (ev === 'invalid') return null;
  const own: DecimalConvention = ev === 'point' || ev === 'comma' ? ev : convention;
  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/^[-+]/, '');
  const canonical =
    own === 'point' ? unsigned.replace(/,/g, '') : unsigned.replace(/\./g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(canonical)) return null;
  const n = Number(canonical);
  return Number.isFinite(n) ? sign * n : null;
}
