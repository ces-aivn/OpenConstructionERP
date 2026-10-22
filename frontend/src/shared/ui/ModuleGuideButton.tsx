// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// ModuleGuideButton — used to open the module's "How it works" guide (and the
// sibling "Cases for this module" pill). The VN/US build ships without guided
// walkthroughs, so it renders nothing. The props stay so the ~100 module
// headers that place it keep compiling unchanged.

import type { ModuleGuideContent } from './ModuleGuide';

export interface ModuleGuideButtonProps {
  /** The guide content to teach when the button is clicked. */
  content: ModuleGuideContent;
  /** Optional extra classes for layout-specific tweaks. */
  className?: string;
  /** Optional override for the button label. Defaults to "How it works". */
  label?: string;
  /** Optional handler for the guide's closing CTA (last card). */
  onCta?: () => void;
}

export function ModuleGuideButton(_props: ModuleGuideButtonProps) {
  return null;
}
