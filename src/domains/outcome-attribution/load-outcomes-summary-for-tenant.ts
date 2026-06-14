/**
 * 2026-05-19 — Section 9 Today tile — outcomes-summary aggregator.
 *
 * Server-side aggregator over verified-live `recommended_edits`
 * within the last 30 days. Produces an `OutcomesSummary`
 * discriminator the `EditOutcomesTile` consumer renders. Mirrors the
 * 9.A2β.1 URL-scoped SELECT pattern: canonicalize each target_url
 * FIRST, build a deduped candidate set, then `.eq("tenant_id", ...)
 * .in("url", [...])` — never hits the Supabase 1,000-row default cap.
 *
 * Algorithm: get all tenant edits → filter to verified-live within
 * 30d → canonicalize → build URL candidates (canonical + slash) →
 * ONE Supabase SELECT (skipped on empty candidates) → narrow rows →
 * per-edit Mode A compute with `qualifiedCallCount=0` (K2 deferred)
 * → aggregate.
 *
 * Soft-fail to `status: "data_unavailable"` on repo throws / non-
 * array edits / admin throws / 42P01 / read error / non-array data
 * — consumer collapses to the locked still-gathering copy (silence
 * would read as broken on Today's denser surface; preflight section F).
 *
 * Cache: `unstable_cache` with key `["outcomes-summary-tenant:v1",
 * tenantId, "30", todayUtcDate]` — daily-stamp keeps the 30-day
 * window sliding cleanly + the K4 ≥7-day boundary re-evaluating
 * without waiting for TTL. 6h TTL · tag `recommended_edits:${tenantId}`.
 *
 * Pinned by:
 *   • tests/domains/outcome-attribution/load-outcomes-summary-for-tenant.test.ts
 *   • tests/architecture/edit-outcomes-loader-no-ga4-api.test.ts
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadQualifiedCallCountForUrl } from "@/lib/connectors/callrail/persist-url-calls";
import {
  computeModeATrafficAttribution,
  type ModeAResult,
} from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { Ga4UrlTrafficRow } from "@/lib/connectors/ga4/types";
import { getRepository } from "@/lib/persistence/repositories";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

const TABLE = "ga4_url_traffic";

/** Section 9 Today-tile aggregation window (locked at preflight). */
const WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Discriminator shape consumed by `EditOutcomesTile`. `status:
 * "data_unavailable"` indicates the loader soft-failed; the
 * consumer renders the same calm copy as the still-gathering state.
 */
export type OutcomesSummary = {
  status: "ok" | "data_unavailable";
  /** Verified-live edits in the 30-day window. Includes
   *  still_learning / ineligible — every edit considered. */
  total_recent_live_edits: number;
  /** Edits whose Mode A returned `kind: "eligible"`. */
  eligible_edits: number;
  /** Edits whose Mode A returned `kind: "still_learning_outcome"`. */
  still_learning_edits: number;
  /** Edits whose Mode A returned `kind: "ineligible"` (substrate
   *  gap; no live_at OR no target_url OR no traffic match). */
  ineligible_edits: number;
  /** Sum of `post_live_sessions` across eligible edits. */
  sum_post_live_sessions: number;
  /** Sum of `post_live_engaged_sessions` across eligible edits.
   *  Operator-side telemetry only — NOT surfaced in customer copy. */
  sum_post_live_engaged_sessions: number;
  /** Sum of `post_live_qualified_calls` across eligible edits.
   *  K2-deferred — always 0 in v1. The component's calls clause is
   *  source-present but suppressed when this sum === 0. */
  sum_post_live_qualified_calls: number;
  /** Window size in days. Surfaces in the tile caption. */
  window_days: number;
};

