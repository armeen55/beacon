/**
 * /proof route loading skeleton (Move 3) — stable dimensions matching the Results
 * layout (header → "Proof at a glance" tiles → ledger cards) so the heavy re-measure
 * read never flashes a blank page or shifts layout on cold navigation.
 */
export default function ProofLoading() {
  const cards = Array.from({ length: 4 }, (_, i) => i);
  return (
    <div className="max-w-3xl space-y-6 animate-pulse" aria-busy="true" aria-label="Loading results">
      {/* PageHeader */}
      <div className="space-y-2">
        <div className="h-7 w-32 rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-lg rounded-md bg-muted/25" />
      </div>
      {/* Proof at a glance */}
      <div className="rounded-3xl border border-gray-200 bg-gray-50/60 p-6">
        <div className="h-5 w-40 rounded bg-muted/35" />
        <div className="mt-2 h-4 w-3/4 rounded bg-muted/20" />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-20 rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      </div>
      {/* Ledger cards */}
      <div className="space-y-3">
        {cards.map((i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border/60 bg-background p-4">
            <div className="h-4 w-2/3 rounded bg-muted/30" />
            <div className="h-3 w-1/2 rounded bg-muted/20" />
            <div className="h-3 w-3/4 rounded bg-muted/15" />
          </div>
        ))}
      </div>
    </div>
  );
}
