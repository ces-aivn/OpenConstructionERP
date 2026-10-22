// The command palette finds a screen by its name in either language, with or
// without Vietnamese tone marks, and by the words estimators actually type.
import { describe, expect, it } from 'vitest';
import { buildPageIndex, normalizeSearchText, scorePage } from '../commandPaletteIndex';

const index = buildPageIndex();
const byPath = (path: string) => {
  const entry = index.find((e) => e.path === path);
  if (!entry) throw new Error(`no catalogue entry for ${path}`);
  return entry;
};

describe('command palette page index', () => {
  it('indexes every sidebar screen once, contracts and the risk register included', () => {
    const paths = index.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('/contracts');
    expect(paths).toContain('/risks');
    expect(paths).toContain('/boq');
  });

  it('strips tone marks and the d-stroke', () => {
    expect(normalizeSearchText('  Hợp   ĐỒNG ')).toBe('hop dong');
  });

  it.each([
    ['hợp đồng', '/contracts'],
    ['hop dong', '/contracts'],
    ['contract', '/contracts'],
    ['rủi ro', '/risks'],
    ['risk', '/risks'],
    ['BOQ', '/boq'],
    ['bảng khối lượng', '/boq'],
  ])('finds %s', (query, path) => {
    // Labels deliberately empty: the synonyms alone must carry the match, so
    // the test does not depend on the locale bundle.
    expect(scorePage(byPath(path), [], query)).toBeGreaterThan(0);
  });

  it('ranks an exact name above a word that merely starts with the query', () => {
    const boq = scorePage(byPath('/boq'), ['Bảng khối lượng', 'Bill of Quantities'], 'boq');
    const other = scorePage(byPath('/projects'), ['Dự án', 'Projects'], 'boq');
    expect(boq).toBe(4);
    expect(other).toBe(0);
  });

  it('matches the translated label it is given', () => {
    expect(scorePage(byPath('/projects'), ['Dự án', 'Projects'], 'du an')).toBeGreaterThan(0);
    expect(scorePage(byPath('/projects'), ['Dự án', 'Projects'], '')).toBe(0);
  });
});
