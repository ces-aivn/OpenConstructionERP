// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Which cost base the cost database opens on.
 *
 * The server names the base of the reader's market (`/costs/regions/preferred/`:
 * the active project's currency or country, else the interface language). The
 * page opens on it when it is loaded, and falls back to the first loaded base
 * that is not a user catalogue's tag otherwise. A base the page picked by
 * itself may later follow a market change; one the reader chose never does.
 */

/** The first base to show, or '' when nothing is loaded. */
export function chooseInitialRegion({
  preferred,
  loadedRegions,
  catalogNames,
}: {
  preferred: string | null | undefined;
  loadedRegions: readonly string[] | undefined;
  catalogNames: ReadonlySet<string>;
}): string {
  if (!loadedRegions || loadedRegions.length === 0) return '';
  if (preferred && loadedRegions.includes(preferred)) return preferred;
  return loadedRegions.find((r) => !catalogNames.has(r)) ?? '';
}

/** Whether the shown base should follow a new market answer. */
export function shouldFollowMarket({
  market,
  activeRegion,
  autoPicked,
  loadedRegions,
}: {
  market: string | null | undefined;
  activeRegion: string;
  autoPicked: string;
  loadedRegions: readonly string[] | undefined;
}): boolean {
  if (!market || !loadedRegions?.includes(market)) return false;
  if (!activeRegion || activeRegion === market) return false;
  return activeRegion === autoPicked;
}

const AUTO_PICKED_REGION_KEY = 'oe_costs_region_autopicked';

export function readAutoPickedRegion(): string {
  try {
    return localStorage.getItem(AUTO_PICKED_REGION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeAutoPickedRegion(region: string): void {
  try {
    if (region) localStorage.setItem(AUTO_PICKED_REGION_KEY, region);
    else localStorage.removeItem(AUTO_PICKED_REGION_KEY);
  } catch {
    // Storage unavailable (private mode): the page simply re-picks next time.
  }
}
