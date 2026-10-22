// The cost database offers its AI search switch only while the embedding
// model can answer.
import { describe, expect, it } from 'vitest';
import { semanticSearchReady } from '../useSemanticSearchReady';

describe('semanticSearchReady', () => {
  it('is ready only when the model is loaded', () => {
    expect(semanticSearchReady('ready')).toBe(true);
  });

  it('is not ready while semantic search is off, missing, downloading or failed', () => {
    for (const state of ['disabled', 'library_missing', 'not_requested', 'downloading', 'failed', undefined] as const) {
      expect(semanticSearchReady(state)).toBe(false);
    }
  });
});
