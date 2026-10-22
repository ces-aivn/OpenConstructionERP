// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityProgressEditor } from './ActivityProgressEditor';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const t = (key: string, opts: Record<string, unknown> = {}) =>
    String(opts.defaultValue ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(opts[k] ?? ''));
  return { ...actual, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const task = { id: 'a1', progress_pct: 40, activity_type: 'task' };

describe('ActivityProgressEditor', () => {
  it('saves a typed percentage', () => {
    const onSave = vi.fn();
    render(<ActivityProgressEditor activity={task} onSave={onSave} />);
    const input = screen.getByTestId('activity-progress-input');
    expect(input).toHaveValue(40);
    expect(screen.getByTestId('activity-progress-save')).toBeDisabled();
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.click(screen.getByTestId('activity-progress-save'));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(75);
  });

  it('refuses a value outside 0 to 100 and says why', () => {
    const onSave = vi.fn();
    render(<ActivityProgressEditor activity={task} onSave={onSave} />);
    fireEvent.change(screen.getByTestId('activity-progress-input'), { target: { value: '120' } });
    expect(screen.getByText('Enter a whole number from 0 to 100.')).toBeInTheDocument();
    expect(screen.getByTestId('activity-progress-save')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('activity-progress-input'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a section progress as rolled up and offers no field', () => {
    render(<ActivityProgressEditor activity={{ ...task, activity_type: 'summary', progress_pct: 30 }} onSave={vi.fn()} />);
    expect(screen.getByTestId('activity-progress-readonly')).toHaveTextContent('30%, rolled up');
    expect(screen.queryByTestId('activity-progress-input')).toBeNull();
  });

  it('shows the value only to a reader who may not edit', () => {
    render(<ActivityProgressEditor activity={task} disabled onSave={vi.fn()} />);
    expect(screen.getByTestId('activity-progress-readonly')).toHaveTextContent('Progress: 40%');
  });
});
