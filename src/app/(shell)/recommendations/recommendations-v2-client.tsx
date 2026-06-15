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

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import {
  buildRecommendationActionRows,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";

import { RecommendationV2Card } from "@/components/recommendations/v2/recommendation-v2-card";
import {
  acceptRecommendation,
  type RecommendationActionPayload,
} from "./actions";
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
  // 2026-05-13 follow-up — the customer-facing watchlist footer link
  // was removed (it was the last v2 → legacy hop). The prop stays in
  // the contract so the page-level loader doesn't have to change, and
  // so a future v2 watchlist surface can adopt it without a prop diff.
  watchlist?: RecommendationWatchRow[];
  matrixDate: string;
  promptTextById: Record<string, string>;
  /** Slice 4.5.G-B.1 — active tracked-entity competitor names for the
   *  render-time `why`-display guard on each `<RecommendationV2Card>`.
   *  Threaded from the server page; optional. */
  competitorNames?: ReadonlyArray<string>;
  /** #149 (2026-06-11): per-tenant city vocabulary
   *  (BusinessConfig.locations) for geo tags in row titles. Threaded
   *  from the server page (client components can't read server config).
   *  Absent → legacy Bay-Area default. */
  knownCities?: ReadonlyArray<string>;
  /** #149-sibling: per-tenant service phrases for topic extraction. */
  knownServices?: ReadonlyArray<string>;
};

