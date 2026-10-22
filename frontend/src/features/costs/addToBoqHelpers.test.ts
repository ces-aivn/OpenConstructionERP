// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// buildBoqPositionDraft — full-fidelity carry-over of resources + variants
// when a cost item is added from /costs into a BOQ. Founder bug 2026-06-06:
// the /costs add path used the lite list row (components: [], no variants)
// and dropped every resource and the variant reference. The fix fetches the
// full item and runs it through this helper.

import { describe, it, expect } from 'vitest';
import {
  addToBoqFailureMessage,
  buildBoqPositionDraft,
  firstWritableBoq,
  massEffectiveUnitRate,
  ordinalsForAddedItems,
  type FullCostItem,
} from './addToBoqHelpers';
import { ApiError } from '@/shared/lib/api';
import type { CostVariant, VariantStats } from './api';

const LABELS = { labor: 'Labor', material: 'Material', equipment: 'Equipment' };

function baseItem(over: Partial<FullCostItem> = {}): FullCostItem {
  return {
    id: 'item-1',
    code: 'C-001',
    description: 'Concrete C30/37 wall',
    unit: 'm3',
    rate: 320,
    currency: 'EUR',
    region: 'DE_BERLIN',
    classification: { collection: 'Concrete' },
    components: [],
    metadata_: {},
    source: 'cwicr',
    ...over,
  };
}

