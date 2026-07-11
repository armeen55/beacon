/**
 * ShellLoading - the route-level skeleton for the shell. Wave 3B aligned it to Today's
 * mission-control shape: a greeting bar, then the ONE command block (CommandCardSkeleton,
 * h-28 to match the CockpitSkeleton in page.tsx), then a compact status area. Token-only so
 * it renders correctly in light and dark and adds nothing to the raw-palette ratchet.
 */
export default function ShellLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <section className="space-y-2">
        <div className="h-7 w-48 max-w-full rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-md rounded-md bg-muted/25" />
      </section>
      <CommandCardSkeleton />
      <div className="h-56 rounded-2xl border border-border bg-surface-inset" />
      <div className="h-16 rounded-xl border border-border bg-surface-inset" />
    </div>
  );
}

/** The ONE command block (slot 2) while its loaders resolve: a single h-28 token card pulse. */
function CommandCardSkeleton() {
  return <div aria-hidden className="h-28 rounded-xl border border-border bg-surface-inset" />;
}
