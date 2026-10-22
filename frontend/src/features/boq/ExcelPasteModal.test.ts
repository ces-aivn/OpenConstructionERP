// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
import { describe, it, expect } from 'vitest';
import sofi from './__tests__/fixtures/uat_boq/BOQ_CS-US01_SoFi.csv?raw';
import penn from './__tests__/fixtures/uat_boq/BOQ_CS-US02_Penn.csv?raw';
import landmark from './__tests__/fixtures/uat_boq/BOQ_CS-VN01_Landmark81.csv?raw';
import lego from './__tests__/fixtures/uat_boq/BOQ_CS-VN02_LEGO.csv?raw';
import { assignOrdinals, parseRows, pastedRowsToBulkItems, splitPastedText } from './ExcelPasteModal';
import { nextPositionOrdinals } from './boqHelpers';

const FIXTURES: Record<string, string> = {
  'BOQ_CS-US01_SoFi.csv': sofi,
  'BOQ_CS-US02_Penn.csv': penn,
  'BOQ_CS-VN01_Landmark81.csv': landmark,
  'BOQ_CS-VN02_LEGO.csv': lego,
};
const fixture = (name: string) => FIXTURES[name] ?? '';

/** The same file as Excel puts it on the clipboard: tab-separated, unquoted. */
const asClipboard = (csv: string) => splitPastedText(csv).map((cells) => cells.join('\t')).join('\n');

const directCost = (raw: string, fallbackLocale: string) =>
  parseRows(raw, { fallbackLocale }).rows.reduce((s, r) => s + r.quantity * r.unit_rate, 0);

/**
 * parseRows is the pasted-clipboard parser behind the Excel paste modal.
 * These tests pin the honesty behaviour from issue #347: a cell that is not
 * a usable number, and a line without a description, must be counted and
 * reported rather than silently read as zero or dropped.
 */
describe('parseRows', () => {
  it('returns empty diagnostics for empty input', () => {
    expect(parseRows('')).toMatchObject({
      rows: [],
      detectedHeaders: [],
      skippedEmpty: 0,
      invalidNumbers: 0,
      headerSkipped: false,
      numberFormat: null,
      totalMismatches: [],
    });
  });

  it('detects a header row and parses the data below it', () => {
    const out = parseRows('Description\tUnit\tQty\tRate\nConcrete\tm3\t120\t185.00');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      description: 'Concrete',
      unit: 'm3',
      quantity: 120,
      unit_rate: 185,
    });
    expect(out.detectedHeaders).toContain('description');
    expect(out.invalidNumbers).toBe(0);
    expect(out.skippedEmpty).toBe(0);
  });

  it('falls back to positional order when there is no header row', () => {
    const out = parseRows('Excavation\tm3\t50\t12.5');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      description: 'Excavation',
      unit: 'm3',
      quantity: 50,
      unit_rate: 12.5,
    });
  });

  it('reads a European 1.234,56 grouping', () => {
    const out = parseRows('Rebar\tkg\t1.234,56\t1,45');
    expect(out.rows[0]?.quantity).toBeCloseTo(1234.56);
    expect(out.rows[0]?.unit_rate).toBeCloseTo(1.45);
    expect(out.invalidNumbers).toBe(0);
  });

  it('reads a US 1,234.56 grouping', () => {
    const out = parseRows('Formwork\tm2\t1,234.56\t22.00');
    expect(out.rows[0]?.quantity).toBeCloseTo(1234.56);
    expect(out.invalidNumbers).toBe(0);
  });

  it('counts an unreadable number and keeps a safe default instead of silent zero', () => {
    const out = parseRows('Description\tQty\nWall\tN/A');
    expect(out.rows).toHaveLength(1);
    // The bad quantity is not read as 0; it keeps the visible default (1) and
    // the modal warns the user via the invalidNumbers count.
    expect(out.rows[0]?.quantity).toBe(1);
    expect(out.invalidNumbers).toBe(1);
  });

  it('counts a line that has data but no description as skipped', () => {
    const out = parseRows('Description\tQty\n\t50');
    expect(out.rows).toHaveLength(0);
    expect(out.skippedEmpty).toBe(1);
  });

  it('does not flag empty numeric cells - they take the documented default', () => {
    // Quantity blank -> 1, rate blank -> 0, and neither counts as invalid.
    const out = parseRows('Description\tUnit\tQty\tRate\nDoor\tpcs\t\t');
    expect(out.rows[0]).toMatchObject({ quantity: 1, unit_rate: 0 });
    expect(out.invalidNumbers).toBe(0);
  });

  it('reports several problems across a mixed paste', () => {
    const raw = [
      'Description\tUnit\tQty\tRate',
      'Concrete\tm3\t10\t100', // clean
      'Steel\tkg\tzzz\t5', // bad quantity
      '\tm2\t4\t9', // no description
    ].join('\n');
    const out = parseRows(raw);
    expect(out.rows).toHaveLength(2);
    expect(out.invalidNumbers).toBe(1);
    expect(out.skippedEmpty).toBe(1);
  });
});

