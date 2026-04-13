export default function PagesLoading() {
  const rowPlaceholders = Array.from({ length: 7 }, (_, i) => i);

  return (
    <div className="max-w-5xl animate-pulse" aria-busy="true" aria-label="Loading pages">
      {/* Page header — matches page.tsx title block */}
      <div className="mb-6 space-y-3">
        <div className="h-7 w-28 rounded-md bg-muted/40" />
        <div className="h-4 w-full max-w-lg rounded-md bg-muted/25" />
        <div className="border-l-2 border-border/60 pl-3 pt-0.5">
          <div className="h-3 w-full max-w-md rounded-md bg-muted/20" />
          <div className="mt-2 h-3 w-[88%] max-w-sm rounded-md bg-muted/15" />
        </div>
      </div>

      {/* KPI strip + donut — matches PagesClient summary row */}
      <div className="mb-5">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-surface-inset/20 px-3 py-3 space-y-2"
              >
                <div className="h-2.5 w-14 rounded bg-muted/30" />
                <div className="h-6 w-10 rounded-md bg-muted/35" />
              </div>
            ))}
          </div>
          <div className="h-[90px] w-[90px] shrink-0 rounded-full border-2 border-border/50 bg-muted/15" />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          <div className="h-3 w-32 rounded bg-muted/20" />
          <div className="h-3 w-40 rounded bg-muted/20" />
        </div>
      </div>

      {/* Scan row + view tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="h-8 w-28 shrink-0 rounded-md border border-border/80 bg-muted/15" />
        <div className="h-3 w-36 rounded bg-muted/20" />
        <span className="flex-1 min-w-[8px]" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-7 w-16 rounded-md bg-muted/25" />
        ))}
      </div>

      {/* Split workbench — matches PagesClient grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,280px)_1fr]">
        {/* Left: page list */}
        <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
          <div className="border-b border-border/50 px-3 py-2.5">
            <div className="h-3 w-24 rounded bg-muted/25" />
          </div>
          <div className="divide-y divide-border/40">
            {rowPlaceholders.map((i) => (
              <div key={i} className="px-3 py-3 space-y-2">
                <div className="h-[13px] w-[92%] rounded bg-muted/35" />
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" />
                  <div className="h-3 w-20 rounded bg-muted/25" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-3 w-16 rounded bg-muted/20" />
                  <div className="h-5 w-12 rounded bg-muted/25" />
                  <div className="h-3 w-24 rounded bg-muted/15" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: selected page brief */}
        <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
          <div className="space-y-4 border-b border-border/40 px-6 pb-5 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-5 w-4/5 max-w-md rounded-md bg-muted/35" />
                <div className="h-3 w-full max-w-sm rounded bg-muted/20" />
              </div>
              <div className="shrink-0 space-y-2 text-right">
                <div className="ml-auto flex items-center justify-end gap-2">
                  <div className="h-2 w-2 rounded-full bg-muted/35" />
                  <div className="h-4 w-16 rounded bg-muted/30" />
                </div>
                <div className="ml-auto h-3 w-28 rounded bg-muted/15" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded-md bg-muted/20" />
              <div className="h-6 w-24 rounded-md bg-muted/20" />
            </div>
          </div>
          <div className="space-y-3 px-6 py-5">
            <div className="h-3 w-full rounded bg-muted/20" />
            <div className="h-3 w-[94%] rounded bg-muted/15" />
            <div className="h-3 w-[78%] rounded bg-muted/15" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="h-20 rounded-md border border-border/50 bg-surface-inset/20" />
              <div className="h-20 rounded-md border border-border/50 bg-surface-inset/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