export type LoadOutcomesSummaryForTenantOptions = {
  tenantId: string;
  /** Clock injection for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * Verified-live predicate. Matches the operator-locked
 * `isVerifiedLive` shape from `/diagnostics/outcome-attribution`
 * (9.A2α.3). Includes `partially_implemented` so partial-live edits
 * contribute to the Today tile rollup the same way the operator
 * diagnostic counts them.
 */
function isVerifiedLive(edit: RecommendedEditRow): boolean {
  return (
    edit.implementation_status === "verified_live" ||
    edit.implementation_status === "verified_live_modified" ||
    edit.implementation_status === "partially_implemented"
  );
}

function emptySummary(status: "ok" | "data_unavailable"): OutcomesSummary {
  return {
    status,
    total_recent_live_edits: 0,
    eligible_edits: 0,
    still_learning_edits: 0,
    ineligible_edits: 0,
    sum_post_live_sessions: 0,
    sum_post_live_engaged_sessions: 0,
    sum_post_live_qualified_calls: 0,
    window_days: WINDOW_DAYS,
  };
}

function isoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function loadOutcomesSummaryForTenant(
  options: LoadOutcomesSummaryForTenantOptions,
): Promise<OutcomesSummary> {
  const { tenantId } = options;
  const now = options.now ?? new Date();

  const { unstable_cache } = await import("next/cache");
  const todayUtc = isoDateUtc(now);
  const cacheKey = [
    "outcomes-summary-tenant:v1",
    tenantId,
    String(WINDOW_DAYS),
    todayUtc,
  ];

  const cached = unstable_cache(
    async () => {
      // Step 1: fetch all tenant recommended_edits via the repository.
      let allEdits: RecommendedEditRow[];
      try {
        const repo = getRepository().forTenant(tenantId);
        allEdits = await repo.getRecommendedEdits();
      } catch {
        return emptySummary("data_unavailable");
      }
      if (!Array.isArray(allEdits)) {
        return emptySummary("data_unavailable");
      }

      // Step 2: filter to verified-live AND live_at within the 30-day
      // window. The window is computed from `now`; edits whose
      // `live_at` is null OR unparseable OR older than the window
      // are excluded entirely from `total_recent_live_edits` (they
      // are not "recent shipped work").
      const windowStartMs = now.getTime() - WINDOW_DAYS * MS_PER_DAY;
      const recentLiveEdits: RecommendedEditRow[] = [];
      for (const edit of allEdits) {
        if (!isVerifiedLive(edit)) continue;
        const liveAt = edit.live_at ?? null;
        if (liveAt == null || liveAt === "") continue;
        const liveAtMs = Date.parse(liveAt);
        if (!Number.isFinite(liveAtMs)) continue;
        if (liveAtMs < windowStartMs) continue;
        if (liveAtMs > now.getTime()) continue; // defensive: future-dated
        recentLiveEdits.push(edit);
      }

      if (recentLiveEdits.length === 0) {
        return emptySummary("ok");
      }

      // Step 3: canonicalize each edit's target_url. Edits whose
      // canonicalizer returns null contribute zero URL candidates
      // and will count as `ineligible_edits` at the per-edit Mode A
      // step below.
      const perEditCanonical = recentLiveEdits.map((edit) => ({
        edit,
        canonicalTargetUrl: canonicalizeCitationUrl(edit.target_url ?? null),
      }));

      // Step 4: build deduped URL candidate set.
      const candidateSet = new Set<string>();
      for (const { canonicalTargetUrl } of perEditCanonical) {
        if (canonicalTargetUrl == null) continue;
        candidateSet.add(canonicalTargetUrl);
        candidateSet.add(`${canonicalTargetUrl}/`);
      }

      // Step 5: ONE Supabase SELECT — skip entirely if no candidates.
      let trafficRows: Ga4UrlTrafficRow[] = [];
      if (candidateSet.size > 0) {
        let admin;
        try {
          admin = getSupabaseAdmin();
        } catch {
          return emptySummary("data_unavailable");
        }
        const urlCandidates = Array.from(candidateSet);
        const { data, error } = await admin
          .from(TABLE)
          .select("url, date, sessions, engaged_sessions, conversions")
          .eq("tenant_id", tenantId)
          .in("url", urlCandidates);
        if (error != null) {
          return emptySummary("data_unavailable");
        }
        if (!Array.isArray(data)) {
          return emptySummary("data_unavailable");
        }
        // Step 6: narrow rows defensively.
        for (const row of data) {
          if (row == null || typeof row !== "object") continue;
          const r = row as Record<string, unknown>;
          const url = typeof r.url === "string" ? r.url : null;
          const date = typeof r.date === "string" ? r.date : null;
          if (url == null || date == null) continue;
          trafficRows.push({
            url,
            date,
            sessions: typeof r.sessions === "number" ? r.sessions : 0,
            engaged_sessions:
              typeof r.engaged_sessions === "number"
                ? r.engaged_sessions
                : 0,
            conversions:
              typeof r.conversions === "number" ? r.conversions : 0,
          });
        }
      }

      // Step 7: per-edit Mode A compute. Each edit gets ONLY the
      // rows whose canonicalized URL matches its own canonical URL
      // — defense in depth via the canonicalizer's per-row check.
      let eligible = 0;
      let stillLearning = 0;
      let ineligible = 0;
      let sumSessions = 0;
      let sumEngaged = 0;
      let sumCalls = 0;
      // wave-5 #1 (2026-06-14): the headline "N live edits received M sessions
      // and K calls from changed pages" must count each changed PAGE's traffic
      // ONCE. A single URL can carry multiple edits (the row id is
      // recId__actionType__elementKey), each independently verified_live, and
      // each edit's matchingRows is the SAME page's GA4 rows — so summing per
      // edit double-counted (Nx) the page's sessions AND qualified calls.
      // Eligibility counts below stay per-edit (correct); the traffic/call
      // SUMS are deduped by canonical URL.
      const summedUrls = new Set<string>();
      for (const { edit, canonicalTargetUrl } of perEditCanonical) {
        if (canonicalTargetUrl == null) {
          // Mode A would return ineligible: no_target_url; pre-filter
          // here for parity with the diagnostic-page per-edit table.
          ineligible++;
          continue;
        }
        const matchingRows: Ga4UrlTrafficRow[] = [];
        for (const row of trafficRows) {
          if (canonicalizeCitationUrl(row.url) !== canonicalTargetUrl) {
            continue;
          }
          matchingRows.push(row);
        }
        // §9.B — qualified CallRail calls attributed to this URL since
        // live. Soft-fails to 0 (no CallRail / no Supabase / no rows) →
        // byte-identical to the old hardcoded 0 when unconnected.
        const callsSince = edit.live_at ? edit.live_at.slice(0, 10) : null;
        const qualifiedCallCount = callsSince
          ? await loadQualifiedCallCountForUrl({
              tenantId,
              canonicalUrl: canonicalTargetUrl,
              sinceUtcDate: callsSince,
              // wave-5 #6 (2026-06-14): bound the call window at `now` so it
              // matches the [live_at, now] session window rendered beside it.
              untilUtcDate: todayUtc,
            })
          : 0;
        const result: ModeAResult = computeModeATrafficAttribution({
          recommendedEdit: edit,
          ga4UrlTrafficRows: matchingRows,
          qualifiedCallCount,
          now,
        });
        if (result.kind === "eligible") {
          eligible++;
          // Add this page's traffic/calls to the tenant-wide totals only the
          // FIRST time we see the URL — subsequent same-URL edits still count
          // toward `eligible` but must not re-add the same page's numbers.
          if (!summedUrls.has(canonicalTargetUrl)) {
            summedUrls.add(canonicalTargetUrl);
            sumSessions += result.post_live_sessions;
            sumEngaged += result.post_live_engaged_sessions;
            sumCalls += result.post_live_qualified_calls;
          }
        } else if (result.kind === "still_learning_outcome") {
          stillLearning++;
        } else {
          ineligible++;
        }
      }

      const summary: OutcomesSummary = {
        status: "ok",
        total_recent_live_edits: recentLiveEdits.length,
        eligible_edits: eligible,
        still_learning_edits: stillLearning,
        ineligible_edits: ineligible,
        sum_post_live_sessions: sumSessions,
        sum_post_live_engaged_sessions: sumEngaged,
        sum_post_live_qualified_calls: sumCalls,
        window_days: WINDOW_DAYS,
      };
      return summary;
    },
    cacheKey,
    {
      revalidate: 21_600,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  return cached();
}

/** Test-only export of internals. */
export const __testing = {
  WINDOW_DAYS,
  isVerifiedLive,
  isoDateUtc,
};
