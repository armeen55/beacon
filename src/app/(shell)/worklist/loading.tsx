/**
 * /worklist route loading skeleton (Move 3) — stable dimensions that resemble the
 * Changes layout (header → strategy control → status tabs → compact rows) so cold
 * navigation never flashes blank or shifts when the real list hydrates.
 */
export default function WorklistLoading() {
  const rows = Array.from({ length: 6 }, (_, i) => i);
  return (
    <div className="max-w-5xl space-y-6 animate-pulse" aria-busy="true" aria-label="Loading changes">
      {/* PageHeader */}
      <div className="space-y-2">
        <div className="h-7 w-40 rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-xl rounded-md bg-muted/25" />
      </div>
      {/* Daily panel placeholder */}
      <div className="h-28 rounded-2xl border border-gray-100 bg-gray-50" />
      {/* Strategy control + status tabs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-4 w-44 rounded bg-muted/25" />
          <div className="h-8 w-64 max-w-full rounded-lg bg-muted/20" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-8 w-72 max-w-full rounded-lg bg-muted/20" />
          <div className="h-7 w-28 rounded-md bg-muted/20" />
          <div className="ml-auto h-7 w-36 rounded-md bg-muted/15" />
        </div>
        {/* Compact rows */}
        <div className="space-y-1.5">
          {rows.map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-1/2 rounded bg-muted/35" />
                <div className="h-3 w-3/4 rounded bg-muted/20" />
                <div className="h-2.5 w-2/5 rounded bg-muted/15" />
              </div>
              <div className="h-7 w-16 shrink-0 rounded-md bg-muted/20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
