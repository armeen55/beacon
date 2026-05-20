/**
 * Streaming bundle (2026-05-12) — Today v2 layout skeleton.
 *
 * Renders inside the `<Suspense>` boundary in src/app/(shell)/page.tsx
 * while `loadTodayPageData()` is still resolving. Mirrors the v2
 * layout shape (Hero → Trend Chart → Leaderboard → 3-card grid →
 * Descriptors) so the page frame doesn't visibly reflow when the
 * real content streams in.
 *
 * Pure presentation. No data, no client hooks, no router calls. Safe
 * to use as a Suspense fallback (which renders during the server
 * render, before any client hydration).
 *
 * Sizing chosen to approximate the real components' bounding boxes
 * so users see consistent spacing across the loading → loaded
 * transition. Existing visual design (OKLCH palette, surface-inset
 * tones, animate-pulse) reused — no new UI tokens.
 *
 * Section-level streaming exports (2026-05-12): the page now mounts
 * each section under its own <Suspense> boundary, so the skeleton
 * lives in pieces that match. The original `TodayV2Skeleton`
 * composite is kept for callers that still want the full sketch.
 */

/** Hero + trend chart + leaderboard. The visibility-window state is
 *  shared client-side across these three, so they always load + render
 *  together. */
export function TodayV2VisibilityGroupSkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading visibility"
      data-today-v2-section-skeleton="visibility-group"
    >
      <TodayV2HeroSkeletonInner />
      <TodayV2TrendSkeletonInner />
      <TodayV2LeaderboardSkeletonInner />
    </div>
  );
}

/** Three-card grid: Do today / Working / Recent wins. */
export function TodayV2ActionCardsSkeleton() {
  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-pulse"
      aria-busy="true"
      aria-label="Loading action cards"
      data-today-v2-section-skeleton="action-cards"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3 min-h-[180px]"
          data-today-v2-skeleton-card={i}
        >
          <div className="h-3 w-24 rounded bg-muted/30" />
          <div className="h-5 w-40 max-w-full rounded bg-muted/35" />
          <div className="h-3 w-full rounded bg-muted/20" />
          <div className="h-3 w-[85%] rounded bg-muted/20" />
          <div className="h-7 w-28 rounded-md bg-muted/30 mt-2" />
        </div>
      ))}
    </div>
  );
}

/** Edit lifecycle tile (Phase A.1 §2.11). One small section between the
 *  action cards and the descriptors. */
export function TodayV2EditLifecycleSkeleton() {
  return (
    <section
      className="animate-pulse"
      aria-busy="true"
      aria-label="Loading edit lifecycle"
      data-today-v2-section-skeleton="edit-lifecycle"
    >
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="h-3.5 w-28 rounded bg-muted/30" />
            <div className="h-2.5 w-20 rounded bg-muted/20" />
          </div>
          <div className="h-2.5 w-28 rounded bg-muted/20" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-3 w-full max-w-[280px] rounded bg-muted/20" />
        ))}
      </div>
    </section>
  );
}

/** Section 9 Today tile (2026-05-19) — "Edit outcomes (past 30
 *  days)". One small section between the lifecycle tile and the
 *  descriptors; shorter than the lifecycle skeleton because the
 *  outcomes body is a single paragraph (no per-stage rows). */
export function TodayV2EditOutcomesSkeleton() {
  return (
    <section
      className="animate-pulse"
      aria-busy="true"
      aria-label="Loading edit outcomes"
      data-today-v2-section-skeleton="edit-outcomes"
    >
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3.5 space-y-2.5">
        <div className="space-y-1">
          <div className="h-3.5 w-32 rounded bg-muted/30" />
          <div className="h-2.5 w-20 rounded bg-muted/20" />
        </div>
        <div className="h-3 w-full max-w-[320px] rounded bg-muted/20 mt-3" />
      </div>
    </section>
  );
}

/** Descriptors / enrichment chip row. */
export function TodayV2DescriptorsSkeleton() {
  return (
    <section
      className="space-y-3 animate-pulse"
      aria-busy="true"
      aria-label="Loading descriptors"
      data-today-v2-section-skeleton="descriptors"
    >
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3">
        <div className="h-4 w-48 rounded bg-muted/30" />
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-6 w-20 rounded-full bg-muted/20" />
          ))}
        </div>
      </div>
    </section>
  );
}

// Internal sub-sections used by the composite `TodayV2Skeleton` AND
// by the per-section exports above. Kept private to this file so the
// per-section exports remain the only public surface for sectioned
// streaming fallbacks.
function TodayV2HeroSkeletonInner() {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 space-y-3"
      data-today-v2-skeleton-section="hero"
    >
      <div className="h-4 w-32 rounded-md bg-muted/30" />
      <div className="h-9 w-44 rounded-md bg-muted/40" />
      <div className="h-3 w-72 max-w-full rounded-md bg-muted/25" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-border/40">
        <div className="space-y-1.5">
          <div className="h-3 w-20 rounded bg-muted/20" />
          <div className="h-4 w-24 rounded bg-muted/30" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-20 rounded bg-muted/20" />
          <div className="h-4 w-24 rounded bg-muted/30" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-20 rounded bg-muted/20" />
          <div className="h-4 w-24 rounded bg-muted/30" />
        </div>
      </div>
    </section>
  );
}

