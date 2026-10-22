// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * ExcelPasteModal — Paste rows from Excel/Sheets (tab-separated) or a CSV file
 * into a BOQ.
 *
 * Columns are found by their header (English and Vietnamese names, so the
 * header a Vietnamese bill is written with is recognised as a header and not
 * imported as a line), or by position when there is no header. Numbers are
 * read in ONE format for the whole block (see `parseDecimalBlock`): the
 * unambiguous cells decide, the project's market breaks a tie, and either case
 * the dialog cannot settle on its own is shown to the user with a switch.
 */

import { useState, useCallback, useMemo, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, X, Upload, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/shared/ui';
import { useFocusTrap } from '@/shared/hooks/useFocusTrap';
import { getNumberLocale } from '@/stores/usePreferencesStore';
import { fmtList } from '@/shared/lib/formatters';
import {
  detectBlockNumberFormat,
  parseDecimalInConvention,
  type BlockNumberFormat,
  type DecimalConvention,
} from '@/shared/lib/parseDecimalBlock';

export interface PastedRow {
  /** The position number the row is imported under; empty until assigned. */
  ordinal: string;
  description: string;
  unit: string;
  quantity: number;
  unit_rate: number;
}

/**
 * The rows of a paste as the bulk-create endpoint takes them. Every line is
 * marked ``excel_import``: without a source the endpoint filed pasted lines as
 * ``takeoff``, so the bill's provenance claimed a measurement nobody made.
 */
export function pastedRowsToBulkItems(rows: readonly PastedRow[], boqId: string, parentId?: string | null) {
  return rows.map((r) => ({
    boq_id: boqId,
    ordinal: r.ordinal,
    description: r.description,
    unit: r.unit,
    quantity: r.quantity,
    unit_rate: r.unit_rate,
    source: 'excel_import' as const,
    ...(parentId ? { parent_id: parentId } : {}),
  }));
}

interface ExcelPasteModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (rows: PastedRow[]) => void;
  loading?: boolean;
  /**
   * Locale whose number format breaks a tie when the pasted numbers do not
   * settle it themselves (the project currency's market). Defaults to the
   * user's number format.
   */
  numberLocale?: string | null;
  /**
   * The bill's next `count` position numbers, so pasted lines are numbered
   * like every other line. Rows that bring their own position number keep it
   * when it is free.
   */
  nextOrdinals?: (count: number) => string[];
  /** Position numbers already used in the bill. */
  existingOrdinals?: ReadonlySet<string>;
}

/* ── Header detection ─────────────────────────────────────────────── */

/** Lower-case, strip diacritics (đ → d), parenthesised notes and punctuation. */
export function normaliseHeader(cell: string): string {
  return cell
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[.*:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Header names, after `normaliseHeader`. `row` marks a running row counter
 * (STT, No., #): it is not a position number, so it is read and dropped and
 * the line is numbered by the bill.
 */
const HEADER_MAP: Record<string, string> = {
  // Row counters
  '#': 'row', no: 'row', stt: 'row', tt: 'row', 'so tt': 'row', 'so thu tu': 'row',
  // Position numbers
  pos: 'ordinal', number: 'ordinal', ordinal: 'ordinal', oz: 'ordinal', 'item no': 'ordinal',
  code: 'ordinal', 'ma hieu': 'ordinal', 'ma so': 'ordinal', 'ma cong tac': 'ordinal', 'ma hieu cong tac': 'ordinal',
  // Description
  description: 'description', desc: 'description', text: 'description', item: 'description',
  bezeichnung: 'description', 'mo ta': 'description', 'noi dung': 'description', 'hang muc': 'description',
  'ten cong viec': 'description', 'noi dung cong viec': 'description', 'ten hang muc': 'description',
  'cong tac': 'description', 'mo ta cong viec': 'description',
  // Unit
  unit: 'unit', einheit: 'unit', eh: 'unit', uom: 'unit', dvt: 'unit', 'don vi': 'unit', 'don vi tinh': 'unit',
  // Quantity
  qty: 'quantity', quantity: 'quantity', menge: 'quantity', amount: 'quantity',
  'khoi luong': 'quantity', kl: 'quantity', 'so luong': 'quantity', sl: 'quantity',
  // Unit rate
  rate: 'unit_rate', 'unit rate': 'unit_rate', unit_rate: 'unit_rate', price: 'unit_rate',
  einzelpreis: 'unit_rate', ep: 'unit_rate', 'unit price': 'unit_rate', 'unit cost': 'unit_rate',
  'don gia': 'unit_rate',
  // Line amount (read only to cross-check quantity x rate)
  total: 'total', 'line total': 'total', 'total price': 'total', gesamtpreis: 'total', gp: 'total',
  'thanh tien': 'total', 'gia tri': 'total',
};

function detectColumns(headerCells: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const taken = new Set<string>();
  for (let i = 0; i < headerCells.length; i++) {
    const mapped = HEADER_MAP[normaliseHeader(headerCells[i] ?? '')];
    if (mapped && !taken.has(mapped)) {
      mapping[i] = mapped;
      taken.add(mapped);
    }
  }
  return mapping;
}

const DEFAULT_ORDER = ['description', 'unit', 'quantity', 'unit_rate'];
const NUMBER_FIELDS = ['quantity', 'unit_rate', 'total'] as const;

/* ── Splitting the pasted text into cells ─────────────────────────── */

/** RFC 4180 reader for one delimiter: quoted cells may hold the delimiter. */
function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Count `delimiter` outside double quotes in one line. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) n++;
  }
  return n;
}

