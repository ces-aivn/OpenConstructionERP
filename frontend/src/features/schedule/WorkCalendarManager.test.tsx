// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const t = (key: string, opts: Record<string, unknown> = {}) =>
    String(opts.defaultValue ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(opts[k] ?? ''));
  return { ...actual, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

vi.mock('@/features/schedule-advanced/api', () => ({
  listCalendars: vi.fn(),
  createCalendar: vi.fn(),
  updateCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  listCalendarPresets: vi.fn(),
  createCalendarFromPreset: vi.fn(),
}));

import {
  createCalendarFromPreset,
  listCalendarPresets,
  listCalendars,
} from '@/features/schedule-advanced/api';
import { WorkCalendarManager } from './WorkCalendarManager';

const PRESETS = [
  { key: 'vn_6day', name: 'Vietnam, Mon-Sat 8h, public holidays', country: 'VN', work_days: [0, 1, 2, 3, 4, 5], work_hours_per_day: '8' },
  { key: 'vn_5day', name: 'Vietnam, Mon-Fri 8h, public holidays', country: 'VN', work_days: [0, 1, 2, 3, 4], work_hours_per_day: '8' },
  { key: 'us_federal', name: 'United States, Mon-Fri 8h, federal holidays', country: 'US', work_days: [0, 1, 2, 3, 4], work_hours_per_day: '8' },
];

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkCalendarManager projectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  useToastStore.setState({ toasts: [] });
  vi.mocked(listCalendars).mockResolvedValue([]);
  vi.mocked(listCalendarPresets).mockResolvedValue({ presets: PRESETS, default_preset: 'vn_6day', project_country: 'VN' });
  vi.mocked(createCalendarFromPreset).mockResolvedValue({ id: 'c1' });
});

describe('WorkCalendarManager ready-made calendars', () => {
  it('chooses the six-day Vietnamese calendar first for a project in Vietnam', async () => {
    view();
    const select = await screen.findByTestId('calendar-preset-select');
    await waitFor(() => expect(select).toHaveValue('vn_6day'));
    expect(select).toHaveTextContent('(recommended for this project)');
  });

  it('creates the chosen calendar as the default when the project has none', async () => {
    view();
    const select = await screen.findByTestId('calendar-preset-select');
    await waitFor(() => expect(select).toHaveValue('vn_6day'));
    fireEvent.change(select, { target: { value: 'us_federal' } });
    fireEvent.click(screen.getByTestId('calendar-add-preset'));
    await waitFor(() =>
      expect(createCalendarFromPreset).toHaveBeenCalledWith({
        project_id: 'p1',
        preset: 'us_federal',
        name: 'United States, Mon-Fri 8h, federal holidays',
        is_default: true,
      }),
    );
    await waitFor(() => expect(useToastStore.getState().toasts[0]?.title).toBe('Calendar created'));
  });

  it('says a refused span of years in words', async () => {
    vi.mocked(createCalendarFromPreset).mockRejectedValue(
      new ApiError(422, 'x', { detail: { error: 'calendar_preset_years_invalid', message: 'English', max_years: 30 } }),
    );
    view();
    const select = await screen.findByTestId('calendar-preset-select');
    await waitFor(() => expect(select).toHaveValue('vn_6day'));
    fireEvent.click(screen.getByTestId('calendar-add-preset'));
    await waitFor(() => expect(useToastStore.getState().toasts[0]?.message).toMatch(/1 to 30 years/));
  });
});
