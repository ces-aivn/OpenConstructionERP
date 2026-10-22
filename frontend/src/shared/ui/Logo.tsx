// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import clsx from 'clsx';

/** Product name shown wherever the app names itself. */
export const BRAND_NAME = 'CesCons';
/** CES Global teal, sampled from the logo wordmark. */
export const BRAND_TEAL = '#0197b2';
/** The full CES Global logo (mark + wordmark + tagline), transparent background. */
export const BRAND_LOGO_URL = '/brand/cescons-logo.png';
const BRAND_MARK_URL = '/brand/cescons-mark.png';

interface LogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Kept for callers; the raster mark has no entrance animation. */
  animate?: boolean;
  className?: string;
}

/* Icon sizes — compact so the text dominates */
const sizeMap = {
  xs: 'h-5 w-5',
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
  lg: 'h-10 w-10',
  xl: 'h-14 w-14',
};

/** Brand mark — the four CES Global tiles. */
export function Logo({ size = 'md', className }: LogoProps) {
  return (
    <img
      src={BRAND_MARK_URL}
      alt={BRAND_NAME}
      className={clsx(sizeMap[size], 'shrink-0 object-contain', className)}
      draggable={false}
    />
  );
}

/* ── LogoWithText ──────────────────────────────────────────────────────── */

interface LogoWithTextProps extends LogoProps {
  /** Kept for callers; there is no version suffix in the wordmark. */
  showVersion?: boolean;
}

/* Text sizes — larger than icon to make the name prominent */
const textSizeMap = {
  xs: 'text-[15px] leading-none',
  sm: 'text-[16px] leading-none',
  md: 'text-[17px] leading-none',
  lg: 'text-xl leading-none',
  xl: 'text-2xl leading-none',
};

const gapSizeMap = {
  xs: 'gap-1.5',
  sm: 'gap-2',
  md: 'gap-2',
  lg: 'gap-2.5',
  xl: 'gap-3',
};

/** "Ces" in the text colour, "Cons" in the brand teal. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={clsx('font-bold text-content-primary whitespace-nowrap', className)}
      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.02em' }}
    >
      Ces<span style={{ color: BRAND_TEAL }}>Cons</span>
    </span>
  );
}

/** Logo + brand name. */
export function LogoWithText({ size = 'md', animate, className }: LogoWithTextProps) {
  return (
    <div className={clsx('flex items-center', gapSizeMap[size], className)}>
      <Logo size={size} animate={animate} />
      <BrandWordmark className={textSizeMap[size]} />
    </div>
  );
}
