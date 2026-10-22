// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * ModuleHelpButton — used to launch the module's guided tour through the
 * global ProductTour. The VN/US build mounts no ProductTour, so this renders
 * nothing; the props stay so module headers keep compiling unchanged.
 */

import type { TourId } from './ProductTour';

export interface ModuleHelpButtonProps {
  /** Registered tour id to launch (must exist in TOUR_REGISTRY). */
  tourId: TourId;
  /** Optional extra classes for layout-specific tweaks. */
  className?: string;
}

export function ModuleHelpButton(_props: ModuleHelpButtonProps) {
  return null;
}
