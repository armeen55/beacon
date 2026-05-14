/**
 * Today "Edit lifecycle" tile — Phase A.1 §2.11.
 *
 * Pure presentation. Receives a per-stage rollup of eligible
 * `recommended_edits` over the past 90 days (default window) and
 * renders one small tile near Recent wins with the count per stage
 * + the locked D15 BORROWED DEFAULTS tooltip explaining the 6 / 18
 * / 37 day thresholds Beacon currently uses as starter benchmarks.
 *
 * Tile shape (from Section 2.11):
 *
 *   Edit lifecycle (past 90 days)
 *     ⚡ N cited fast (within 6 days)
 *     ✓ N cited typical (within 18 days)
 *     · N still waiting
 *     ⚠ N stuck (past 37 days)
 *
 * Customer-vocabulary contract: stage enum values
 * (`live_not_yet_cited`, `cited_fast`, …) NEVER appear in rendered
 * copy. The tile copies through `renderLifecycleCopy`-compatible
 * customer phrasing (see `STAGE_LABEL` map below) so adding a stage
 * here is a one-line change.
 */

"use client";

import { useId, useState } from "react";

import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import { BORROWED_BENCHMARK_TOOLTIP } from "@/domains/citation-lifecycle/render-copy";
import { cn } from "@/lib/utils";

export type EditLifecycleTileProps = {
  /** Per-stage rollup from `loadLifecycleSummaryForTenant`. */
  perStage: Record<LifecycleStage, number>;
  /** Total eligible edits considered (sum of perStage). */
  total: number;
  /** Most-recent `live_at` ISO across the considered set, or null. */
  latestLiveAtIso: string | null;
  /** Window size in days (default 90). Determines the "(past N days)"
   *  caption. */
  windowDays?: number;
};

// ─────────────────────────────────────────────────────────────────────
// Display rows — customer-vocabulary labels per stage
// ─────────────────────────────────────────────────────────────────────

type StageRow = {
  stage: LifecycleStage;
  label: string;
  glyph: string;
  glyphClass: string;
};

/**
 * The order edges this tile reads top → bottom. Encodes a story:
 * the green outcomes (fast / typical) come first, then "still
 * waiting" (in-window no citation), then the trailing categories
 * (late / very_late / stuck). Customer never sees the stage enum
 * value — only the human-readable label.
 */
const STAGE_ROWS: ReadonlyArray<StageRow> = [
  {
    stage: "cited_fast",
    label: `cited fast (within ${T2C_THRESHOLDS.fast_days} days)`,
    glyph: "⚡",
    glyphClass: "text-status-success",
  },
  {
    stage: "cited_typical",
    label: `cited typical (within ${T2C_THRESHOLDS.median_days} days)`,
    glyph: "✓",
    glyphClass: "text-status-success",
  },
  {
    stage: "cited_late",
    label: `cited late (within ${T2C_THRESHOLDS.late_days} days)`,
    glyph: "·",
    glyphClass: "text-foreground/60",
  },
  {
    stage: "cited_very_late",
    label: `cited late (past ${T2C_THRESHOLDS.late_days} days)`,
    glyph: "·",
    glyphClass: "text-foreground/60",
  },
  {
    stage: "live_not_yet_cited",
    label: "still waiting",
    glyph: "·",
    glyphClass: "text-muted-foreground",
  },
  {
    stage: "stuck",
    label: `stuck (past ${T2C_THRESHOLDS.late_days} days)`,
    glyph: "⚠",
    glyphClass: "text-status-warning",
  },
];

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function EditLifecycleTile(props: EditLifecycleTileProps) {
  const { perStage, total, latestLiveAtIso, windowDays = 90 } = props;
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  // Empty state — no eligible edits in the window. Render a calm
  // placeholder rather than an emoji-heavy "0 cited fast" stack
  // which would feel broken.
  if (total === 0) {
    return (
      <section
        className="rounded-lg border border-border/60 bg-surface-base px-4 py-3.5"
        data-today-tile="edit-lifecycle"
        data-today-tile-state="empty"
        aria-labelledby="edit-lifecycle-tile-heading"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3
              id="edit-lifecycle-tile-heading"
              className="text-[13px] font-semibold text-foreground tracking-tight"
            >
              Edit lifecycle
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              past {windowDays} days
            </p>
          </div>
          <BorrowedBenchmarkTooltip
            open={open}
            setOpen={setOpen}
            tooltipId={tooltipId}
          />
        </header>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          No edits in the past {windowDays} days have produced lifecycle data
          yet. Ship an edit and Beacon will start watching for first
          citations within {T2C_THRESHOLDS.fast_days} days.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-base px-4 py-3.5"
      data-today-tile="edit-lifecycle"
      data-today-tile-state="populated"
      data-today-tile-total={total}
      aria-labelledby="edit-lifecycle-tile-heading"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="edit-lifecycle-tile-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            Edit lifecycle
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            past {windowDays} days · {total} edit{total === 1 ? "" : "s"}
          </p>
        </div>
        <BorrowedBenchmarkTooltip
          open={open}
          setOpen={setOpen}
          tooltipId={tooltipId}
        />
      </header>
      <ul
        className="mt-3 space-y-1.5"
        data-today-tile-stages="true"
        aria-describedby={tooltipId}
      >
        {STAGE_ROWS.map((row) => (
          <StageRowDisplay
            key={row.stage}
            row={row}
            count={perStage[row.stage] ?? 0}
          />
        ))}
      </ul>
      {latestLiveAtIso && (
        <p
          className="mt-3 text-[10.5px] text-muted-foreground"
          data-today-tile-freshness="true"
        >
          Latest edit live: {formatShortDate(latestLiveAtIso)}
        </p>
      )}
    </section>
  );
}

function StageRowDisplay({ row, count }: { row: StageRow; count: number }) {
  const muted = count === 0;
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 text-[12.5px] leading-snug",
        muted ? "text-muted-foreground/70" : "text-foreground",
      )}
      data-today-tile-stage={row.stage}
      data-today-tile-stage-count={count}
    >
      <span
        aria-hidden="true"
        className={cn("w-3 text-center", row.glyphClass)}
      >
        {row.glyph}
      </span>
      <span className="tabular-nums w-5 text-right font-semibold">
        {count}
      </span>
      <span>{row.label}</span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────

function BorrowedBenchmarkTooltip({
  open,
  setOpen,
  tooltipId,
}: {
  open: boolean;
  setOpen: (next: boolean) => void;
  tooltipId: string;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        aria-describedby={tooltipId}
        aria-expanded={open}
        className="text-[10.5px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        data-today-tile-tooltip-trigger="true"
      >
        Why these benchmarks?
      </button>
      {open && (
        <div
          role="tooltip"
          id={tooltipId}
          data-today-tile-tooltip-body="true"
          className="absolute right-0 top-6 z-10 w-72 rounded-md border border-border/70 bg-surface-base px-3 py-2 text-[11.5px] leading-relaxed text-foreground shadow-md"
        >
          {BORROWED_BENCHMARK_TOOLTIP}
        </div>
      )}
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
