/**
 * A new line continues the numbering the bill already uses: 13 after 01 ... 12,
 * not 0020. The backend's next_position_ordinals applies the same rule.
 */
import { describe, it, expect } from 'vitest';

import { nextPositionOrdinals } from '../boqHelpers';

describe('nextPositionOrdinals', () => {
  it('continues a bill numbered one by one at its own width', () => {
    const sofi = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    expect(nextPositionOrdinals(sofi, null, 2)).toEqual(['13', '14']);
  });

  it('continues a section numbered one by one inside the section', () => {
    expect(nextPositionOrdinals(['01', '01.1', '01.2', '02'], '01', 1)).toEqual(['01.3']);
  });

  it('keeps the gap-of-10 scheme where the bill uses it', () => {
    expect(nextPositionOrdinals(['0010', '0020'], null, 1)).toEqual(['0030']);
    expect(nextPositionOrdinals(['01', '01.10', '01.15', '01.20'], '01', 1)).toEqual(['01.30']);
    expect(nextPositionOrdinals(['01', '01.010', '01.020'], '01', 1)).toEqual(['01.030']);
  });

  it('does not read section headers alone as one-by-one numbering', () => {
    expect(nextPositionOrdinals(['01'], null, 1)).toEqual(['0010']);
    expect(nextPositionOrdinals([], null, 2)).toEqual(['0010', '0020']);
  });
});
