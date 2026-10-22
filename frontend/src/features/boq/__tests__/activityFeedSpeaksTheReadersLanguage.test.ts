/**
 * The activity feed shows the stored English sentences through translation keys.
 */
import { describe, it, expect, vi } from 'vitest';

import { activityText } from '../activityText';

const vi_ = {
  'boq.activity.positions_added': 'Đã thêm {{count}} hạng mục',
  'boq.activity.position_updated': 'Cập nhật hạng mục {{ordinal}}',
} as Record<string, string>;

function vietnamese(key: string, opts?: Record<string, string | number>): string {
  const text = vi_[key] ?? String(opts?.defaultValue ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
}

describe('activityText', () => {
  it('reads a bulk paste in Vietnamese', () => {
    expect(activityText('Added 9 position(s)', vietnamese)).toBe('Đã thêm 9 hạng mục');
  });

  it('keeps the ordinal of the edited line', () => {
    expect(activityText('Updated position 0010', vietnamese)).toBe('Cập nhật hạng mục 0010');
  });

  it('passes the count as a number so plural forms apply', () => {
    const t = vi.fn(() => 'x');
    activityText('Reordered 12 positions', t);
    expect(t).toHaveBeenCalledWith('boq.activity.positions_reordered', expect.objectContaining({ count: 12 }));
  });

  it('carries a quoted name through, apostrophes and all', () => {
    const t = vi.fn((_k: string, o?: Record<string, string | number>) => String(o?.name));
    expect(activityText("Added position 'Bê tông móng M300 'đá 1x2''", t)).toBe("Bê tông móng M300 'đá 1x2'");
  });

  it('turns a delete with its internal id into a plain sentence', () => {
    const t = vi.fn((key: string, o?: Record<string, string | number>) => `${key}|${String(o?.defaultValue)}`);
    expect(activityText('Deleted position 6f1c2a52-0000-4000-8000-000000000000 (cascade=False)', t)).toBe(
      'boq.activity.position_deleted|Deleted a position',
    );
  });

  it('shows a sentence it does not know as it was stored', () => {
    const t = vi.fn(() => 'never');
    expect(activityText('Cost breakdown computed', t)).toBe('Cost breakdown computed');
    expect(t).not.toHaveBeenCalled();
  });
});
