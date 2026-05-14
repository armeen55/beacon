/**
 * Today "Edit lifecycle" tile — Phase A.1 §2.11 / Phase A.2 Step 3c.
 *
 * Pure presentation. Receives a per-stage rollup of eligible
 * `recommended_edits` over the past 90 days (default window) +
 * pre-rendered per-source strings (labels, tooltip, empty
 * placeholder) and renders one small tile near Recent wins.
 *
 * Tile shape (from Section 2.11):
 *
 *   Edit lifecycle (past 90 days)
 *     ⚡ N {stageLabels.cited_fast}
 *     ✓ N {stageLabels.cited_typical}
 *     · N {stageLabels.live_not_yet_cited}
 *     ⚠ N {stageLabels.stuck}
 *
 * Phase A.2 Step 3c boundary contract (architecture invariant):
 *
 *   This component MUST NOT import `T2C_THRESHOLDS` or
 *   `BORROWED_BENCHMARK_TOOLTIP` directly. Labels + tooltip body
 *   come in as props from `loadLifecycleSummaryForTenant`'s
 *   `tile_strings`, which `buildTileStrings(decision)` produces
 *   server-side. The component is source-agnostic — Profound
 *   default vs per-tenant per-source variants are decided in the
 *   loader, never in the React tree.
 *
 * Customer-vocabulary contract: stage enum values
 * (`live_not_yet_cited`, `cited_fast`, …) NEVER appear in rendered
 * copy. The label map is a typed `Record<LifecycleStage, string>`
 * so adding a stage upstream surfaces here as a typecheck error.
 */

"use client";

import { useId, useState } from "react";

import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";
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
  /** Pre-rendered per-source label per lifecycle stage. Comes from
   *  `loadLifecycleSummaryForTenant`'s `tile_strings.stage_labels`. */
  stageLabels: Record<LifecycleStage, string>;
  /** Pre-rendered tooltip body (source-aware: Profound default or
   *  per-tenant cited-subpopulation honesty paragraph). */
  tooltipBody: string;
  /** Pre-rendered empty-state body. May contain a literal
   *  `{windowDays}` placeholder which this component substitutes
   *  before rendering. */
  emptyStateBody: string;
};

// ─────────────────────────────────────────────────────────────────────
// Display rows — glyphs only; labels come in from props
// ─────────────────────────────────────────────────────────────────────

type StageRow = {
  stage: LifecycleStage;
  glyph: string;
  glyphClass: string;
};

/**
 * The order edges this tile reads top → bottom. Encodes a story:
 * the green outcomes (fast / typical) come first, then "still
 * waiting" (in-window no citation), then the trailing categories
 * (late / very_late / stuck). Customer never sees the stage enum
 * value — only the human-readable label paired in via `stageLabels`.
 */
const STAGE_ROWS: ReadonlyArray<StageRow> = [
  { stage: "cited_fast", glyph: "⚡", glyphClass: "text-status-success" },
  { stage: "cited_typical", glyph: "✓", glyphClass: "text-status-success" },
  { stage: "cited_late", glyph: "·", glyphClass: "text-foreground/60" },
  { stage: "cited_very_late", glyph: "·", glyphClass: "text-foreground/60" },
  {
    stage: "live_not_yet_cited",
    glyph: "·",
    glyphClass: "text-muted-foreground",
  },
  { stage: "stuck", glyph: "⚠", glyphClass: "text-status-warning" },
];

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function EditLifecycleTile(props: EditLifecycleTileProps) {
  const {
    perStage,
    total,
    latestLiveAtIso,
    windowDays = 90,
    stageLabels,
    tooltipBody,
    emptyStateBody,
  } = props;
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  // Empty state — no eligible edits in the window. Render a calm
  // placeholder rather than an emoji-heavy "0 cited fast" stack
  // which would feel broken. `emptyStateBody` may carry a
  // `{windowDays}` placeholder which we substitute here.
  if (total === 0) {
    const emptyBody = emptyStateBody.replace(
      /\{windowDays\}/g,
      String(windowDays),
    );
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
          <BenchmarkTooltip
            open={open}
            setOpen={setOpen}
            tooltipId={tooltipId}
            body={tooltipBody}
          />
        </header>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {emptyBody}
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
        <BenchmarkTooltip
          open={open}
          setOpen={setOpen}
          tooltipId={tooltipId}
          body={tooltipBody}
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
            label={stageLabels[row.stage]}
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

function StageRowDisplay({
  row,
  label,
  count,
}: {
  row: StageRow;
  label: string;
  count: number;
}) {
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
      <span>{label}</span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────

function BenchmarkTooltip({
  open,
  setOpen,
  tooltipId,
  body,
}: {
  open: boolean;
  setOpen: (next: boolean) => void;
  tooltipId: string;
  body: string;
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
          {body}
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
