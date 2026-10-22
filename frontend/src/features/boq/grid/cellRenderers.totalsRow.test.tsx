/**
 * The totals rows under the bill show an amount only: no quantity and no rate
 * placeholder "0" beside "Direct cost" or "Net total".
 */
import type { ICellRendererParams } from 'ag-grid-community';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuantityCellRenderer, UnitRateCellRenderer } from './cellRenderers';

const t = (k: string, o?: Record<string, string | number>) => String(o?.defaultValue ?? k);

function footer(field: 'quantity' | 'unit_rate') {
  return {
    data: {
      _isFooter: true,
      _footerType: 'net_total',
      id: '_net_total',
      description: 'NET TOTAL',
      ordinal: '',
      unit: '',
      quantity: 0,
      unit_rate: 0,
      total: 1250000,
    },
    value: 0,
    colDef: { field },
    context: { t, locale: 'vi-VN', currencyCode: 'VND' },
  } as unknown as ICellRendererParams;
}

describe('a totals row', () => {
  it('leaves the unit rate cell empty', () => {
    const { container } = render(<UnitRateCellRenderer {...footer('unit_rate')} />);
    expect(container.textContent).toBe('');
  });

  it('leaves the quantity cell empty', () => {
    const { container } = render(<QuantityCellRenderer {...footer('quantity')} />);
    expect(container.textContent).toBe('');
  });
});
