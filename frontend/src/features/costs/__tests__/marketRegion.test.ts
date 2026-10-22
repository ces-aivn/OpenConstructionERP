// The cost database opens on the base of the reader's market, and follows a
// market change only over a base it picked by itself.
import { afterEach, describe, expect, it } from 'vitest';
import {
  chooseInitialRegion,
  readAutoPickedRegion,
  shouldFollowMarket,
  writeAutoPickedRegion,
} from '../marketRegion';

const LOADED = ['DE_BERLIN', 'USA_USD', 'VI_HANOI'];

afterEach(() => localStorage.clear());

describe('chooseInitialRegion', () => {
  it('opens on the market base when it is loaded', () => {
    expect(chooseInitialRegion({ preferred: 'VI_HANOI', loadedRegions: LOADED, catalogNames: new Set() })).toBe('VI_HANOI');
  });

  it('falls back to the first loaded base that is not a catalogue tag', () => {
    expect(
      chooseInitialRegion({ preferred: 'VN_NATIONAL', loadedRegions: ['My list', ...LOADED], catalogNames: new Set(['My list']) }),
    ).toBe('DE_BERLIN');
    expect(chooseInitialRegion({ preferred: '', loadedRegions: [], catalogNames: new Set() })).toBe('');
  });
});

describe('shouldFollowMarket', () => {
  it('replaces a base the page picked by itself', () => {
    expect(shouldFollowMarket({ market: 'USA_USD', activeRegion: 'VI_HANOI', autoPicked: 'VI_HANOI', loadedRegions: LOADED })).toBe(true);
  });

  it('keeps a base the reader chose', () => {
    expect(shouldFollowMarket({ market: 'USA_USD', activeRegion: 'DE_BERLIN', autoPicked: '', loadedRegions: LOADED })).toBe(false);
  });

  it('does nothing when the market base is not loaded or already shown', () => {
    expect(shouldFollowMarket({ market: 'VN_NATIONAL', activeRegion: 'VI_HANOI', autoPicked: 'VI_HANOI', loadedRegions: LOADED })).toBe(false);
    expect(shouldFollowMarket({ market: 'VI_HANOI', activeRegion: 'VI_HANOI', autoPicked: 'VI_HANOI', loadedRegions: LOADED })).toBe(false);
  });
});

describe('the auto-picked marker', () => {
  it('round-trips and clears', () => {
    writeAutoPickedRegion('VI_HANOI');
    expect(readAutoPickedRegion()).toBe('VI_HANOI');
    writeAutoPickedRegion('');
    expect(readAutoPickedRegion()).toBe('');
  });
});
