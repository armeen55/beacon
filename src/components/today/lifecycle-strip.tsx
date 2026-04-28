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

type ChipSpec = {
  key:
    | "liveVerified"
    | "pendingImplementation"
    | "needsReview"
    | "notFoundAfter7d";
  label: string;
  href: string;
  toneClass: string;
  /** Show even when count is 0. Live verified is always shown so the
   *  strip's anchor is the lifecycle-truth surface. */
  alwaysVisible?: boolean;
};

const CHIPS: ChipSpec[] = [
  {
    key: "liveVerified",
    label: "Live verified",
    href: "/changes",
    toneClass:
      "border-status-success/40 bg-status-success/[0.06] text-status-success hover:bg-status-success/[0.10]",
    alwaysVisible: true,
  },
  {
    key: "pendingImplementation",
    label: "Pending implementation",
    href: "/changes",
    toneClass:
      "border-status-warning/35 bg-status-warning/[0.05] text-status-warning hover:bg-status-warning/[0.08]",
  },
  {
    key: "needsReview",
    label: "Need review",
    href: "/changes",
    toneClass:
      "border-status-warning/55 bg-status-warning/[0.08] text-status-warning hover:bg-status-warning/[0.12]",
  },
  {
    key: "notFoundAfter7d",
    label: "Not found after 7d",
    href: "/changes",
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

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
      role="region"
      aria-label="Recommendation lifecycle status"
      data-today-lifecycle-strip
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mr-1">
        Lifecycle
      </span>
      {visible.map((chip) => {
        const value = counts[chip.key];
        return (
          <Link
            key={chip.key}
            href={chip.href}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${chip.toneClass}`}
            data-lifecycle-chip={chip.key}
            data-lifecycle-count={value}
          >
            <span className="tabular-nums">{value}</span>
            <span>{chip.label.toLowerCase()}</span>
          </Link>
        );
      })}
    </div>
  );
}
