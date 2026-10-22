// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Ground for the auth pages: the plain card surface, no tint or animation.
 */
export function AuthBackground() {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none oce-auth-bg bg-surface-primary"
      aria-hidden="true"
    />
  );
}
