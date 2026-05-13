/**
 * Streaming bundle (2026-05-12) — Recommendations v2 layout skeleton.
 *
 * Renders inside the `<Suspense>` boundary in
 * src/app/(shell)/recommendations/page.tsx while
 * `loadPersistedRecommendationQueueForPage()` is still resolving.
 * Mirrors the v2 layout shape (Header + 2-col grid of card stack +
 * working rail) so the page doesn't visibly reflow.
 *
 * Pure presentation. No data, no client hooks.
 */
export function RecommendationsV2Skeleton() {
  return (
    <div
      className="space-y-5 max-w-5xl animate-pulse"
      aria-busy="true"
      aria-label="Loading recommendations"
      data-recommendations-v2-skeleton="true"
    >
      {/* Header — title + subline */}
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <div className="h-5 w-44 rounded-md bg-muted/40" />
          <div className="h-3 w-80 max-w-full rounded-md bg-muted/25" />
        </div>
      </header>

      {/* 2-col body — card stack (left ~60%) + working rail (right ~40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
        {/* Suggested card stack — 5 placeholder cards */}
        <section
          className="space-y-3"
          data-recommendations-v2-skeleton-section="suggested"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3"
              data-recommendations-v2-skeleton-card={i}
            >
              {/* Status pill + confidence + date row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-16 rounded bg-muted/25" />
                  <div className="h-4 w-12 rounded bg-muted/20" />
                </div>
                <div className="h-3 w-20 rounded bg-muted/20" />
              </div>
              {/* Headline */}
              <div className="space-y-2">
                <div className="h-4 w-[88%] rounded bg-muted/35" />
                <div className="h-3 w-[62%] rounded bg-muted/25" />
              </div>
              {/* Target URL */}
              <div className="h-3 w-56 max-w-full rounded bg-muted/20" />
              {/* Evidence chips row */}
              <div className="flex flex-wrap gap-2 pt-1">
                <div className="h-5 w-24 rounded-full bg-muted/20" />
                <div className="h-5 w-20 rounded-full bg-muted/20" />
                <div className="h-5 w-28 rounded-full bg-muted/20" />
              </div>
              {/* Review CTA */}
              <div className="flex justify-end pt-1">
                <div className="h-7 w-20 rounded-md bg-muted/30" />
              </div>
            </div>
          ))}
        </section>

        {/* Working rail — header + 4 in-flight rows */}
        <aside
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 space-y-3 h-fit"
          data-recommendations-v2-skeleton-section="working"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="h-3 w-16 rounded bg-muted/30" />
            <div className="h-3 w-14 rounded bg-muted/20" />
          </div>
          <div className="space-y-3 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="h-3 flex-1 max-w-[180px] rounded bg-muted/30" />
                  <div className="h-4 w-12 rounded bg-muted/20 shrink-0" />
                </div>
                <div className="h-2.5 w-32 max-w-full rounded bg-muted/20" />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Legacy /recommendations (?legacy=1) skeleton. Lighter — sketches the
 * executive strip + table-row stack so the route doesn't feel blank
 * during the slow live-pipeline load. Legacy is an opt-in operator
 * escape hatch; a generic placeholder is acceptable here.
 */
export function RecommendationsLegacySkeleton() {
  return (
    <div
      className="space-y-5 max-w-5xl animate-pulse"
      aria-busy="true"
      aria-label="Loading recommendations"
      data-recommendations-legacy-skeleton="true"
    >
      <header className="space-y-2">
        <div className="h-5 w-44 rounded-md bg-muted/40" />
        <div className="h-3 w-96 max-w-full rounded-md bg-muted/25" />
      </header>
      {/* Executive strip placeholders */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3 space-y-1.5"
          >
            <div className="h-3 w-16 rounded bg-muted/25" />
            <div className="h-5 w-10 rounded bg-muted/35" />
          </div>
        ))}
      </div>
      {/* Table rows */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="px-5 py-3 border-b border-border/40 last:border-0 flex items-center gap-3"
          >
            <div className="h-3 w-12 rounded bg-muted/20" />
            <div className="h-3 flex-1 max-w-[300px] rounded bg-muted/30" />
            <div className="h-3 w-16 rounded bg-muted/20 hidden sm:block" />
            <div className="h-3 w-20 rounded bg-muted/20 hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
