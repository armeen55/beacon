"use client";

import { cn } from "@/lib/utils";
import type { EntityVisibility } from "@/domains/product/visibility-score";

/**
 * Visibility Score Rank leaderboard.
 *
 * Right-hand panel companion to `VisibilityScoreChart`. Shows:
 *   - "#N" rank callout for the tenant brand
 *   - Top-5 entities by visibility score with delta arrows
 *   - Owned row ("You") highlighted
 *
 * Pure presentational. Consumes pre-computed `EntityVisibility[]` from the
 * server (see `computeLeaderboard` in `visibility-score.ts`).
 *
 * Built 2026-04-17 (Day 6 visual rebuild).
 */

export type VisibilityLeaderboardProps = {
  /** Ranked list. First one is the top. Tracked brand is appended with its
   *  real rank even when it ranked outside the top-N. */
  entities: EntityVisibility[];
  /** Metric display name shown in the header (e.g., "Visibility score"). */
  metricLabel?: string;
};

export function VisibilityLeaderboard({
  entities,
  metricLabel = "Visibility score",
}: VisibilityLeaderboardProps) {
  const brandRow = entities.find((e) => e.isOwned);
  const brandRank = brandRow?.rank ?? null;

  // 2026-04-19: "Share-capture signal" banner. Fires when the tracked brand's
  // delta is positive while at least one of the top-3 competitors' delta is
  // negative. Tells the operator "you gained while they lost" \u2014 the actual
  // causal story that our attribution engine can't yet claim from raw data.
  const competitorRows = entities.filter((e) => !e.isOwned).slice(0, 5);
  const losingCompetitors = competitorRows
    .filter((c) => c.delta < -0.5)
    .sort((a, b) => a.delta - b.delta);
  const shareCapture =
    brandRow && brandRow.delta > 0.5 && losingCompetitors.length > 0
      ? {
          brandGain: brandRow.delta,
          topLoser: losingCompetitors[0],
          loserCount: losingCompetitors.length,
        }
      : null;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 pt-5 pb-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            Visibility Score Rank
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Who gets mentioned most often in your topic
          </p>
        </div>
      </div>

      {/* Share-capture callout (when applicable) */}
      {shareCapture && (
        <div className="mb-3 rounded-md border border-status-success/25 bg-status-success/[0.05] px-3 py-2">
          <p className="text-[11px] text-foreground leading-snug">
            <span className="font-semibold text-status-success">
              Share capture:
            </span>{" "}
            You are up {shareCapture.brandGain.toFixed(1)}pt while{" "}
            {shareCapture.loserCount === 1 ? (
              <>
                <span className="font-medium">{shareCapture.topLoser.name}</span>{" "}
                is down {Math.abs(shareCapture.topLoser.delta).toFixed(1)}pt
              </>
            ) : (
              <>
                {shareCapture.loserCount} competitors are down (worst:{" "}
                <span className="font-medium">{shareCapture.topLoser.name}</span>{" "}
                {Math.abs(shareCapture.topLoser.delta).toFixed(1)}pt)
              </>
            )}
            .
          </p>
        </div>
      )}

      {/* Rank callout */}
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tabular-nums">
          {brandRank !== null ? `#${brandRank}` : "—"}
        </span>
        {brandRow && (
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              brandRow.delta > 0
                ? "text-status-success"
                : brandRow.delta < 0
                  ? "text-status-danger"
                  : "text-muted-foreground",
            )}
          >
            {brandRow.delta > 0 ? "+" : ""}
            {brandRow.delta.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pb-2 mb-2 border-b border-border/30">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 w-4 text-right">
          #
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Brand
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 text-right">
          {metricLabel}
        </span>
      </div>

      {/* Rows */}
      <div className="space-y-0.5">
        {entities.map((e) => (
          <LeaderboardRow key={e.slug} entity={e} />
        ))}
        {entities.length === 0 && (
          <p className="text-[12px] text-muted-foreground text-center py-4">
            No entities to rank yet. Run a scan or import fresh data.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function LeaderboardRow({ entity }: { entity: EntityVisibility }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 py-1.5 px-1 rounded",
        entity.isOwned
          ? "bg-accent-primary/5 ring-1 ring-accent-primary/20"
          : "",
      )}
    >
      {/* Rank */}
      <span className="text-[12px] font-semibold text-muted-foreground tabular-nums w-4 text-right">
        {entity.rank}.
      </span>

      {/* Entity name + "Owned" badge */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-inset/60 text-[9px] font-bold text-muted-foreground">
          {initials(entity.name)}
        </span>
        <span
          className={cn(
            "text-[12px] truncate",
            entity.isOwned ? "font-semibold text-foreground" : "text-foreground/90",
          )}
        >
          {entity.name}
        </span>
        {entity.isOwned && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded shrink-0">
            You
          </span>
        )}
      </div>

      {/* Score + delta */}
      <div className="flex items-baseline gap-2 justify-end">
        <span className="text-[12px] font-semibold tabular-nums text-foreground">
          {entity.score.toFixed(1)}%
        </span>
        <span
          className={cn(
            "text-[10px] font-medium tabular-nums w-14 text-right",
            entity.delta > 0
              ? "text-status-success"
              : entity.delta < 0
                ? "text-status-danger"
                : "text-muted-foreground/60",
          )}
        >
          {entity.delta > 0 ? "+" : ""}
          {entity.delta.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]?.toUpperCase() ?? "?";
  return (words[0][0] + words[1][0]).toUpperCase();
}
