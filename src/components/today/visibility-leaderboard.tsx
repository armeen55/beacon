"use client";

import { cn } from "@/lib/utils";
import type { EntityVisibility } from "@/domains/product/visibility-score";
import { WhyThisNumber } from "@/components/today/why-this-number";
import { buildCompetitorLeaderboardProvenance } from "@/domains/today/score-provenance";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";

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
  /** Last day represented by the loaded visibility snapshot (YYYY-MM-DD). */
  windowEndDate?: string | null;
};

export function VisibilityLeaderboard({
  entities,
  metricLabel = "Visibility score",
  windowEndDate = null,
}: VisibilityLeaderboardProps) {
  const brandRow = entities.find((e) => e.isOwned);
  // A rank only means something against a real opponent — mirror the hero card,
  // which hides its rank when there's no competitive field. Showing a bold "#1"
  // with zero competitors contradicts the hero directly above it.
  const hasCompetitors = entities.some((e) => !e.isOwned);
  const brandRank = brandRow?.rank ?? null;
  const windowDays = entities[0]?.deltaWindowDays ?? null;
  const previousSampledDays = entities[0]?.previousSampledDays ?? 0;
  const currentSampledDays = entities[0]?.currentSampledDays ?? 0;
  const deltaLabelSuffix = windowDays
    ? `vs. previous ${windowDays} days`
    : null;

  // 2026-04-19: "Share-capture signal" banner. Fires when the tracked brand's
  // delta is positive while at least one of the top-3 competitors' delta is
  // negative. Tells the operator "you gained while they lost" \u2014 the actual
  // causal story that our attribution engine can't yet claim from raw data.
  // Step 1.3 (master plan) \u2014 gracefully skip when delta is null (limited data).
  const competitorRows = entities.filter((e) => !e.isOwned).slice(0, 5);
  const losingCompetitors = competitorRows
    .filter(
      (c): c is EntityVisibility & { delta: number } =>
        c.delta !== null && c.delta < -0.5,
    )
    .sort((a, b) => a.delta - b.delta);
  const shareCapture =
    brandRow &&
    brandRow.delta !== null &&
    brandRow.delta > 0.5 &&
    losingCompetitors.length > 0
      ? {
          brandGain: brandRow.delta,
          topLoser: losingCompetitors[0],
          loserCount: losingCompetitors.length,
        }
      : null;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 pt-5 pb-4">
      {/* Header — UX.6.3 (2026-05-08): renamed from "Visibility Score
          Rank" / "Who gets mentioned most often in your topic" to the
          executive copy "AI visibility leaderboard" / "Who AI mentions
          most across tracked answers". The hero card above carries
          the rank + score for the brand row; this leaderboard panel
          provides the full ranked context (top-5 + brand row, share-
          capture callouts, per-row delta arrows). */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            AI visibility leaderboard
          </h2>
          {/* QA polish (2026-05-12) — subcopy clarifies the tracked-
              set framing so the leaderboard never reads as
              "ranking across the entire market". The leaderboard
              positions the customer's brand among the competitors
              they explicitly track, not the universe of companies. */}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Who AI mentions most among the brands you track
          </p>
          {/* T3.1 — Trust Sprint score provenance disclosure. The
              leaderboard is "directional" because the brand row is
              computed with a different formula (composite +
              position-weighted citations) than competitor rows
              (flat mention rate); ranks are reliable but absolute
              percentages are not strictly comparable. See
              docs/BEACON_SCORE_PROVENANCE_AUDIT_2026_05_06.md. */}
          {windowDays != null && (() => {
            // Approximate "window touches pre-cutover" using current sampled
            // days vs window. We don't have the start ISO directly, but we
            // can flag when the operator might be looking at a long window
            // that crosses the cutover boundary. Use today − windowDays
            // as the start.
            const endMs = windowEndDate ? Date.parse(`${windowEndDate}T00:00:00Z`) : Number.NaN;
            const startISO = Number.isFinite(endMs)
              ? new Date(endMs - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
              : null;
            const windowTouchesPreCutover = startISO != null && startISO < NATIVE_REGIME_START;
            const prov = buildCompetitorLeaderboardProvenance({
              windowDays,
              windowTouchesPreCutover,
              rowCount: competitorRows.length + (brandRow ? 1 : 0),
            });
            return (
              <div className="mt-1.5">
                <WhyThisNumber provenance={prov} />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Share-capture callout (when applicable).

          Metric-honesty fix #356 (2026-06-14): this banner is a
          COINCIDENCE test — your row went up in the same window at least
          one competitor's went down. The math does NOT verify that
          mentions were redistributed from them to you, and the two deltas
          are computed with different formulas (see buildShareCaptureProvenance,
          trustLevel: "unreliable"). It previously shipped with confident
          green success styling ("Share capture:" in status-success), which
          presented an unproven causal claim as a won battle. Restyled to a
          neutral surface and labelled "directional, not proven" so a
          skeptical owner isn't sold a coincidence as a fact. */}
      {shareCapture && (
        <div className="mb-3 rounded-md border border-border/60 bg-surface-inset/30 px-3 py-2">
          <p className="text-[11px] text-foreground leading-snug">
            <span className="font-semibold text-muted-foreground">
              Possible share shift:
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
          <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
            Directional, not proven, these moves happened in the same
            window, but Beacon hasn&apos;t verified the gain came from them.
            Worth investigating, not a confirmed win.
          </p>
        </div>
      )}

      {/* Rank callout */}
      <div className="flex flex-col gap-1 mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {brandRank !== null && hasCompetitors ? `#${brandRank}` : "-"}
          </span>
          {!hasCompetitors ? (
            <span className="text-[11px] text-muted-foreground">No competitors tracked yet</span>
          ) : null}
          {brandRow && brandRow.delta !== null ? (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                brandRow.delta > 0
                  ? "text-status-success"
                  : brandRow.delta < 0
                    ? "text-status-danger"
                    : "text-muted-foreground",
              )}
              title={deltaLabelSuffix ?? undefined}
            >
              {brandRow.delta > 0 ? "+" : ""}
              {brandRow.delta.toFixed(1)} pt
            </span>
          ) : (
            <span
              className="text-sm font-medium text-muted-foreground"
              title={
                windowDays
                  ? `Only ${previousSampledDays} sampled day${previousSampledDays === 1 ? "" : "s"} in the previous ${windowDays}-day window, too few to compare honestly.`
                  : undefined
              }
            >
              -
            </span>
          )}
        </div>
        {deltaLabelSuffix && (
          <p className="text-[10px] text-muted-foreground">
            {deltaLabelSuffix} · {currentSampledDays} sampled day
            {currentSampledDays === 1 ? "" : "s"} in this {windowDays}-day window
            {brandRow?.delta === null && previousSampledDays > 0 && (
              <> · only {previousSampledDays} prior sampled day
              {previousSampledDays === 1 ? "" : "s"}</>
            )}
          </p>
        )}
      </div>

      {/* a11y #388 — semantic table. The header + rows were CSS-grid
          <div>/<span> with no table semantics, so screen readers could
          not associate a score with its column. Converted to a real
          <table> with <th scope="col">; the per-row grid layout is kept
          via grid utilities on the <tr>. */}
      {entities.length > 0 ? (
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">
            AI visibility leaderboard: rank, brand, and {metricLabel.toLowerCase()}
            {windowDays ? ` with change vs. the previous ${windowDays} days` : ""}.
          </caption>
          <thead>
            <tr className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pb-2 mb-2 border-b border-border/30">
              <th
                scope="col"
                className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground w-4 text-right"
              >
                #
              </th>
              <th
                scope="col"
                className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Brand
              </th>
              <th
                scope="col"
                className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground text-right"
              >
                {metricLabel}
              </th>
            </tr>
          </thead>
          <tbody className="space-y-0.5 block">
            {entities.map((e) => (
              <LeaderboardRow key={e.slug} entity={e} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[12px] text-muted-foreground text-center py-4">
          No entities to rank yet. Run a scan or import fresh data.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function LeaderboardRow({ entity }: { entity: EntityVisibility }) {
  // a11y #397 — a sign-independent direction cue (▲/▼/—) so the delta's
  // direction reads without relying on green/red color, plus an
  // aria-label that spells out the "vs. previous N days" context (the
  // tooltip text was previously hover-only via `title=`).
  const deltaArrow =
    entity.delta === null
      ? ""
      : entity.delta > 0
        ? "▲"
        : entity.delta < 0
          ? "▼"
          : "";
  const deltaAriaLabel =
    entity.delta !== null
      ? `${
          entity.delta > 0 ? "up" : entity.delta < 0 ? "down" : "no change"
        } ${Math.abs(entity.delta).toFixed(1)} points vs. previous ${entity.deltaWindowDays} days`
      : `Change unavailable, only ${entity.previousSampledDays} sampled day${entity.previousSampledDays === 1 ? "" : "s"} in the previous ${entity.deltaWindowDays}-day window, too few to compare.`;
  return (
    <tr
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 py-1.5 px-1 rounded",
        entity.isOwned
          ? "bg-accent-primary/5 ring-1 ring-accent-primary/20"
          : "",
      )}
    >
      {/* Rank */}
      <td className="text-[12px] font-semibold text-muted-foreground tabular-nums w-4 text-right">
        {entity.rank}.
      </td>

      {/* Entity name + "Owned" badge */}
      <td className="flex items-center gap-2 min-w-0">
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
      </td>

      {/* Score + delta */}
      <td className="flex items-baseline gap-2 justify-end">
        <span className="text-[12px] font-semibold tabular-nums text-foreground">
          {entity.score.toFixed(1)}%
        </span>
        {entity.delta !== null ? (
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums w-14 text-right",
              entity.delta > 0
                ? "text-status-success"
                : entity.delta < 0
                  ? "text-status-danger"
                  : "text-muted-foreground",
            )}
            aria-label={deltaAriaLabel}
          >
            {deltaArrow && <span aria-hidden="true">{deltaArrow} </span>}
            {entity.delta > 0 ? "+" : ""}
            {entity.delta.toFixed(1)} pt
          </span>
        ) : (
          <span
            className="text-[10px] font-medium tabular-nums w-14 text-right text-muted-foreground"
            aria-label={deltaAriaLabel}
          >
            <span aria-hidden="true">-</span>
          </span>
        )}
      </td>
    </tr>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]?.toUpperCase() ?? "?";
  return (words[0][0] + words[1][0]).toUpperCase();
}
