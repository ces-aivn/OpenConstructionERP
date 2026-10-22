// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * An NCR names who must correct it. The form refuses to send without a
 * severity and a responsible party, and the party is sent as a linked
 * record when one was picked or as a plain name when one was typed.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_NCR_FORM, ncrFormErrors, ncrFormPayload } from '../CreateNCRModal';
import { matchPartyOptions, type PartyOption } from '../PartyPicker';

describe('the create-NCR form', () => {
  it('reports a missing severity and responsible party', () => {
    const errors = ncrFormErrors({ ...EMPTY_NCR_FORM, title: 'T', description: 'D' });
    expect(errors).toEqual({ title: false, description: false, severity: true, responsible: true });
  });

  it('sends a typed party as a name without an id', () => {
    const payload = ncrFormPayload({
      ...EMPTY_NCR_FORM,
      title: 'T',
      description: 'D',
      severity: 'major',
      responsible: { id: '', name: '  Tổ đội cốp pha  ', kind: 'text' },
    });
    expect(payload.responsible_party_id).toBeNull();
    expect(payload.responsible_party_name).toBe('Tổ đội cốp pha');
    expect(payload.responsible_party_kind).toBe('text');
  });

  it('sends a picked subcontractor with its reference', () => {
    const payload = ncrFormPayload({
      ...EMPTY_NCR_FORM,
      severity: 'minor',
      responsible: { id: 'sub-1', name: 'Hoà Bình MEP', kind: 'subcontractor' },
    });
    expect(payload.responsible_party_id).toBe('sub-1');
    expect(payload.responsible_party_kind).toBe('subcontractor');
  });
});

describe('party suggestions', () => {
  const options: PartyOption[] = [
    { id: '1', name: 'Coteccons', kind: 'subcontractor' },
    { id: '2', name: 'An Phát Steel', kind: 'subcontractor', detail: 'structural steel' },
    { id: '3', name: 'Nguyen Van An', kind: 'user', detail: 'an@example.com' },
  ];

  it('puts names that start with the query first', () => {
    expect(matchPartyOptions(options, 'an').map((o) => o.id)).toEqual(['2', '3']);
  });

  it('also matches on the detail line', () => {
    expect(matchPartyOptions(options, 'steel').map((o) => o.id)).toEqual(['2']);
  });
});
