// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The cost per area benchmark of the 5D page.
 *
 * Pins that the building type comes from the project (and that nothing is
 * assumed when it names none), and that the area is typed in the reader's own
 * unit, so a US project is entered in square feet.
 *
 * Run:  npx vitest run src/features/costmodel/CostBenchmark.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { usePreferencesStore } from '@/stores/usePreferencesStore';
import { CostBenchmark, benchmarkTypeFor } from './CostBenchmark';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const text = String(opts?.defaultValue ?? key);
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

beforeEach(() => {
  usePreferencesStore.setState({ measurementSystem: 'metric' });
});

describe('benchmarkTypeFor', () => {
  it.each([
    ['Hospital', 'hospital'],
    ['Bệnh viện đa khoa', 'hospital'],
    ['Chung cư cao tầng', 'residential'],
    ['Office tower', 'office'],
    ['Nhà xưởng sản xuất', 'industrial'],
    ['Trường học', 'education'],
    ['Trung tâm thương mại', 'retail'],
  ])('reads %s as %s', (projectType, expected) => {
    expect(benchmarkTypeFor(projectType)).toBe(expected);
  });

  it.each([null, undefined, '', 'Stadium', 'Cầu vượt'])('assumes nothing for %s', (projectType) => {
    expect(benchmarkTypeFor(projectType)).toBe('');
  });
});

describe('CostBenchmark', () => {
  it("starts from the project's own building type", () => {
    render(<CostBenchmark totalBudget={6_500_000} currency="EUR" initialArea={1000} projectType="Bệnh viện" />);
    expect(screen.getByLabelText('Project Type')).toHaveValue('hospital');
    // 6,500 per m² is inside the hospital band (5,000 to 8,000), outside the residential one.
    expect(screen.getByText('Within range')).toBeInTheDocument();
  });

  it('gives no verdict until a building type is chosen when the project names none', () => {
    render(<CostBenchmark totalBudget={6_500_000} currency="EUR" initialArea={1000} projectType="Stadium" />);
    expect(screen.getByLabelText('Project Type')).toHaveValue('');
    expect(screen.queryByText('Within range')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside range')).not.toBeInTheDocument();
    expect(screen.getByText(/Choose the building type/)).toBeInTheDocument();
  });

  it('takes the area in square feet for an imperial reader', () => {
    usePreferencesStore.setState({ measurementSystem: 'imperial' });
    render(<CostBenchmark totalBudget={1_000_000} currency="USD" initialArea={100} projectType="Office" />);
    expect(screen.getByText(/Project Area \(ft/)).toBeInTheDocument();
    // 100 m² shows as about 1,076.39 ft².
    expect(Number((screen.getByLabelText(/Project Area/) as HTMLInputElement).value)).toBeCloseTo(1076.39, 1);
  });
});