/**
 * Split pasted text into rows of cells. A copy out of a spreadsheet is
 * tab-separated; the text of a CSV file is comma- or semicolon-separated with
 * quoted cells (`"7,000,000"`), which a tab split would leave in one piece.
 */
export function splitPastedText(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  let delimiter = '\t';
  if (!text.includes('\t')) {
    const commas = countOutsideQuotes(firstLine, ',');
    const semicolons = countOutsideQuotes(firstLine, ';');
    if (semicolons > 0 && semicolons >= commas) delimiter = ';';
    else if (commas > 0) delimiter = ',';
  }
  return splitCsv(text, delimiter)
    .map((cells) => cells.map((c) => c.trim()))
    .filter((cells) => cells.some((c) => c !== ''));
}

/* ── Parsing ──────────────────────────────────────────────────────── */

export interface ParseOptions {
  /** Locale that breaks a tie the pasted numbers leave open. */
  fallbackLocale?: string | null;
  /** Force a number format instead of detecting it. */
  convention?: DecimalConvention | 'auto';
  /**
   * Force whether the first row is a header. Left undefined, it is detected:
   * by its column names, or by holding only text above rows with numbers.
   */
  firstRowIsHeader?: boolean;
}

export interface ParseResult {
  rows: PastedRow[];
  detectedHeaders: string[];
  /** Data lines dropped because they carried no description. */
  skippedEmpty: number;
  /** Number cells that were present but could not be read as a number. */
  invalidNumbers: number;
  /** Whether the first row was read as a header and left out. */
  headerSkipped: boolean;
  /** Whether the first row looks like a header (what the switch starts at). */
  headerDetected: boolean;
  /** The number format the block was read in, and how it was decided. */
  numberFormat: BlockNumberFormat | null;
  /** Rows whose amount column disagrees with quantity x rate. */
  totalMismatches: string[];
}

const EMPTY_RESULT: ParseResult = {
  rows: [],
  detectedHeaders: [],
  skippedEmpty: 0,
  invalidNumbers: 0,
  headerSkipped: false,
  headerDetected: false,
  numberFormat: null,
  totalMismatches: [],
};

function isNumberLike(cell: string): boolean {
  return parseDecimalInConvention(cell, 'point') !== null;
}

/**
 * A first row of text only, above a row that has a number in a column where
 * the first row has text, is a header even when its names are not ones we
 * know (the dialog's own example header, a header in another language).
 */
function looksLikeTextHeader(first: string[], second: string[] | undefined): boolean {
  if (!second) return false;
  const filled = first.filter((c) => c !== '');
  if (filled.length < 2 || filled.some(isNumberLike)) return false;
  return second.some((c, i) => c !== '' && isNumberLike(c) && (first[i] ?? '') !== '');
}

