// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Startup language gate - the US English boot path.
//
// The counterpart of `i18nStartupLocaleGate.test.tsx`. The bundled base
// English (`en`) is not a language the picker offers: a US reader boots into
// `en-US`, which is a lazy overlay over that base. The overlay carries the
// product wording for the US build, so the first frame must not show base
// English where the overlay says otherwise. The boot therefore waits on the
// overlay chunk, and this file pins that contract: the gate exists, resolves
// only once the overlay is merged, and overlay wording beats the base. The
// scenarios live in separate files because the module under test resolves its
// language once, at evaluation time.
//
// Run:  npx vitest run src/app/__tests__/i18nStartupLocaleGate.en.test.tsx

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider, useTranslation } from 'react-i18next';

// Real react-i18next, not the harness-wide mock from src/test/setup.ts.
vi.unmock('react-i18next');

// Small fixtures instead of the ~3 MB shipped dictionaries - see the sibling
// suite for why the real files must stay out of the vitest transform.
const FIXTURES = vi.hoisted(() => ({
  // The bundled base English, the i18next fallback.
  EN: {
    'probe.title': 'Bill of quantities',
    'probe.action': 'Export',
  } as Record<string, string>,
  // The US English overlay, a lazy chunk that overrides the base for the keys it defines.
  EN_US: {
    'probe.title': 'Estimate',
  } as Record<string, string>,
}));

vi.mock('../locales/en', () => ({ default: { translation: FIXTURES.EN } }));
vi.mock('../locales/en-US.ts', () => ({ default: { translation: FIXTURES.EN_US } }));
vi.mock('@/modules/_registry', () => ({ getModuleTranslations: () => ({}) }));

type I18nModule = typeof import('../i18n');
let i18nMod: I18nModule;

beforeAll(async () => {
  window.localStorage.setItem('i18nextLng', 'en-US');
  i18nMod = await import('../i18n');
});

describe('startup language gate - stored US English locale', () => {
  it('gates on the US overlay chunk, because en-US is an overlay rather than the bundled base', () => {
    expect(i18nMod.initialLocaleReady).toBeInstanceOf(Promise);
  });

  it('shows the overlay wording, not the base English, once the gate resolves', async () => {
    await i18nMod.initialLocaleReady;
    expect(i18nMod.default.language).toBe('en-US');
    expect(i18nMod.default.t('probe.title')).toBe(FIXTURES.EN_US['probe.title']);
    // A key the overlay does not define falls back to the base English.
    expect(i18nMod.default.t('probe.action')).toBe(FIXTURES.EN['probe.action']);
  });

  it('resolves US English strings on a first render issued after the gate', async () => {
    await i18nMod.initialLocaleReady;
    expect(i18nMod.default.isInitialized).toBe(true);
    const KEYS = Object.keys(FIXTURES.EN);
    function Probe() {
      const { t } = useTranslation();
      return (
        <div>
          {KEYS.map((k) => (
            <span key={k} data-testid={`probe:${k}`}>
              {t(k)}
            </span>
          ))}
        </div>
      );
    }
    render(
      <I18nextProvider i18n={i18nMod.default}>
        <Probe />
      </I18nextProvider>,
    );
    for (const k of KEYS) {
      const expected = FIXTURES.EN_US[k] ?? FIXTURES.EN[k];
      expect(screen.getByTestId(`probe:${k}`).textContent).toBe(expected);
    }
  });
});