/**
 * The acceptance package's four bills, pasted the two ways a user pastes them:
 * the CSV file's text, and a copy out of Excel. Each must come out at its
 * reference direct cost, whatever the user's own number format is, because
 * the block's unambiguous numbers decide how "450,000" and "15.000" are read.
 */
describe('parseRows on the acceptance bills', () => {
  const bills: Array<[string, number, number]> = [
    ['BOQ_CS-US01_SoFi.csv', 12, 1_982_708_000],
    ['BOQ_CS-US02_Penn.csv', 13, 965_480_000],
    ['BOQ_CS-VN01_Landmark81.csv', 12, 1_930_150_000_000],
    ['BOQ_CS-VN02_LEGO.csv', 14, 8_574_100_000_000],
  ];

  it.each(bills)('%s reaches its reference direct cost', (name, lines, expected) => {
    const csv = fixture(name);
    for (const raw of [csv, asClipboard(csv)]) {
      for (const locale of ['vi-VN', 'en-US']) {
        const out = parseRows(raw, { fallbackLocale: locale });
        expect(out.rows).toHaveLength(lines);
        expect(out.headerSkipped).toBe(true);
        expect(out.invalidNumbers).toBe(0);
        expect(out.totalMismatches).toEqual([]);
        expect(out.numberFormat?.decidedBy).toBe('data');
        expect(directCost(raw, locale)).toBe(expected);
      }
    }
  });

  it('reads "450,000" in the SoFi bill as four hundred and fifty thousand', () => {
    const shoring = parseRows(fixture('BOQ_CS-US01_SoFi.csv')).rows[1];
    expect(shoring).toMatchObject({ unit: 'SF', quantity: 450000, unit_rate: 120 });
  });

  it('does not take the STT row counter as the position number', () => {
    const out = parseRows(fixture('BOQ_CS-VN01_Landmark81.csv'));
    expect(out.rows.every((r) => r.ordinal === '')).toBe(true);
    expect(out.detectedHeaders).toEqual(['description', 'unit', 'quantity', 'unit_rate', 'total']);
  });
});

describe('parseRows number format', () => {
  it('lets the project locale settle a block of ambiguous numbers and warns about it', () => {
    const raw = 'Description\tUnit\tQty\tRate\nShoring\tSF\t450,000\t120';
    const us = parseRows(raw, { fallbackLocale: 'en-US' });
    expect(us.rows[0]?.quantity).toBe(450000);
    expect(us.numberFormat).toMatchObject({ decidedBy: 'locale', ambiguousCells: ['450,000'] });
    expect(parseRows(raw, { fallbackLocale: 'vi-VN' }).rows[0]?.quantity).toBe(450);
  });

  it('reads the block in the format the user forces', () => {
    const raw = 'Shoring\tSF\t450,000\t120';
    expect(parseRows(raw, { fallbackLocale: 'vi-VN', convention: 'point' }).rows[0]?.quantity).toBe(450000);
  });

  it('flags a row whose amount column disagrees with quantity x rate', () => {
    const raw = 'Mô tả\tĐVT\tKL\tĐơn giá\tThành tiền\nCọc\tm3\t15.000\t8.500.000\t127.500.000\nTường\tm3\t2\t3\t6';
    expect(parseRows(raw).totalMismatches).toEqual(['Cọc']);
  });
});