export function parseRows(raw: string, options: ParseOptions = {}): ParseResult {
  const table = splitPastedText(raw);
  if (table.length === 0) return { ...EMPTY_RESULT };

  const firstRow = table[0] ?? [];
  const named = detectColumns(firstRow);
  const namedHeader = Object.keys(named).length >= 2;
  const headerDetected = namedHeader || looksLikeTextHeader(firstRow, table[1]);
  const headerSkipped = options.firstRowIsHeader ?? headerDetected;

  let colMap: Record<number, string> = {};
  if (headerSkipped && namedHeader) {
    colMap = named;
  } else {
    for (let i = 0; i < Math.min(firstRow.length, DEFAULT_ORDER.length); i++) {
      colMap[i] = DEFAULT_ORDER[i] ?? 'description';
    }
  }
  const detectedHeaders =
    headerSkipped && namedHeader ? Object.values(colMap).filter((f) => f !== 'row') : [];

  const dataRows = (headerSkipped ? table.slice(1) : table).map((cells) => {
    const row: Record<string, string> = {};
    for (const [idx, field] of Object.entries(colMap)) row[field] = (cells[Number(idx)] ?? '').trim();
    return row;
  });

  const numberCells: string[] = [];
  for (const row of dataRows) {
    for (const f of NUMBER_FIELDS) if (row[f]) numberCells.push(row[f]!);
  }
  const detected = detectBlockNumberFormat(numberCells, options.fallbackLocale ?? getNumberLocale());
  const forced = options.convention && options.convention !== 'auto' ? options.convention : null;
  const numberFormat: BlockNumberFormat = forced
    ? { ...detected, convention: forced, decidedBy: 'data', conflictingCells: [] }
    : detected;
  const read = (cell: string) => parseDecimalInConvention(cell, numberFormat.convention);

  const rows: PastedRow[] = [];
  const totalMismatches: string[] = [];
  let skippedEmpty = 0;
  let invalidNumbers = 0;

  for (const row of dataRows) {
    const desc = row['description'] || '';
    if (!desc) {
      // A line carried some content but no description, so it cannot become a
      // position. Count it so the user is told rather than left guessing.
      skippedEmpty++;
      continue;
    }

    const rawQty = row['quantity'] ?? '';
    const rawRate = row['unit_rate'] ?? '';
    let quantity = rawQty ? read(rawQty) : 1;
    let unit_rate = rawRate ? read(rawRate) : 0;
    if (quantity === null) {
      invalidNumbers++;
      quantity = 1;
    }
    if (unit_rate === null) {
      invalidNumbers++;
      unit_rate = 0;
    }

    const rawTotal = row['total'] ?? '';
    const total = rawTotal ? read(rawTotal) : null;
    if (total !== null && rawQty && rawRate) {
      const product = quantity * unit_rate;
      if (Math.abs(product - total) > Math.max(0.01, Math.abs(total) * 1e-9)) totalMismatches.push(desc);
    }

    rows.push({
      ordinal: row['ordinal'] ?? '',
      description: desc,
      unit: row['unit'] || 'pcs',
      quantity,
      unit_rate,
    });
  }

  return {
    rows,
    detectedHeaders,
    skippedEmpty,
    invalidNumbers,
    headerSkipped,
    headerDetected,
    numberFormat,
    totalMismatches,
  };
}

/**
 * Give every row its final position number: the one it brought when that is
 * free and unique, otherwise the bill's next number in its own scheme.
 */
export function assignOrdinals(
  rows: PastedRow[],
  nextOrdinals: ((count: number) => string[]) | undefined,
  existing: ReadonlySet<string> = new Set(),
): PastedRow[] {
  const seen = new Set<string>();
  const keep = rows.map((r) => {
    const own = r.ordinal.trim();
    if (!own || existing.has(own) || seen.has(own)) return false;
    seen.add(own);
    return true;
  });
  const missing = keep.filter((k) => !k).length;
  const next =
    nextOrdinals ?? ((n: number) => Array.from({ length: n }, (_, i) => String((i + 1) * 10).padStart(4, '0')));
  // Ask for enough numbers to step past the ones the pasted rows keep.
  const generated = missing > 0 ? next(missing + seen.size).filter((o) => !seen.has(o)) : [];
  let g = 0;
  return rows.map((r, i) => (keep[i] ? { ...r, ordinal: r.ordinal.trim() } : { ...r, ordinal: generated[g++] ?? '' }));
}

/* ── Component ────────────────────────────────────────────────────── */

