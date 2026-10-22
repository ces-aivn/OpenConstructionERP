// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('the projects list', () => {
  it('does not offer to install BIM converters from GitHub', () => {
    // Installing converter binaries is an administrator task; it stays on the
    // BIM page and in the module settings.
    const source = readFileSync(join(here, '..', 'ProjectsPage.tsx'), 'utf8');
    expect(source).not.toMatch(/BIMConverterStatusBanner/);
    const settings = readFileSync(join(here, '..', '..', 'settings', 'SettingsPage.tsx'), 'utf8');
    expect(settings).toMatch(/BIMConverterStatusBanner/);
  });
});
