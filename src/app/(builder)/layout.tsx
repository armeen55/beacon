/**
 * Builder shell layout — the customer-facing surface.
 *
 * CX1: placeholder layout with minimal chrome. CX3 replaces this with
 * the full 3-screen builder UI (audit + moves + rank). For now it just
 * wraps children in a branded container with a role indicator.
 *
 * Routing:
 *   - founder role → sees a link back to the operator shell at /
 *   - beta_customer / paid_customer role → this is their home
 */

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <span className="text-sm font-semibold tracking-tight">Beacon</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Builder Preview
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
