// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
//
// Page backdrop mounted once in AppLayout, plus the route-to-section mapping
// it was keyed on.

export type BackdropVariant = 'dashboard' | 'estimation' | 'planning';

/**
 * Pick a backdrop variant from the current pathname. Mounted once in
 * AppLayout so per-page wrappers don't have to create their own stacking
 * context — and full-screen modals (z-50) keep covering the header
 * instead of being trapped beneath it.
 */
export function backdropVariantForPath(pathname: string): BackdropVariant {
  // Estimation/Kalkulation section + /files (user-requested grouping).
  // Pages: /boq, /match-elements, /costs, /assemblies, /catalog,
  // /bim/rules — and /files (Overview group but visually tied to
  // estimation per user direction on 2026-05-12).
  if (
    pathname === '/boq' ||
    pathname.startsWith('/boq/') ||
    pathname.startsWith('/match-elements') ||
    pathname.startsWith('/costs') ||
    pathname.startsWith('/assemblies') ||
    pathname.startsWith('/catalog') ||
    pathname.startsWith('/bim/rules') ||
    pathname === '/files' ||
    pathname.startsWith('/files/') ||
    /^\/projects\/[^/]+\/files/.test(pathname)
  ) {
    return 'estimation';
  }
  // Planning section
  if (
    pathname.startsWith('/schedule') ||
    pathname.startsWith('/tasks') ||
    pathname === '/5d' ||
    pathname.startsWith('/5d/') ||
    pathname.startsWith('/risks')
  ) {
    return 'planning';
  }
  // Everything else (dashboard, projects, …)
  return 'dashboard';
}

/**
 * The page ground behind every route: one flat surface. Panels separate from
 * it by their hairline borders, so the backdrop carries no tint, spotlight,
 * pointer halo or dot grid. `variant` stays in the signature so callers keep
 * compiling; every section now shares the same ground.
 */
export function DashboardBackdrop(_props: { variant?: BackdropVariant } = {}) {
  return (
    <div
      aria-hidden="true"
      className="dash-backdrop pointer-events-none fixed inset-0 -z-10 bg-surface-secondary"
    />
  );
}
