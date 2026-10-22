// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Background for the auth pages: a soft wash in the CES Global teal. The
 * upstream animated estimate table and dashboard mock-up are left out so the
 * sign-in screens stay quiet.
 */
export function AuthBackground() {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none oce-auth-bg"
      aria-hidden="true"
      style={{
        background:
          'radial-gradient(ellipse 70% 60% at 85% 10%, rgba(1,151,178,0.08), transparent 70%),' +
          'radial-gradient(ellipse 60% 50% at 10% 95%, rgba(13,41,104,0.06), transparent 70%)',
      }}
    />
  );
}