function TodayV2TrendSkeletonInner() {
  return (
    <section
      className="space-y-3"
      data-today-v2-skeleton-section="trend"
    >
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4">
        <div className="flex items-baseline justify-between gap-2 mb-4">
          <div className="h-4 w-44 rounded bg-muted/30" />
          <div className="flex gap-1.5">
            <div className="h-6 w-12 rounded bg-muted/20" />
            <div className="h-6 w-12 rounded bg-muted/20" />
            <div className="h-6 w-12 rounded bg-muted/20" />
          </div>
        </div>
        <div className="h-56 rounded-md bg-muted/15" />
        <div className="flex justify-between gap-2 mt-3">
          <div className="h-2 w-10 rounded bg-muted/20" />
          <div className="h-2 w-10 rounded bg-muted/20" />
          <div className="h-2 w-10 rounded bg-muted/20" />
          <div className="h-2 w-10 rounded bg-muted/20" />
          <div className="h-2 w-10 rounded bg-muted/20" />
        </div>
      </div>
    </section>
  );
}

function TodayV2LeaderboardSkeletonInner() {
  return (
    <section
      className="space-y-3"
      data-today-v2-skeleton-section="leaderboard"
    >
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-2.5">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="h-4 w-40 rounded bg-muted/30" />
          <div className="h-3 w-20 rounded bg-muted/20" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0"
          >
            <div className="h-3 w-6 rounded bg-muted/20" />
            <div className="h-4 flex-1 max-w-[200px] rounded bg-muted/30" />
            <div className="h-3 w-14 rounded bg-muted/25" />
            <div className="h-3 w-10 rounded bg-muted/20" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function TodayV2Skeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading today"
      data-today-v2-skeleton="true"
    >
      {/* Hero block — big number + delta + summary line + per-platform stats */}
      <section
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 space-y-3"
        data-today-v2-skeleton-section="hero"
      >
        <div className="h-4 w-32 rounded-md bg-muted/30" />
        <div className="h-9 w-44 rounded-md bg-muted/40" />
        <div className="h-3 w-72 max-w-full rounded-md bg-muted/25" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-border/40">
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-muted/20" />
            <div className="h-4 w-24 rounded bg-muted/30" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-muted/20" />
            <div className="h-4 w-24 rounded bg-muted/30" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-muted/20" />
            <div className="h-4 w-24 rounded bg-muted/30" />
          </div>
        </div>
      </section>

      {/* Visibility trend chart placeholder — wide rectangle, header strip
          + plot area + x-axis tick row. */}
      <section
        className="space-y-3"
        data-today-v2-skeleton-section="trend"
      >
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4">
          <div className="flex items-baseline justify-between gap-2 mb-4">
            <div className="h-4 w-44 rounded bg-muted/30" />
            <div className="flex gap-1.5">
              <div className="h-6 w-12 rounded bg-muted/20" />
              <div className="h-6 w-12 rounded bg-muted/20" />
              <div className="h-6 w-12 rounded bg-muted/20" />
            </div>
          </div>
          <div className="h-56 rounded-md bg-muted/15" />
          <div className="flex justify-between gap-2 mt-3">
            <div className="h-2 w-10 rounded bg-muted/20" />
            <div className="h-2 w-10 rounded bg-muted/20" />
            <div className="h-2 w-10 rounded bg-muted/20" />
            <div className="h-2 w-10 rounded bg-muted/20" />
            <div className="h-2 w-10 rounded bg-muted/20" />
          </div>
        </div>
      </section>

      {/* Leaderboard placeholder — header + 5 rows. */}
      <section
        className="space-y-3"
        data-today-v2-skeleton-section="leaderboard"
      >
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="h-4 w-40 rounded bg-muted/30" />
            <div className="h-3 w-20 rounded bg-muted/20" />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0"
            >
              <div className="h-3 w-6 rounded bg-muted/20" />
              <div className="h-4 flex-1 max-w-[200px] rounded bg-muted/30" />
              <div className="h-3 w-14 rounded bg-muted/25" />
              <div className="h-3 w-10 rounded bg-muted/20" />
            </div>
          ))}
        </div>
      </section>

      {/* 3-card grid — Do Today / Working / Recent Wins. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3 min-h-[180px]"
            data-today-v2-skeleton-card={i}
          >
            <div className="h-3 w-24 rounded bg-muted/30" />
            <div className="h-5 w-40 max-w-full rounded bg-muted/35" />
            <div className="h-3 w-full rounded bg-muted/20" />
            <div className="h-3 w-[85%] rounded bg-muted/20" />
            <div className="h-7 w-28 rounded-md bg-muted/30 mt-2" />
          </div>
        ))}
      </div>

      {/* Descriptors / Enrichment chip row. */}
      <section
        className="space-y-3"
        data-today-v2-skeleton-section="descriptors"
      >
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3">
          <div className="h-4 w-48 rounded bg-muted/30" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-6 w-20 rounded-full bg-muted/20" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Legacy /today (?legacy=1) skeleton. Lighter than v2 — legacy
 * renders the long 19-section stack; we just sketch the first few
 * blocks so the route doesn't feel blank during the data wait. The
 * legacy escape hatch is opt-in via query, used mostly by operators,
 * so a precise per-section skeleton would be wasted polish.
 */
export function TodayLegacySkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading today"
      data-today-legacy-skeleton="true"
    >
      <section className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 space-y-3">
        <div className="h-4 w-32 rounded bg-muted/30" />
        <div className="h-9 w-44 rounded bg-muted/40" />
        <div className="h-3 w-72 max-w-full rounded bg-muted/25" />
      </section>
      {[0, 1, 2, 3].map((i) => (
        <section
          key={i}
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-4 space-y-3"
        >
          <div className="h-4 w-40 rounded bg-muted/30" />
          <div className="h-3 w-full rounded bg-muted/20" />
          <div className="h-3 w-[80%] rounded bg-muted/20" />
        </section>
      ))}
    </div>
  );
}
