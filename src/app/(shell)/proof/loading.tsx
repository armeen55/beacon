/**
 * /proof route loading skeleton (Move 3, re-sized in item 22) - stable dimensions matching
 * the Results layout (header with action button, "Proof at a glance" tiles, then the three
 * outcome bands: wins, what we learned, in flight) so the heavy re-measure read never
 * flashes a blank page or shifts layout on cold navigation.
 */
export default function ProofLoading() {
  const bands = [
    { key: "wins", cards: 1 },
    { key: "learned", cards: 1 },
    { key: "inflight", cards: 2 },
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8 animate-pulse" aria-busy="true" aria-label="Loading results">
      {/* PageHeader + right-side action */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-7 w-32 rounded-md bg-muted/40" />
          <div className="h-4 w-full max-w-lg rounded-md bg-muted/25" />
        </div>
        <div className="h-8 w-32 shrink-0 rounded-md bg-muted/20" />
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
      {/* The three outcome bands: wins / what we learned / in flight. Each is a small
          uppercase heading, a helper line, then stacked result cards. */}
      <div className="space-y-4">
        {bands.map((band) => (
          <div key={band.key} className="space-y-2">
            <div className="h-3 w-28 rounded bg-muted/30" />
            <div className="h-2.5 w-3/5 max-w-sm rounded bg-muted/15" />
            {Array.from({ length: band.cards }, (_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border/60 bg-background p-4">
                <div className="h-4 w-2/3 rounded bg-muted/30" />
                <div className="h-3 w-1/2 rounded bg-muted/20" />
                <div className="h-3 w-3/4 rounded bg-muted/15" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
