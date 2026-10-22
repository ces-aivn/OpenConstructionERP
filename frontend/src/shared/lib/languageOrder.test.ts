import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { sortLanguagesByName } from './languageOrder';

describe('sortLanguagesByName', () => {
  it('orders the picker alphabetically by displayed name', () => {
    const names = sortLanguagesByName(SUPPORTED_LANGUAGES).map((l) => l.name);
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1]!.localeCompare(names[i]!, 'en', { sensitivity: 'base' })).toBeLessThanOrEqual(0);
    }
    expect(names).toHaveLength(SUPPORTED_LANGUAGES.length);
    // Two offered languages: English (US) sorts before Tiếng Việt by its
    // displayed name, although the registry lists Vietnamese first.
    expect(names).toEqual(['English (US)', 'Tiếng Việt']);
  });

  it('leaves the registry order (and its fallback at index 0) untouched', () => {
    sortLanguagesByName(SUPPORTED_LANGUAGES);
    expect(SUPPORTED_LANGUAGES[0]!.code).toBe('vi');
  });
});