export function ExcelPasteModal({
  open,
  onClose,
  onImport,
  loading,
  numberLocale,
  nextOrdinals,
  existingOrdinals,
}: ExcelPasteModalProps) {
  const { t } = useTranslation();
  const [raw, setRawText] = useState('');
  const [convention, setConvention] = useState<DecimalConvention | 'auto'>('auto');
  const [headerOverride, setHeaderOverride] = useState<boolean | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, open);

  const setRaw = useCallback((text: string) => {
    setRawText(text);
    // A new paste is judged afresh: neither switch carries over.
    setHeaderOverride(undefined);
    setConvention('auto');
  }, []);

  const parsed = useMemo(
    () => parseRows(raw, { fallbackLocale: numberLocale, convention, firstRowIsHeader: headerOverride }),
    [raw, numberLocale, convention, headerOverride],
  );
  const { detectedHeaders, skippedEmpty, invalidNumbers, headerSkipped, numberFormat, totalMismatches } = parsed;
  const rows = useMemo(
    () => assignOrdinals(parsed.rows, nextOrdinals, existingOrdinals),
    [parsed.rows, nextOrdinals, existingOrdinals],
  );
  const totalSum = useMemo(() => rows.reduce((s, r) => s + r.quantity * r.unit_rate, 0), [rows]);

  const formatUnsettled =
    convention === 'auto' &&
    numberFormat !== null &&
    ((numberFormat.decidedBy === 'locale' && numberFormat.ambiguousCells.length > 0) ||
      numberFormat.decidedBy === 'conflict');
  const readingExample = numberFormat?.convention === 'comma' ? '1.234,56' : '1,234.56';

  const handleImport = useCallback(() => {
    if (rows.length > 0) onImport(rows);
  }, [rows, onImport]);

  const handleClose = useCallback(() => {
    setRaw('');
    onClose();
  }, [onClose]);

  // Escape closes the modal (unless an import is in flight).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        handleClose();
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [open, loading, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in" onClick={handleClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-3xl mx-4 bg-surface-primary rounded-2xl shadow-2xl border border-border-light overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-oe-blue-subtle flex items-center justify-center">
              <ClipboardPaste size={18} className="text-oe-blue" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold">{t('boq.paste_from_excel', { defaultValue: 'Paste from Excel' })}</h2>
              <p className="text-xs text-content-secondary">{t('boq.paste_excel_hint', { defaultValue: 'Copy rows from Excel or Google Sheets and paste below' })}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="p-1.5 rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={18} className="text-content-tertiary" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Textarea */}
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t('boq.paste_placeholder', { defaultValue: 'Paste tab-separated data here...\n\nExample:\nDescription\tUnit\tQty\tRate\nConcrete foundation\tm3\t120\t185.00\nRebar B500S\tkg\t2400\t1.45' })}
            className="w-full h-40 rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue"
            autoFocus
          />

          {/* Detection feedback */}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span className="text-xs text-content-secondary">
                {t('boq.paste_detected', { defaultValue: '{{count}} rows detected', count: rows.length })}
              </span>
              {detectedHeaders.length > 0 && (
                <span className="text-xs text-content-tertiary">
                  ({t('boq.paste_columns', { defaultValue: 'Columns' })}: {fmtList(detectedHeaders)})
                </span>
              )}
            </div>
          )}

          {rows.length === 0 && raw.trim().length > 0 && (
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={14} />
              <span className="text-xs">{t('boq.paste_no_data', { defaultValue: 'No valid rows detected. Make sure data is tab-separated.' })}</span>
            </div>
          )}

          {/* Nothing is dropped in silence: tell the user what could not be read. */}
          {(skippedEmpty > 0 || invalidNumbers > 0) && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
              {skippedEmpty > 0 && (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertTriangle size={14} />
                  <span className="text-xs">
                    {t('boq.paste_skipped_rows', { defaultValue: '{{count}} rows had no description and were skipped', count: skippedEmpty })}
                  </span>
                </div>
              )}
              {invalidNumbers > 0 && (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertTriangle size={14} />
                  <span className="text-xs">
                    {t('boq.paste_invalid_numbers', { defaultValue: '{{count}} number cells could not be read and kept their default (qty 1, rate 0)', count: invalidNumbers })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* The first row: header or line? The user has the last word. */}
          {raw.trim().length > 0 && (
            <label className="flex items-center gap-2 text-xs text-content-secondary">
              <input
                type="checkbox"
                checked={headerSkipped}
                onChange={(e) => setHeaderOverride(e.target.checked)}
              />
              {t('boq.paste_first_row_header', {
                defaultValue: 'The first row is a header and is not imported',
              })}
            </label>
          )}

          {/* Number format: say how it was read, and let the user change it. */}
          {numberFormat !== null && rows.length > 0 && (
            <div
              className={`space-y-1 rounded-lg border px-3 py-2 ${
                formatUnsettled ? 'border-amber-200 bg-amber-50/60 text-amber-700' : 'border-border-light text-content-secondary'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {formatUnsettled ? <AlertTriangle size={14} /> : <Info size={14} />}
                <span className="text-xs">
                  {t('boq.paste_number_format_read_as', {
                    defaultValue: 'Numbers read as {{example}}',
                    example: readingExample,
                  })}
                </span>
                <select
                  aria-label={t('boq.paste_number_format', { defaultValue: 'Number format' })}
                  className="ml-auto rounded border border-border-light bg-surface-primary px-1.5 py-0.5 text-xs"
                  value={convention}
                  onChange={(e) => setConvention(e.target.value as DecimalConvention | 'auto')}
                >
                  <option value="auto">{t('boq.paste_number_format_auto', { defaultValue: 'Detect automatically' })}</option>
                  <option value="point">1,234.56</option>
                  <option value="comma">1.234,56</option>
                </select>
              </div>
              {formatUnsettled && numberFormat.decidedBy === 'locale' && (
                <p className="text-xs">
                  {t('boq.paste_number_format_ambiguous', {
                    defaultValue:
                      'Values such as {{examples}} can be read two ways. They were read in the project\'s number format; check the preview and change the format if it is wrong.',
                    examples: fmtList(numberFormat.ambiguousCells.slice(0, 3)),
                  })}
                </p>
              )}
              {formatUnsettled && numberFormat.decidedBy === 'conflict' && (
                <p className="text-xs">
                  {t('boq.paste_number_format_mixed', {
                    defaultValue:
                      'The pasted numbers mix two formats ({{examples}}). Check the preview and choose the format.',
                    examples: fmtList(numberFormat.conflictingCells.slice(0, 3)),
                  })}
                </p>
              )}
            </div>
          )}

          {totalMismatches.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="text-xs">
                {t('boq.paste_total_mismatch', {
                  defaultValue:
                    '{{count}} rows: quantity × rate differs from the amount column ({{rows}}). Check the number format.',
                  count: totalMismatches.length,
                  rows: fmtList(totalMismatches.slice(0, 3)),
                })}
              </span>
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div className="overflow-x-auto max-h-60">
                <table className="w-full text-xs">
                  <thead className="bg-surface-secondary sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-content-secondary">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-content-secondary">{t('boq.description', { defaultValue: 'Description' })}</th>
                      <th className="px-3 py-2 text-center font-semibold text-content-secondary">{t('boq.unit', { defaultValue: 'Unit' })}</th>
                      <th className="px-3 py-2 text-right font-semibold text-content-secondary">{t('boq.quantity', { defaultValue: 'Qty' })}</th>
                      <th className="px-3 py-2 text-right font-semibold text-content-secondary">{t('boq.unit_rate', { defaultValue: 'Rate' })}</th>
                      <th className="px-3 py-2 text-right font-semibold text-content-secondary">{t('boq.total', { defaultValue: 'Total' })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={`${r.ordinal}-${i}`} className="hover:bg-surface-secondary/50">
                        <td className="px-3 py-1.5 font-mono text-content-tertiary">{r.ordinal}</td>
                        <td className="px-3 py-1.5 max-w-[300px] truncate">{r.description}</td>
                        <td className="px-3 py-1.5 text-center font-mono">{r.unit}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity.toLocaleString(getNumberLocale())}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.unit_rate.toLocaleString(getNumberLocale(), { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{(r.quantity * r.unit_rate).toLocaleString(getNumberLocale(), { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <div className="px-3 py-1.5 text-xs text-content-tertiary bg-surface-secondary text-center">
                  {t('boq.paste_showing', { defaultValue: 'Showing first 50 of {{total}} rows', total: rows.length })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-light bg-surface-secondary/30">
          <div className="text-xs text-content-secondary">
            {rows.length > 0 && (
              <span>
                {rows.length} {t('boq.positions', { defaultValue: 'positions' })} · {t('boq.total', { defaultValue: 'Total' })}: {totalSum.toLocaleString(getNumberLocale(), { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={15} />}
              onClick={handleImport}
              disabled={rows.length === 0 || loading}
              loading={loading}
            >
              {t('boq.import_rows', { defaultValue: 'Import {{count}} rows', count: rows.length })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