describe('buildBoqPositionDraft', () => {
  it('carries ALL components as metadata.resources', () => {
    const item = baseItem({
      components: [
        { name: 'Concrete C30/37', code: 'BET', type: 'material', unit: 'm3', quantity: 1, unit_rate: 185, cost: 185 },
        { name: 'Rebar 8mm', code: 'REB', type: 'material', unit: 'kg', quantity: 90, unit_rate: 1.5, cost: 135 },
        { name: 'Formwork labour', code: 'LAB', type: 'labor', unit: 'h', quantity: 4, unit_rate: 32.5, cost: 130 },
      ],
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    expect(resources).toHaveLength(3);
    expect(resources.map((r) => r.name)).toEqual([
      'Concrete C30/37',
      'Rebar 8mm',
      'Formwork labour',
    ]);
    // unit_rate = sum of resource totals = 185 + 135 + 130 = 450.
    expect(unitRate).toBe(450);
    // Each resource carries the resolved currency.
    expect(resources.every((r) => r.currency === 'EUR')).toBe(true);
    // Cost breakdown summary by type.
    expect(metadata.cost_breakdown).toEqual({ material: 320, labor: 130 });
    expect(metadata.resource_count).toBe(3);
    expect(metadata.cost_item_id).toBe('item-1');
  });

  it('falls back to the mean for a variant-bearing component the catalogue left unpriced', () => {
    const variants: CostVariant[] = [
      { index: 0, label: 'C25/30', price: 165, price_per_unit: null },
      { index: 1, label: 'C30/37', price: 185, price_per_unit: null },
      { index: 2, label: 'C35/45', price: 215, price_per_unit: null },
    ];
    const stats: VariantStats = {
      min: 165,
      max: 215,
      mean: 188,
      median: 185,
      unit: 'm3',
      group: '',
      count: 3,
      common_start: 'Ready-mix concrete',
    };
    const item = baseItem({
      components: [
        {
          name: 'Ready-mix concrete',
          code: 'BET',
          type: 'material',
          unit: 'm3',
          quantity: 1,
          unit_rate: 0,
          available_variants: variants,
          available_variant_stats: stats,
        },
      ],
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    expect(resources).toHaveLength(1);
    const r = resources[0]!;
    expect(r.variant_default).toBe('mean');
    expect(r.unit_rate).toBe(188); // mean
    expect(r.available_variants).toEqual(variants);
    expect(r.available_variant_stats).toEqual(stats);
    expect(unitRate).toBe(188);
  });

  it('appends a top-level abstract-resource variant set as one resource line', () => {
    const variants: CostVariant[] = [
      { index: 0, label: 'delivered', price: 180, price_per_unit: null },
      { index: 1, label: 'pumped', price: 200, price_per_unit: null },
    ];
    const stats: VariantStats = {
      min: 180,
      max: 200,
      mean: 190,
      median: 190,
      unit: 'm3',
      group: '',
      count: 2,
      common_start: 'Concrete delivery',
    };
    const item = baseItem({ components: [], metadata_: { variants, variant_stats: stats } });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    expect(resources).toHaveLength(1);
    const top = resources[0]!;
    // Priced at the catalogue rate the cost database showed, not the mean.
    expect(top.unit_rate).toBe(320);
    expect(top.variant_default).toBeUndefined();
    expect(top.name).toBe('Concrete delivery');
    expect(unitRate).toBe(320);
    // Variant catalog cached at the top level for the inline re-pick.
    expect(metadata.cost_item_variant_count).toBe(2);
    expect(top.available_variants).toEqual(variants);
    // The heavy variants array is NOT duplicated at the top level.
    expect(metadata.variants).toBeUndefined();
  });

  it('does NOT double-count a top-level variant mirrored on a component', () => {
    const variants: CostVariant[] = [
      { index: 0, label: 'C25/30', price: 165, price_per_unit: null },
      { index: 1, label: 'C30/37', price: 185, price_per_unit: null },
    ];
    const stats: VariantStats = {
      min: 165, max: 185, mean: 175, median: 175, unit: 'm3', group: '', count: 2,
    };
    const item = baseItem({
      components: [
        {
          name: 'Ready-mix concrete',
          code: 'BET',
          type: 'material',
          unit: 'm3',
          quantity: 1,
          unit_rate: 0,
          available_variants: variants,
          available_variant_stats: stats,
        },
      ],
      metadata_: { variants, variant_stats: stats },
    });
    const { metadata } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    // Only the component line — no synthetic top-level duplicate.
    expect(resources).toHaveLength(1);
  });

  it('keeps the catalogue price of a variant slot, so the line lands on the rate the database showed', () => {
    const variants: CostVariant[] = [
      { index: 0, label: 'M300', price: 1_480_000, price_per_unit: null },
      { index: 1, label: 'M350', price: 1_720_000, price_per_unit: null },
      { index: 2, label: 'M400', price: 1_960_000, price_per_unit: null },
    ];
    const stats: VariantStats = {
      min: 1_480_000, max: 1_960_000, mean: 1_720_000, median: 1_720_000, unit: 'm3', group: '', count: 3,
    };
    const item = baseItem({
      rate: 2_115_000,
      components: [
        {
          name: 'Bê tông thương phẩm', code: 'BT', type: 'material', unit: 'm3',
          quantity: 1.015, unit_rate: 1_500_000, cost: 1_522_500,
          available_variants: variants, available_variant_stats: stats,
        },
        { name: 'Nhân công 3,5/7', code: 'NC', type: 'labor', unit: 'công', quantity: 1.5, unit_rate: 395_000, cost: 592_500 },
      ],
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'VND', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;

    expect(unitRate).toBe(2_115_000);
    expect(resources[0]!.unit_rate).toBe(1_500_000);
    expect(resources[0]!.total).toBe(1_522_500);
    expect(resources[0]!.variant_default).toBeUndefined();
    // The other grades are still one click away on the BOQ row.
    expect(resources[0]!.available_variants).toEqual(variants);
  });

  it('prices a top-level variant set at what the catalogue rate leaves after the components', () => {
    const variants: CostVariant[] = [
      { index: 0, label: 'delivered', price: 180, price_per_unit: null },
      { index: 1, label: 'pumped', price: 200, price_per_unit: null },
    ];
    const stats: VariantStats = { min: 180, max: 200, mean: 190, median: 190, unit: 'm3', group: '', count: 2 };
    const item = baseItem({
      rate: 320,
      components: [{ name: 'Labour', code: 'LAB', type: 'labor', unit: 'h', quantity: 4, unit_rate: 30, cost: 120 }],
      metadata_: { variants, variant_stats: stats },
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;

    expect(resources.map((r) => r.total)).toEqual([120, 200]);
    expect(unitRate).toBe(320);
  });

  it('synthesizes labor/material/equipment lines when no components but cost summary present', () => {
    const item = baseItem({
      components: [],
      metadata_: { labor_cost: 50, material_cost: 120, equipment_cost: 30 },
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    expect(resources).toHaveLength(3);
    expect(resources.map((r) => r.type)).toEqual(['labor', 'material', 'equipment']);
    expect(unitRate).toBe(200);
  });

  it('falls back to the catalog rate when there is no breakdown at all', () => {
    const item = baseItem({ components: [], metadata_: {}, rate: 99 });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    expect(metadata.resources).toBeUndefined();
    expect(unitRate).toBe(99);
  });

  it('stamps the resolved currency onto metadata for the FX rollup', () => {
    const item = baseItem({ currency: 'AED', region: 'AE_DUBAI' });
    const { metadata } = buildBoqPositionDraft(item, 'AED', LABELS);
    expect(metadata.currency).toBe('AED');
    expect(metadata.cost_item_currency).toBe('AED');
  });

  it('converts a mass-priced section (360UB) to a per-metre rate + one resource', () => {
    // 360UB: 44.7 kg/m priced at 1850 per tonne -> 82.695 per metre.
    const item = baseItem({
      code: '360UB',
      description: '360 mm Universal Beam',
      unit: 'm',
      rate: 1850,
      classification: { collection: 'Structural Steel' },
      mass_per_unit: '44.7',
      mass_basis: 't',
    });
    const { metadata, unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    expect(unitRate).toBeCloseTo(82.695, 6);
    const resources = metadata.resources as Array<Record<string, unknown>>;
    expect(resources).toHaveLength(1);
    expect(resources[0]!.unit).toBe('m');
    expect(resources[0]!.quantity).toBe(1);
    expect(resources[0]!.unit_rate).toBeCloseTo(82.695, 6);
    // The position unit_rate must equal Σ(quantity × unit_rate) (BOQ invariant).
    expect(unitRate).toBeCloseTo(
      (resources[0]!.quantity as number) * (resources[0]!.unit_rate as number),
      6,
    );
    // Mass driver recorded for the row / exports.
    expect(metadata.mass_basis).toBe('t');
    expect(metadata.mass_per_unit).toBe('44.7');
    expect(metadata.mass_rate).toBe('1850');
  });

  it('prices per kg the same as the equivalent per-tonne rate', () => {
    const item = baseItem({ unit: 'm', rate: 1.85, mass_per_unit: '44.7', mass_basis: 'kg' });
    const { unitRate } = buildBoqPositionDraft(item, 'EUR', LABELS);
    expect(unitRate).toBeCloseTo(82.695, 6);
  });

  it('ignores mass pricing when basis is empty (falls back to catalog rate)', () => {
    const item = baseItem({ unit: 'm', rate: 99, mass_per_unit: '44.7', mass_basis: '' });
    const { unitRate, metadata } = buildBoqPositionDraft(item, 'EUR', LABELS);
    expect(unitRate).toBe(99);
    expect(metadata.mass_basis).toBeUndefined();
  });
});

describe('massEffectiveUnitRate', () => {
  it('per tonne: mass * rate / 1000', () => {
    expect(massEffectiveUnitRate(1850, '44.7', 't')).toBeCloseTo(82.695, 6);
  });
  it('per kg: mass * rate', () => {
    expect(massEffectiveUnitRate(1.85, '44.7', 'kg')).toBeCloseTo(82.695, 6);
  });
  it('returns null when not mass-priced or inputs invalid', () => {
    expect(massEffectiveUnitRate(1850, '44.7', '')).toBeNull();
    expect(massEffectiveUnitRate(1850, '0', 't')).toBeNull();
    expect(massEffectiveUnitRate(1850, undefined, 't')).toBeNull();
    expect(massEffectiveUnitRate(-1, '44.7', 't')).toBeNull();
  });
});

describe('the Add to BOQ dialog', () => {
  const t = (key: string, o?: Record<string, string | number>) => `${key}|${String(o?.defaultValue ?? '')}`;

  it('never preselects a locked bill', () => {
    const boqs = [
      { id: 'sofi', is_locked: true },
      { id: 'l81', is_locked: false },
    ];
    expect(firstWritableBoq(boqs)?.id).toBe('l81');
    expect(firstWritableBoq([{ id: 'sofi', is_locked: true }])).toBeUndefined();
  });

  it('continues a bill numbered 01 to 09 at 10, not at 01.031', () => {
    const positions = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, ordinal: String(i + 1).padStart(2, '0') }));
    expect(ordinalsForAddedItems(positions, '', 2)).toEqual(['10', '11']);
  });

  it('numbers the lines under the chosen section', () => {
    const positions = [
      { id: 's1', ordinal: '01' },
      { id: 'a', ordinal: '01.10' },
      { id: 'b', ordinal: '01.20' },
    ];
    expect(ordinalsForAddedItems(positions, 's1', 1)).toEqual(['01.30']);
  });

  it('names a locked bill when the server refuses the add', () => {
    const locked = new ApiError(409, 'Conflict', {
      detail: { code: 'boq_locked', message: 'BOQ is locked and cannot be modified.', params: {} },
    });
    expect(addToBoqFailureMessage(locked, t)).toMatch(/^costs\.add_to_boq_locked\|/);
  });

  it('shows the reason of any other failure', () => {
    expect(addToBoqFailureMessage(new Error('Network down'), t)).toBe('Network down');
    expect(addToBoqFailureMessage('??', t)).toBe('common.unknown_error|Unknown error');
  });
});
