"use client";

/**
 * RecommendationsV2Client — Bundle 2A of the UI redesign
 * (Plan: ~/.claude/plans/i-want-a-maximum-depth-curried-curry.md).
 *
 * Replaces the legacy /recommendations table + per-row drawer with a
 * premium two-column layout for the opt-in /recommendations?v2=1 view:
 *
 *   • Left (≈60%): a stack of the top 5–7 "Suggested" recommendations
 *     as full-width cards. Each card surfaces evidence chips, target
 *     URL, plain-English why, confidence, and a single "Review →"
 *     CTA that links back into the legacy view at the row's anchor.
 *
 *   • Right (≈40%): a "Working" rail showing accepted / shipped /
 *     measuring / needs_review rows so accountability for in-flight
 *     items has its own surface.
 *
 * Open-only for Bundle 2A: every CTA links into the legacy view
 * (/recommendations?legacy=1#rec-<id>). The legacy drawer remains the
 * authoritative accept / defer / dismiss surface for this first pass —
 * no new server-action wiring lands here.
 *
 * Pure presentation. Consumes the same `RecommendationQueueRow[]` and
 * `RecommendationWatchRow[]` props as the legacy client; reuses the
 * existing `buildRecommendationActionRows` helper to project the queue
 * into the typed `RecommendationActionRow[]` shape both v1 and v2
 * surfaces use. No new data fetches, no new server actions, no domain
 * logic changes.
 */

import { useMemo } from "react";
import Link from "next/link";