export function RecommendationsV2Client({
  queue,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  watchlist: _watchlist = [],
  matrixDate,
  promptTextById,
  competitorNames,
  knownCities,
  knownServices,
}: RecommendationsV2ClientProps) {
  // 2026-05-13 follow-up — "See full list" used to link to
  // `/recommendations?legacy=1`, pushing customers out of v2 every time
  // the queue had more than 7 actionable rows. The fix is a v2-native
  // inline toggle: when the operator clicks "See full list", expand
  // the Suggested stack to render every actionable row; clicking
  // "Show fewer" collapses back to the top 7. No legacy hop. No new
  // route. No new data fetch.
  const [showAllSuggested, setShowAllSuggested] = useState(false);

  // One-tap slice (2026-06-12): inline Accept on each card, wired to
  // the SAME acceptRecommendation server action the legacy drawer and
  // the detail page use (per-edit fan-out, changelog entries,
  // attribution clock — all unchanged). Optimistic per-row state.
  const [acceptStates, setAcceptStates] = useState<
    Record<string, "pending" | "accepted" | "error">
  >({});
  // #316 — capture the per-row error message so a failed card can show
  // WHICH error happened (the action returns `{error}` on the success:false
  // path) and the owner can retry that exact card. Keyed by rowId so one
  // failure among many is attributable.
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const acceptRow = (rowId: string, payload: RecommendationActionPayload) => {
    setAcceptStates((s) => ({ ...s, [rowId]: "pending" }));
    setAcceptErrors((e) => {
      if (!(rowId in e)) return e;
      const next = { ...e };
      delete next[rowId];
      return next;
    });
    startTransition(async () => {
      try {
        const res = await acceptRecommendation(payload);
        if (res.success) {
          setAcceptStates((s) => ({ ...s, [rowId]: "accepted" }));
        } else {
          // Action ran but reported a failure — surface its actual error.
          setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
          setAcceptErrors((e) => ({
            ...e,
            [rowId]:
              res.error ??
              "Something went wrong — please try again, or refresh your data.",
          }));
        }
      } catch (err) {
        setAcceptStates((s) => ({ ...s, [rowId]: "error" }));
        setAcceptErrors((e) => ({
          ...e,
          [rowId]: err instanceof Error ? err.message : String(err),
        }));
      }
    });
  };

  // Build typed action rows from the same queue the legacy table consumes.
  // Pure projection — no new I/O, no math change.
  const allRows = useMemo(
    () =>
      buildRecommendationActionRows({
        queue,
        promptTextById,
        knownCities,
        knownServices,
      }),
    [queue, promptTextById, knownCities, knownServices],
  );

  const actionableRows = useMemo(
    () => allRows.filter((r) => SUGGESTED_STATUSES.has(r.status)),
    [allRows],
  );

  const suggested = useMemo(
    () =>
      showAllSuggested
        ? actionableRows
        : actionableRows.slice(0, MAX_SUGGESTED_CARDS),
    [actionableRows, showAllSuggested],
  );

  const inFlightCount = useMemo(
    () => allRows.filter((r) => IN_FLIGHT_STATUSES.has(r.status)).length,
    [allRows],
  );

  const hasMoreActionable = actionableRows.length > MAX_SUGGESTED_CARDS;

  // Friendly date label for the page header microcopy. Already
  // formatted server-side as YYYY-MM-DD; keep it operator-safe by
  // rendering only as "as of <date>" — no UTC, no cron.
  const headerSubline = (
    <span data-recommendations-v2-header-subline="true">
      Beacon turns your Google Search demand + AI-answer gaps into safe,
      review-gated website edits — you approve every change yourself.{" "}
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
            {suggested.map((row) => {
              const acceptPayload: RecommendationActionPayload = {
                stableKey: row.sourceRecommendationId,
                // Placeholder type — the server action reads the
                // canonical rec from the store by stableKey (same
                // contract the legacy table uses).
                type: "create_cluster_page",
                title: row.title,
                description: row.evidenceSummary ?? row.title,
                clusterLabel: null,
                clusterKind: null,
              };
              return (
                <RecommendationV2Card
                  key={row.id}
                  row={row}
                  competitorNames={competitorNames}
                  acceptState={acceptStates[row.id] ?? "idle"}
                  acceptError={acceptErrors[row.id]}
                  onAccept={() => acceptRow(row.id, acceptPayload)}
                  onRetry={() => acceptRow(row.id, acceptPayload)}
                />
              );
            })}

            {hasMoreActionable && (
              <p className="pt-2 text-[11px] text-muted-foreground/80">
                {showAllSuggested ? (
                  <>
                    Showing all {actionableRows.length} recommendations.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAllSuggested(false)}
                      className="text-accent-primary hover:underline font-medium"
                      data-recommendations-v2-cta="show-fewer"
                    >
                      Show fewer ↑
                    </button>
                  </>
                ) : (
                  <>
                    Showing the top {suggested.length} of{" "}
                    {actionableRows.length} recommendations.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAllSuggested(true)}
                      className="text-accent-primary hover:underline font-medium"
                      data-recommendations-v2-cta="see-all"
                    >
                      See full list →
                    </button>
                  </>
                )}
              </p>
            )}
          </section>

          {/* Working rail */}
          <RecommendationsV2WorkingRail rows={allRows} />
        </div>
      )}

      {/* 2026-05-13 follow-up — the customer-facing watchlist footer
          used to render `${watchlist.length} winning patterns on watch →`
          here, linking at `/recommendations?legacy=1#watchlist`. It was
          the last customer-facing v2 → legacy hop and is removed in
          this bundle. The watchlist still exists on the legacy route
          (`/recommendations?legacy=1`) for direct operator access;
          when a v2 watchlist surface lands, restore this footer with
          a v2 href. The `watchlist` prop is intentionally still
          accepted so the page-level loader contract doesn't change. */}
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
        Refresh your connected data (Settings → Connectors) to surface the next
        clear opportunity — fresh search demand or a content gap on your pages.
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
          ? `Beacon is measuring ${inFlightCount} change${inFlightCount === 1 ? "" : "s"} you've already shipped. Refresh your connected data to surface fresh search demand or a content gap.`
          : "Refresh your connected data (Settings → Connectors) to surface the next clear opportunity — fresh search demand or a content gap on your pages."}
      </p>
    </div>
  );
}
