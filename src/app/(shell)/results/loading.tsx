/**
 * /results loading skeleton, drawn to the CURRENT Results layout: the title row, the four-number
 * header strip, the tab row, then the row lines. It used to draw the retired "Proof at a glance"
 * tiles and three outcome bands, so every cold navigation shifted the whole page once the real
 * surface landed.
 */
export default function ProofLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8 animate-pulse" aria-busy="true" aria-label="Loading results">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="h-8 w-28 rounded-md bg-muted/40" />
        <div className="h-6 w-40 shrink-0 rounded-md bg-muted/20" />
      </div>
      <div className="mb-5 flex flex-wrap items-start gap-x-10 gap-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-9 w-16 rounded bg-muted/35" />
            <div className="h-3 w-28 rounded bg-muted/20" />
          </div>
        ))}
      </div>
      <div className="mb-3 h-7 w-64 rounded-lg bg-muted/25" />
      <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-11 bg-muted/10" />)}
      </div>
    </div>
  );
}