describe('parseRows header row', () => {
  it('skips the Vietnamese header the dialog itself suggests', () => {
    const out = parseRows('Mô tả\tĐơn vị\tKL\tĐơn giá\nBê tông móng\tm3\t120\t1.850.000');
    expect(out.headerSkipped).toBe(true);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ description: 'Bê tông móng', unit: 'm3', quantity: 120, unit_rate: 1850000 });
    expect(out.invalidNumbers).toBe(0);
  });

  it('skips a text-only first row with unknown names above rows of numbers', () => {
    const out = parseRows('Hạng mục công việc\tĐV\tSố lượng thực\tGiá\nĐào đất\tm3\t300\t150.000');
    expect(out.headerSkipped).toBe(true);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.description).toBe('Đào đất');
  });

  it('imports the first row when the user says it is not a header', () => {
    const out = parseRows('Mô tả\tĐơn vị\tKL\tĐơn giá\nBê tông\tm3\t1\t2', { firstRowIsHeader: false });
    expect(out.rows).toHaveLength(2);
    expect(out.invalidNumbers).toBe(2);
  });

  it('keeps a single text-only line as a line', () => {
    const out = parseRows('Door\tpcs');
    expect(out.headerSkipped).toBe(false);
    expect(out.rows).toHaveLength(1);
  });
});

describe('assignOrdinals', () => {
  const rows = (ordinals: string[]) =>
    ordinals.map((ordinal) => ({ ordinal, description: 'x', unit: 'm', quantity: 1, unit_rate: 1 }));

  it('numbers pasted lines in the bill scheme, after the typed ones', () => {
    const existing = ['0010', '0020', '0030'];
    const next = (n: number) => nextPositionOrdinals(existing, null, n);
    expect(assignOrdinals(rows(['', '', '']), next, new Set(existing)).map((r) => r.ordinal)).toEqual([
      '0040',
      '0050',
      '0060',
    ]);
  });

  it('numbers lines pasted into a section under that section', () => {
    const existing = ['01', '01.10', '01.20'];
    const next = (n: number) => nextPositionOrdinals(existing, '01', n);
    expect(assignOrdinals(rows(['', '']), next, new Set(existing)).map((r) => r.ordinal)).toEqual(['01.30', '01.40']);
  });

  it('keeps a free position number the row brought and renumbers a taken one', () => {
    const existing = ['0010'];
    const next = (n: number) => nextPositionOrdinals(existing, null, n);
    expect(assignOrdinals(rows(['0020', '0010', '']), next, new Set(existing)).map((r) => r.ordinal)).toEqual([
      '0020',
      '0030',
      '0040',
    ]);
  });
});

describe('pastedRowsToBulkItems', () => {
  const row = { ordinal: '13', description: 'Cốt thép móng bè', unit: 'tấn', quantity: 6500, unit_rate: 15_500_000 };

  it('marks every pasted line as coming from Excel', () => {
    const [item] = pastedRowsToBulkItems([row], 'boq-1');
    expect(item).toEqual({ ...row, boq_id: 'boq-1', source: 'excel_import' });
  });

  it('files the lines under the section the paste targets', () => {
    expect(pastedRowsToBulkItems([row], 'boq-1', 'sec-1')[0]!.parent_id).toBe('sec-1');
  });
});