import {
  buildRecommendationActionRows,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";

import { RecommendationV2Card } from "@/components/recommendations/v2/recommendation-v2-card";
import { RecommendationsV2WorkingRail } from "@/components/recommendations/v2/recommendations-v2-working-rail";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "./page";

/**
 * Customer-actionable statuses that surface as cards in the v2
 * Suggested stack. Bundle 2A V (verification pass, 2026-05-10):
 * widened from `{"new"}` to include `needs_review` and
 * `needs_fresh_edit` after the post-Bundle-2A audit caught the
 * original set hiding rows that the legacy Executive Strip's
 * "Need review" tile already exposed. Per the audit's "never hide
 * all value just because rows are not in one exact status bucket"
 * rule.
 *
 * Bucket-to-placement map (locked):
 *   - new                → Suggested stack (this set)
 *   - needs_review       → Suggested stack (this set; customer reviews
 *                          the lower-confidence rec and decides)
 *   - needs_fresh_edit   → Suggested stack (this set; rec is still
 *                          actionable — operator triggers regenerate)
 *   - accepted           → Working rail (see rail's WORKING_STATUSES)
 *   - shipped            → Working rail
 *   - measuring          → Working rail
 *   - dismissed          → hidden (operator already rejected)
 *   - deferred           → hidden (operator snoozed it)
 */
const SUGGESTED_STATUSES: ReadonlySet<ActionRowStatus> = new Set<ActionRowStatus>([
  "new",
  "needs_review",
  "needs_fresh_edit",
]);

/**
 * Statuses considered "in flight" for the calm-state copy + the
 * "Working" rail's filter. Mirrors `WORKING_STATUSES` in
 * recommendations-v2-working-rail.tsx (the two arrays MUST stay in
 * sync — the calm copy says "Beacon is measuring N change(s) you've
 * already shipped" and that count drives the operator's decision
 * about whether to flip back to legacy).
 */
const IN_FLIGHT_STATUSES: ReadonlySet<ActionRowStatus> = new Set<ActionRowStatus>([
  "accepted",
  "shipped",
  "measuring",
]);

const MAX_SUGGESTED_CARDS = 7;

export type RecommendationsV2ClientProps = {
  queue: RecommendationQueueRow[];
  // Watchlist comes through for parity but v2's first pass collapses
  // it into a footer link — power users still reach it via legacy.
  watchlist?: RecommendationWatchRow[];
  matrixDate: string;
  promptTextById: Record<string, string>;
};

export function RecommendationsV2Client({
  queue,
  watchlist = [],
  matrixDate,
  promptTextById,
}: RecommendationsV2ClientProps) {
  // Build typed action rows from the same queue the legacy table consumes.
  // Pure projection — no new I/O, no math change.
  const allRows = useMemo(
    () => buildRecommendationActionRows({ queue, promptTextById }),
    [queue, promptTextById],
  );

  const suggested = useMemo(
    () =>
      allRows
        .filter((r) => SUGGESTED_STATUSES.has(r.status))
        .slice(0, MAX_SUGGESTED_CARDS),
    [allRows],
  );

  const inFlightCount = useMemo(
    () => allRows.filter((r) => IN_FLIGHT_STATUSES.has(r.status)).length,
    [allRows],
  );

  // Friendly date label for the page header microcopy. Already
  // formatted server-side as YYYY-MM-DD; keep it operator-safe by
  // rendering only as "as of <date>" — no UTC, no cron.
  const headerSubline = (
    <span data-recommendations-v2-header-subline="true">
      Beacon turns AI visibility gaps into concrete website tasks.{" "}
      <span className="text-muted-foreground/80">
        Updated {matrixDate}.
      </span>
    </span>
  );

  return (
    <div
      className="space-y-5 max-w-5xl"
      data-recommendations-layout="v2-card-stack"
    >
      {/* Header */}
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Recommendations
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            {headerSubline}
          </p>
        </div>
      </header>

      {allRows.length === 0 ? (
        <RecommendationsV2EmptyState />
      ) : suggested.length === 0 ? (
        <RecommendationsV2CalmState inFlightCount={inFlightCount} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
          {/* Suggested stack */}
          <section
            className="space-y-3"
            data-recommendations-v2-section="suggested"
            aria-label="Suggested recommendations"
          >
            {suggested.map((row) => (
              <RecommendationV2Card key={row.id} row={row} />
            ))}

            {allRows.length > suggested.length && (
              <p className="pt-2 text-[11px] text-muted-foreground/80">
                Showing the top {suggested.length} of {allRows.length}{" "}
                recommendations.{" "}
                <Link
                  href="/recommendations?legacy=1"
                  className="text-accent-primary hover:underline font-medium"
                  data-recommendations-v2-cta="see-all"
                >
                  See full list →
                </Link>
              </p>
            )}
          </section>

          {/* Working rail */}
          <RecommendationsV2WorkingRail rows={allRows} />
        </div>
      )}

      {/* Footer — pre-2026-05-12 carried an "Open legacy view" CTA
          alongside the watchlist link. The legacy CTA was removed
          because v2 is the production default and the visible link
          made the product feel unfinished. The watchlist link stays
          (it surfaces a real feature: patterns Beacon is watching;
          the watchlist UI itself isn't rendered in v2 yet so the
          link currently routes through `?legacy=1#watchlist` as the
          only place that surface lives). `/recommendations?legacy=1`
          still routes to the legacy table for rollback. */}
      {watchlist.length > 0 && (
        <footer className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground/80">
          <Link
            href="/recommendations?legacy=1#watchlist"
            className="text-accent-primary hover:underline font-medium"
            data-recommendations-v2-cta="watchlist"
          >
            {watchlist.length} winning pattern{watchlist.length === 1 ? "" : "s"} on watch →
          </Link>
        </footer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty + calm states
// ─────────────────────────────────────────────────────────────────────

function RecommendationsV2EmptyState() {
  return (
    <div
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
      role="status"
      data-recommendations-v2-empty="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        No recommendations right now.
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
        Beacon is watching for the next clear opportunity. New recommendations
        appear when AI visibility shifts on a tracked prompt.
      </p>
    </div>
  );
}

function RecommendationsV2CalmState({
  inFlightCount,
}: {
  inFlightCount: number;
}) {
  return (
    <div
      className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-6"
      role="status"
      data-recommendations-v2-calm="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        You&apos;re caught up on suggestions.
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {inFlightCount > 0
          ? `Beacon is measuring ${inFlightCount} change${inFlightCount === 1 ? "" : "s"} you've already shipped. New recommendations appear when AI visibility shifts.`
          : "Beacon is watching for the next clear opportunity. New recommendations appear when AI visibility shifts on a tracked prompt."}
      </p>
    </div>
  );
}
