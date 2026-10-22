// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { buildDailyDiaryInsights } from './dailyDiaryInsights';
import {
  EMPTY_DIARY_WEATHER,
  diaryWeatherUnits,
  weatherFormFromSummary,
  weatherSummaryFromForm,
} from './diaryWeather';

const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

describe('diary weather form', () => {
  it('stores what a metric user types as the metric snapshot readers use', () => {
    const result = weatherSummaryFromForm(
      { conditions: 'rain_heavy', temperature: '14.5', precipitation: '32', wind: '' },
      'metric',
    );
    expect(result).toEqual({ summary: { conditions: 'rain_heavy', temp_c: 14.5, precipitation_mm: 32 } });
  });

  it('converts imperial input to metric and back', () => {
    const result = weatherSummaryFromForm(
      { conditions: 'clear', temperature: '68', precipitation: '1', wind: '10' },
      'imperial',
    );
    expect(result).toEqual({ summary: { conditions: 'clear', temp_c: 20, precipitation_mm: 25.4, wind_kmh: 16.1 } });
    if (!('summary' in result)) throw new Error('expected a summary');
    expect(weatherFormFromSummary(result.summary, 'imperial')).toEqual({
      conditions: 'clear',
      temperature: '68',
      precipitation: '1',
      wind: '10',
    });
    expect(diaryWeatherUnits('imperial').temperature).toBe('°F');
    expect(diaryWeatherUnits('metric').precipitation).toBe('mm');
  });

  it('keeps keys the form does not edit and drops ones the user emptied', () => {
    const result = weatherSummaryFromForm(EMPTY_DIARY_WEATHER, 'metric', {
      conditions: 'fog',
      temp_c: 4,
      humidity_pct: 90,
    });
    expect(result).toEqual({ summary: { humidity_pct: 90 } });
  });

  it('names the field holding an implausible value instead of storing it', () => {
    expect(weatherSummaryFromForm({ ...EMPTY_DIARY_WEATHER, temperature: '95' }, 'metric')).toEqual({
      error: 'temperature',
    });
    expect(weatherSummaryFromForm({ ...EMPTY_DIARY_WEATHER, wind: '-3' }, 'metric')).toEqual({ error: 'wind' });
  });
});

describe('diary insights read the weather the form stores', () => {
  it('slices site days by the recorded condition', () => {
    const { datasets } = buildDailyDiaryInsights(
      [
        { diary_date: '2020-01-15', status: 'open', labour_count: 3000, equipment_count: 45, weather_summary: { conditions: 'rain' } },
        { diary_date: '2020-01-16', status: 'open', labour_count: 2800, equipment_count: 40, weather_summary: {} },
      ],
      '',
      t,
    );
    const rows = datasets[0]!.rows;
    expect(rows.map((r) => r.weather)).toEqual(['Rain', 'Not recorded']);
    expect(rows.map((r) => r.month)).toEqual(['2020-01', '2020-01']);
  });
});
