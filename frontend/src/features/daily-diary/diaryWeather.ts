// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The weather a site diary records for its day, as the create and edit forms
 * show it and as the diary stores it.
 *
 * The diary keeps a `weather_summary` snapshot in metric, with the keys the
 * PDF export and the insights panel already read (`conditions`, `temp_c`,
 * `precipitation_mm`, `wind_kmh`). A user on imperial units types °F, inches
 * and mph; this module converts at the form boundary so the stored record is
 * always metric and every reader agrees on it. Keys the form does not edit
 * (humidity from a sensor, say) are carried through untouched.
 */

import type { MeasurementSystem } from '@/stores/usePreferencesStore';

/** Condition codes the form offers, mild to severe. Readers know them all. */
export const DIARY_WEATHER_CONDITIONS = [
  'clear',
  'partly_cloudy',
  'cloudy',
  'overcast',
  'fog',
  'rain',
  'rain_heavy',
  'thunderstorm',
  'snow',
] as const;

/** English fallbacks for `daily_diary.insights.weather_<code>`. */
export const DIARY_WEATHER_LABELS: Record<string, string> = {
  clear: 'Clear',
  partly_cloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  fog: 'Fog',
  rain: 'Rain',
  rain_heavy: 'Heavy rain',
  thunderstorm: 'Thunderstorm',
  snow: 'Snow',
};

/** What the form edits: strings, so an empty field means "not recorded". */
export interface DiaryWeatherForm {
  conditions: string;
  temperature: string;
  precipitation: string;
  wind: string;
}

export const EMPTY_DIARY_WEATHER: DiaryWeatherForm = {
  conditions: '',
  temperature: '',
  precipitation: '',
  wind: '',
};

/** Units the form labels its inputs with, by measurement system. */
export function diaryWeatherUnits(system: MeasurementSystem): {
  temperature: string;
  precipitation: string;
  wind: string;
} {
  return system === 'imperial'
    ? { temperature: '°F', precipitation: 'in', wind: 'mph' }
    : { temperature: '°C', precipitation: 'mm', wind: 'km/h' };
}

/** Plausible bounds in metric, so a typo cannot reach the record. */
const BOUNDS = {
  temp_c: { min: -60, max: 60 },
  precipitation_mm: { min: 0, max: 1000 },
  wind_kmh: { min: 0, max: 400 },
} as const;

const MM_PER_INCH = 25.4;
const KMH_PER_MPH = 1.609344;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function first(summary: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (summary[k] !== undefined && summary[k] !== null && summary[k] !== '') return summary[k];
  }
  return undefined;
}

/** Fill the form from a stored snapshot, in the user's units. */
export function weatherFormFromSummary(
  summary: Record<string, unknown> | null | undefined,
  system: MeasurementSystem,
): DiaryWeatherForm {
  const s = summary ?? {};
  const imperial = system === 'imperial';
  const temp = num(first(s, ['temp_c', 'temperature_c']));
  const precip = num(first(s, ['precipitation_mm', 'precip_mm']));
  const wind = num(first(s, ['wind_kmh', 'wind_speed_kmh']));
  const cond = first(s, ['conditions', 'condition']);
  return {
    conditions: typeof cond === 'string' ? cond : '',
    temperature: temp === null ? '' : String(round1(imperial ? (temp * 9) / 5 + 32 : temp)),
    precipitation: precip === null ? '' : String(round1(imperial ? precip / MM_PER_INCH : precip)),
    wind: wind === null ? '' : String(round1(imperial ? wind / KMH_PER_MPH : wind)),
  };
}

/** Which form field is out of its plausible range, if any. */
export type DiaryWeatherError = 'temperature' | 'precipitation' | 'wind';

/**
 * The metric snapshot to store for a form, merged over `base` (the diary's
 * current snapshot). An emptied field removes its keys. Returns the field in
 * error instead when a value is not a number or is out of range.
 */
export function weatherSummaryFromForm(
  form: DiaryWeatherForm,
  system: MeasurementSystem,
  base: Record<string, unknown> | null | undefined = {},
): { summary: Record<string, unknown> } | { error: DiaryWeatherError } {
  const imperial = system === 'imperial';
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const k of ['conditions', 'condition', 'temp_c', 'temperature_c', 'precipitation_mm', 'precip_mm', 'wind_kmh', 'wind_speed_kmh']) {
    delete out[k];
  }
  if (form.conditions.trim()) out.conditions = form.conditions.trim();

  const fields: Array<[DiaryWeatherError, string, keyof typeof BOUNDS, (v: number) => number]> = [
    ['temperature', form.temperature, 'temp_c', (v) => (imperial ? ((v - 32) * 5) / 9 : v)],
    ['precipitation', form.precipitation, 'precipitation_mm', (v) => (imperial ? v * MM_PER_INCH : v)],
    ['wind', form.wind, 'wind_kmh', (v) => (imperial ? v * KMH_PER_MPH : v)],
  ];
  for (const [field, raw, key, toMetric] of fields) {
    if (raw.trim() === '') continue;
    const v = num(raw);
    if (v === null) return { error: field };
    const metric = round1(toMetric(v));
    if (metric < BOUNDS[key].min || metric > BOUNDS[key].max) return { error: field };
    out[key] = metric;
  }
  return { summary: out };
}
