// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { sidebarRowCount } from '../useProjectProfile';

describe('the module count a preset announces', () => {
  it('counts the sidebar rows the modules light up, not infrastructure modules', () => {
    expect(sidebarRowCount(['boq', 'costs', 'users', 'teams', 'i18n', 'uploads'])).toBe(2);
  });

  it('counts a row once however many modules back it', () => {
    expect(sidebarRowCount(['boq', 'boq'])).toBe(1);
  });

  it('is zero for no modules', () => {
    expect(sidebarRowCount([])).toBe(0);
  });
});
