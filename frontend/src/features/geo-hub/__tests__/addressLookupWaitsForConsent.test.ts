// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * A project page geocoded its address as soon as it opened, even after the
 * reader had answered "Do not send", and put the full address on the query
 * string. The lookup now asks whether addresses may leave the server first,
 * sends nothing when they may not, and carries the address in a POST body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const consent = vi.hoisted(() => ({
  answer: { state: 'deny', nominatim_url: null } as { state: string; nominatim_url: string | null } | Error,
}));

vi.mock('@/shared/lib/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: unknown,
    ) {
      super(statusText);
    }
  }
  return {
    ApiError,
    apiGet: vi.fn(async () => {
      if (consent.answer instanceof Error) throw consent.answer;
      return { mirror_url: null, photon_url: null, can_decide: true, ...consent.answer };
    }),
    apiPut: vi.fn(async (_path: string, body: { choice: string }) => ({
      state: body.choice,
      nominatim_url: body.choice === 'allow' ? 'https://geocoder.example.test' : null,
    })),
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
  };
});

import { _clearSuggestCacheForTests, geocodeSuggest, setGeocodingConsent } from '../api';

const fetchMock = vi.fn();

beforeEach(() => {
  _clearSuggestCacheForTests();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ query: 'x', suggestions: [], geocoder_disabled: false }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('looking up a project address', () => {
  it('sends nothing when the installation said "Do not send"', async () => {
    consent.answer = { state: 'deny', nominatim_url: null };
    const res = await geocodeSuggest('12 Tràng Tiền, Hoàn Kiếm, Hà Nội');
    expect(res).toEqual({ query: '12 Tràng Tiền, Hoàn Kiếm, Hà Nội', suggestions: [], geocoder_disabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing while the question is unanswered or cannot be read', async () => {
    consent.answer = { state: 'unanswered', nominatim_url: null };
    await geocodeSuggest('12 Tràng Tiền');
    _clearSuggestCacheForTests();
    consent.answer = new Error('403');
    await geocodeSuggest('12 Tràng Tiền');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the address in a POST body, never on the URL, once allowed', async () => {
    consent.answer = { state: 'allow', nominatim_url: 'https://geocoder.example.test' };
    await geocodeSuggest('  12 Tràng Tiền  ', { limit: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/geo-hub/geocode/suggest');
    expect(url).not.toContain('Tr');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ q: '12 Tràng Tiền', limit: 1 });
  });

  it('reads a changed answer at once', async () => {
    consent.answer = { state: 'deny', nominatim_url: null };
    await geocodeSuggest('Landmark 81');
    expect(fetchMock).not.toHaveBeenCalled();
    consent.answer = { state: 'allow', nominatim_url: 'https://geocoder.example.test' };
    await setGeocodingConsent({ choice: 'allow' });
    await geocodeSuggest('Landmark 81');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
