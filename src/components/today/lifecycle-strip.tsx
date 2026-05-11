/**
 * Phase 6A.7 (2026-04-28) — Today lifecycle status strip.
 *
 * Single horizontal bar of clickable count chips that surfaces the
 * Recommendation Lifecycle OS at-a-glance on /today:
 *   X live verified   · Y pending impl   · Z need review   · W not found 7d
 *
 * Each chip deep-links to the matching /changes lifecycle tab so the
 * operator can drill in without losing context. Counts are computed
 * server-side (today-data.ts → buildTodayLifecycleSummary) from the
 * same recommended_edits read /changes uses, so the strip and the
 * /changes tab counts always reconcile.
 *
 * Pure presentation, no I/O. The "live verified" count is rendered
 * in success-green to anchor the operator's eye on lifecycle truth
 * even when the strip is otherwise quiet.
 */

import Link from "next/link";

export type TodayLifecycleStripProps = {
  counts: {
    liveVerified: number;
    pendingImplementation: number;
    needsReview: number;
    notFoundAfter7d: number;
  };
  className?: string;
};

export type LifecycleChipKey =
  | "liveVerified"
  | "pendingImplementation"
  | "needsReview"
  | "notFoundAfter7d";

type ChipSpec = {
  key: LifecycleChipKey;
  label: string;
  /** Phase 6A.8 — the /changes lifecycle tab this chip deep-links to.
   *  notFoundAfter7d has no dedicated tab; use `all` so the operator
   *  still lands on a useful view. */
  tab: "live_verified" | "pending_implementation" | "needs_review" | "all";
  toneClass: string;
  /** Show even when count is 0. Live verified is always shown so the
   *  strip's anchor is the lifecycle-truth surface. */
  alwaysVisible?: boolean;
};

const CHIPS: ChipSpec[] = [
  {
    key: "liveVerified",
    label: "Live verified",
    tab: "live_verified",
    toneClass:
      "border-status-success/40 bg-status-success/[0.06] text-status-success hover:bg-status-success/[0.10]",
    alwaysVisible: true,
  },
  {
    key: "pendingImplementation",
    label: "Pending implementation",
    tab: "pending_implementation",
    toneClass:
      "border-status-warning/35 bg-status-warning/[0.05] text-status-warning hover:bg-status-warning/[0.08]",
  },
  {
    key: "needsReview",
    label: "Need review",
    tab: "needs_review",
    toneClass:
      "border-status-warning/55 bg-status-warning/[0.08] text-status-warning hover:bg-status-warning/[0.12]",
  },
  {
    key: "notFoundAfter7d",
    label: "Not found after 7d",
    tab: "all",
    toneClass:
      "border-border/60 bg-surface-inset/40 text-muted-foreground hover:bg-surface-inset/60",
  },
];

export function TodayLifecycleStrip({
  counts,
  className,
}: TodayLifecycleStripProps) {
  const visible = CHIPS.filter(
    (c) => c.alwaysVisible || counts[c.key] > 0,
  );
  if (visible.length === 0) return null;

  // UX.6.2 (2026-05-07) — "nothing waiting" compression. When the
  // operator has zero pending implementation, zero needs-review, and
  // zero not-found-after-7d items, the strip currently shows just
  // the always-visible "Live verified" chip — which on its own
  // doesn't tell the operator the rest of the lifecycle is QUIET
  // (vs simply hidden / unloaded). Append a small muted suffix
  // "· nothing waiting" inline so the empty state is read as
  // "everything's caught up", not as "the strip's broken". This
  // pairs with the empty-state compression in TodayImplementationQueue.
  const allActionableCountsZero =
    counts.pendingImplementation === 0 &&
    counts.needsReview === 0 &&
    counts.notFoundAfter7d === 0;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
      role="region"
      aria-label="Recommendation status"
      data-today-lifecycle-strip
      data-lifecycle-empty={allActionableCountsZero ? "true" : "false"}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mr-1">
        Status
      </span>
      {visible.map((chip) => {
        const value = counts[chip.key];
        const href =
          chip.tab === "live_verified" ? "/changes" : `/changes?tab=${chip.tab}`;
        return (
          <Link
            key={chip.key}
            href={href}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${chip.toneClass}`}
            data-lifecycle-chip={chip.key}
            data-lifecycle-count={value}
            data-lifecycle-tab={chip.tab}
          >
            <span className="tabular-nums">{value}</span>
            <span>{chip.label.toLowerCase()}</span>
          </Link>
        );
      })}
      {allActionableCountsZero && (
        <span
          className="text-[11px] text-muted-foreground/60"
          data-lifecycle-nothing-waiting="true"
        >
          · nothing waiting
        </span>
      )}
    </div>
  );
}
