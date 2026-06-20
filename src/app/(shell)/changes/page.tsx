import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { ProofLedgerStrip } from "./proof-ledger-strip";
import { getOpportunities, getResults } from "@/lib/seed-data.server";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { getEventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import type { EnrichedChangeRow } from "./types";
import { ChangesV2Client } from "./changes-v2-client";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import {
  buildUrlCitationHistory,
  getSeriesForUrl,
  denseSeries,
  normalizeUrl,
} from "@/domains/product/url-citation-history";
import { computeUrlVerdict } from "@/domains/attribution/url-verdict";
import { maybeRefreshUrlWatcher } from "@/domains/product/url-watcher";
import { readStore } from "@/lib/persistence/json-store";
import {
  findBestUrlPattern,
  type UrlChangePattern,
} from "@/domains/learning/change-patterns";
import { extractEditTokens } from "@/domains/changelog/dedupe";
import {
  changelogJoinKey,
  classifyAll,
  indexEditsByJoinKey,
} from "@/domains/attribution/lifecycle-classification";
import {
  computeLifecycleCounts,
  editNeedsRewrite,
} from "@/domains/attribution/lifecycle-counts";
import { buildSyntheticChangelogRows } from "@/domains/attribution/synthesize-pending-changelog";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

// Phase 1.2 (Sprint 1, 2026-04-24): force dynamic render so every request
// runs the single-fresh-repo-read pattern below. Prevents any accidental ISR
// caching that would re-introduce the cross-lambda staleness we just fixed.
export const dynamic = "force-dynamic";

/**
 * /changes — the v2 proof timeline.
 *
 * Surface collapse (2026-06-15) — the legacy table + drawer
 * (`ScorecardTable`, the lifecycle strip + at-a-glance + dedupe banner
 * layout) was deleted; v2 is now the ONLY surface. The proof timeline
 * consumes the same enriched rows + classifier output the legacy table
 * did, so the heavy compute below is shared — only the legacy
 * presentation layer was removed.
 */
export default async function ChangeScorecardPage() {
  const trace = createPerfTrace("loader:/changes", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/changes",
  });
  try {
  trace.data("use_v2", "true");

  // Phase 1.2 (Sprint 1, 2026-04-24): single fresh repo read per request.
  // Every render-visible changelog value on this page derives from this
  // array. The prior implementation read from the module-level
  // `changelogEntries` import in @/lib/seed-data.server, which is hydrated
  // once per Vercel lambda cold start. Writes made by other lambdas stayed
  // invisible until that lambda reset, which is why operator Confirm clicks
  // appeared to succeed but /changes did not show the new scan_detection
  // entries. Honest error state below prevents a silent fallback to stale
  // cached data on repo failure.
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
  // Pivot (2026-06-14): these reads are now hoisted ABOVE the empty-state
  // gate so the gate reflects real activity, not just file imports.
  const repository = getRepository().forTenant(await currentTenantId());
  let freshChangelogEntries: ChangelogEntry[];
  try {
    freshChangelogEntries = await repository.getChangelogEntries();
  } catch (error) {
    return <ChangesReadError error={error} />;
  }

  // Hide archived (dedupe-retired + Phase 6A.1 test-pollution-archived)
  // entries from the main list. The lifecycle classifier (Phase 6A.2)
  // ALSO defends against archived rows reaching it, but filtering here
  // first keeps the classifier inputs clean.
  const liveEntries = freshChangelogEntries.filter((c) => !c.archived);

  // Phase 6A.2 (2026-04-28) — load recommended_edits + classify each
  // changelog row by lifecycle tab. This drives /changes's default view:
  // "Live verified" (i.e. lifecycle OS truth) instead of an undifferentiated
  // 291-row mix of imported legacy + scan diffs + pending impl + lifecycle
  // truth. The classifier itself is a pure module — see
  // src/domains/attribution/lifecycle-classification.ts.
  let recommendedEdits: RecommendedEditRow[] = [];
  try {
    recommendedEdits = await repository.getRecommendedEdits();
  } catch (err) {
    // Non-fatal: classifier degrades to source_system-only rules when
    // edits are missing. Log so a Supabase outage is observable.
    console.error("[changes] recommended_edits read failed (non-fatal)", err);
  }

  // Empty state — pivot (GSC-led, 2026-06-14): show it only when there is
  // genuinely NO activity (no live changelog rows AND no recommended edits).
  // Pre-pivot this gated on `hasActiveExperiment()` (import_runs > 0 ONLY),
  // so a GSC-led tenant that shipped a change or has accepted recommendations
  // — but never ran a file import — was wrongly told "Import your data" while
  // its real Changes were hidden. Changes are produced by the recommend →
  // ship flow + scan detection, not just file imports.
  if (liveEntries.length === 0 && recommendedEdits.length === 0) {
    return (
      <div>
        <PageHeader
          title="Changes"
          description="Every change you've made. Newest first."
        />
        <section
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
          aria-labelledby="changes-empty-heading"
        >
          <h2
            id="changes-empty-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            No changes yet
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Every edit you ship, and every change Beacon detects on your site,
            shows up here, newest first. Accept a recommendation to get your
            first change tracked.
          </p>
          <Link
            href="/recommendations"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Go to Recommendations →
          </Link>
        </section>
      </div>
    );
  }

  // ── Refresh URL watcher if stale (≥6h since last success). No-op when
  // throttled or if another run is already in flight. Never throws —
  // page still renders on watcher failure. Runs only once we know the
  // tenant has activity (don't trigger scans for a brand-new empty tenant).
  try {
    await maybeRefreshUrlWatcher("page-load");
  } catch (err) {
    console.error("[changes] URL watcher refresh error (non-fatal)", err);
  }
  // Phase 6B.1 (2026-04-28) — canonical truth for lifecycle counts is
  // `recommended_edits.implementation_status`, NOT joined changelog
  // entries. Pre-6B.1 the classifier counted changelog rows joined to
  // edits, which undercounted pending implementation when the
  // accept-fanout never minted changelog rows (Los Altos: 5 accepted
  // edits, 0 changelog rows → /changes Pending: 0, /today: 5).
  //
  // Fix: synthesize ChangelogEntry-shaped rows from each pending edit
  // that lacks a real changelog row. The synthetic rows go through
  // the same classifier + render path as real rows, so /changes
  // Pending now reads off the canonical truth without any data
  // mutation. Other tabs (Live verified, Imported legacy,
  // Scan-confirmed) remain changelog-driven.
  const lifecycleBuckets = computeLifecycleCounts(recommendedEdits);
  const syntheticPendingRows = buildSyntheticChangelogRows({
    changelogEntries: liveEntries,
    // Synthesize for both pending AND needs-review edits so /changes
    // tabs reflect canonical truth even when the historical accept
    // fan-out skipped a row. Verified-live edits ALWAYS have a real
    // changelog row (the runner stamps live_at), so no synthesis there.
    editsToSynthesize: [
      ...lifecycleBuckets.buckets.pendingEdits,
      ...lifecycleBuckets.buckets.needsReviewEdits,
    ],
  });
  const allRowsForClassifier = [...liveEntries, ...syntheticPendingRows];

  const editsByJoinKey = indexEditsByJoinKey(recommendedEdits);
  const classification = classifyAll({
    entries: allRowsForClassifier,
    editsByJoinKey,
  });
  // Phase 6A.3 (2026-04-28) — additionally expose the per-row linked
  // edit's implementation_status so the LifecycleStatusPill can render
  // the most-granular label (e.g. verified_live_modified vs
  // verified_live, not just live_verified). Falls through to the
  // classifier's tab class when there's no joined edit.
  // Phase 6A.6 (2026-04-28) — also expose the edit's `live_at` so the
  // attribution-copy resolver can run the bake-window check (verified_live
  // < 7 days ago → "Too early"; ≥ 7 days → "Verdict tracking off" /
  // "Verdict pending" depending on the verdict flag).
  // Phase 6B.1 (2026-04-28) — also expose `needsRewrite` so the
  // scorecard can surface the "needs rewrite" badge on synthetic
  // pending rows whose proposed_text is a generator placeholder.
  const editStatusByChangelogId: Record<string, ImplementationStatus> = {};
  const editLiveAtByChangelogId: Record<string, string> = {};
  const editNeedsRewriteByChangelogId: Record<string, boolean> = {};
  for (const entry of allRowsForClassifier) {
    const joinKey = changelogJoinKey(entry);
    if (!joinKey) continue;
    const edit = editsByJoinKey.get(joinKey);
    if (edit?.implementation_status) {
      editStatusByChangelogId[entry.id] = edit.implementation_status;
    }
    if (edit?.live_at) {
      editLiveAtByChangelogId[entry.id] = edit.live_at;
    }
    if (edit && editNeedsRewrite(edit)) {
      editNeedsRewriteByChangelogId[entry.id] = true;
    }
  }

  // ── Build URL citation history once per page load ──
  // The watcher above persisted the latest to disk if it ran this tick;
  // `buildUrlCitationHistory` itself is cheap enough (~100ms) to call on
  // every render. Watcher's real job is persistence + experiment metrics.
  //
  // Perf+egress bundle (2026-05-12) — pass a 60-day `sinceDate` so the
  // history builder only iterates the recent slice of observations. The
  // attribution stack's longest window is 44 days (URL-verdict baseline
  // 14d + post-window 30d), so 60d is a comfortable buffer. Pre-window,
  // this compute walked the FULL canonical observation array on every
  // /changes render — slow + heavy.
  const URL_HISTORY_WINDOW_DAYS = 60;
  const urlHistorySinceDate = new Date(
    Date.now() - URL_HISTORY_WINDOW_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const urlHistory = await buildUrlCitationHistory({
    ownedOnly: true,
    sinceDate: urlHistorySinceDate,
  });
  const today = new Date().toISOString().slice(0, 10);
  const historyRange = {
    first: urlHistory.date_range.first ?? today,
    last: urlHistory.date_range.last ?? today,
  };

  // ── Scorecard rows (feed the enriched proof-timeline rows below) ──
  const [results, opportunities, eventDecisions] = await Promise.all([
    getResults(),
    getOpportunities(),
    getEventDecisions(),
  ]);
  // Phase 6B.1 (2026-04-28) — feed `allRowsForClassifier` (real
  // changelog + synthetic pending rows) into the scorecard so synthetic
  // rows surface in the rendered table. computeScorecard is pure: rows
  // with no attribution events get empty arrays and zero counts, which
  // is the right answer for an edit that hasn't shipped yet.
  const rawRows = computeScorecard(allRowsForClassifier, results, opportunities, eventDecisions);
  const rows = enrichWithImpact(rawRows);

  // Newest-first default sort.
  rows.sort(
    (a, b) =>
      new Date(b.change.timestamp).getTime() -
      new Date(a.change.timestamp).getTime(),
  );

  // Pattern brain — read once, used to compute "Ready on [date]" for too-early
  // rows. When the brain has no helping-outcome history for a given
  // (edit_type × asset_type), we fall back transparently.
  const urlPatterns = await readStore<UrlChangePattern>("url-change-patterns");

  // ── Compute URL-level verdict per row ──
  const enriched: EnrichedChangeRow[] = rows.map((scorecard) => {
    const change = scorecard.change;
    const changeDate = change.timestamp.slice(0, 10);

    // Only treat values that truly look like URLs as URLs. Asset labels like
    // "Profound" or "Google Business Profile" are site-wide / offsite signals.
    const rawUrl = change.url?.trim() ?? "";
    const looksLikeUrl =
      rawUrl.startsWith("/") || /^https?:\/\//i.test(rawUrl);
    const normUrl = looksLikeUrl ? normalizeUrl(rawUrl) : null;
    const series = normUrl ? getSeriesForUrl(urlHistory, normUrl) : null;

    if (!series) {
      return {
        scorecard,
        urlVerdict: null,
        seriesPreview: null,
        hasUrl: !!normUrl,
      };
    }

    const dense = denseSeries(series, historyRange);
    const verdict = computeUrlVerdict({
      series: dense,
      changeDate,
      asOfDate: historyRange.last,
    });

    // G5 — Ready-on prediction for too-early rows from the pattern brain.
    // Honest fallback when the brain has no helping-outcome history yet.
    let readyOn: EnrichedChangeRow["readyOn"] = null;
    if (verdict.verdict === "too_early") {
      readyOn = computeReadyOn({
        changeTimestamp: change.timestamp,
        editTypeTokens: [...extractEditTokens(change.change_description)],
        assetType: change.asset_type,
        patterns: urlPatterns,
      });
    }

    return {
      scorecard,
      urlVerdict: verdict,
      seriesPreview: dense.filter((d) => {
        // Small window around change date for any sparkline use in the expand.
        const c = new Date(changeDate).getTime();
        const t = new Date(d.date).getTime();
        return Math.abs(t - c) / 86_400_000 <= 45;
      }),
      hasUrl: true,
      readyOn,
    };
  });

  // Proof-timeline pass — reuses the same enriched rows + classifier
  // output. Pure presentation layer at this boundary; no extra data
  // fetching, no server-action wiring.
  return (
    <>
      <Suspense fallback={null}>
        <ProofLedgerStrip />
      </Suspense>
      <ChangesV2Client
        rows={enriched}
        classByChangelogId={Object.fromEntries(classification.classOf)}
        editStatusByChangelogId={editStatusByChangelogId}
      />
    </>
  );
  } finally {
    trace.flush();
  }
}

/**
 * Phase 1.2 (Sprint 1, 2026-04-24) — honest error state.
 *
 * Rendered when the repository fetch fails. Deliberately does NOT fall back
 * to the stale module-level `changelogEntries` array; the whole point of the
 * fresh-read pattern is that operators never see data that conflicts with
 * what's actually in Supabase. A transient read failure is rare enough that a
 * plain retry message is the right UX — not a silent degrade to cached truth.
 */
function ChangesReadError({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "Unknown error reading changelog";
  return (
    <div>
      <PageHeader
        title="Changes"
        description="We couldn't load your changelog right now."
      />
      <section
        className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
        aria-labelledby="changes-read-error-heading"
      >
        <h2
          id="changes-read-error-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Couldn&apos;t load changes
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This usually means the database is temporarily unreachable. Refresh
          the page to retry. We never fall back to cached data here, so you
          won&apos;t see stale truth by accident.
        </p>
      </section>
    </div>
  );
}

/**
 * G5 — Compute the "Ready on [date]" prediction for a too-early row.
 *
 * Priority:
 *   1. Pattern brain hit with ≥1 helping outcome → use median_landing_day
 *      and cite the sample counts.
 *   2. Pattern brain hit with 0 helping outcomes → fallback to 7-day default,
 *      but explicitly SAY that no prior similar-edit landings exist yet.
 *   3. No pattern bucket at all (new edit type or asset_type combo) → same
 *      7-day default, different narrative.
 *
 * This preserves the "every verdict defensible" rule: the narrative on screen
 * always matches the data actually used.
 */
function computeReadyOn(input: {
  changeTimestamp: string;
  editTypeTokens: string[];
  assetType: import("@/lib/constants").AssetType;
  patterns: UrlChangePattern[];
}): EnrichedChangeRow["readyOn"] {
  const FALLBACK_DAYS = 7;

  const pattern = findBestUrlPattern(
    input.editTypeTokens as import("@/domains/changelog/dedupe").EditToken[],
    input.assetType,
    input.patterns,
  );

  const changeMs = new Date(input.changeTimestamp).getTime();

  // Case 1 — pattern has helping history → trust the median landing day.
  if (
    pattern &&
    pattern.helping_count > 0 &&
    pattern.median_landing_day !== null
  ) {
    const readyMs = changeMs + pattern.median_landing_day * 86_400_000;
    return {
      readyDate: new Date(readyMs).toISOString().slice(0, 10),
      daysFromChange: pattern.median_landing_day,
      patternId: pattern.id,
      helpingCount: pattern.helping_count,
      sampleCount: pattern.sample_count,
      confidenceTier: pattern.confidence_tier,
      narrative: `${pattern.helping_count} of ${pattern.sample_count} similar ${prettyToken(pattern.edit_type_token)} edits on ${prettyAsset(pattern.asset_type)}s landed by day ${pattern.median_landing_day}.`,
    };
  }

  // Case 2 — pattern exists but has 0 helping samples yet.
  if (pattern) {
    const readyMs = changeMs + FALLBACK_DAYS * 86_400_000;
    return {
      readyDate: new Date(readyMs).toISOString().slice(0, 10),
      daysFromChange: FALLBACK_DAYS,
      patternId: pattern.id,
      helpingCount: 0,
      sampleCount: pattern.sample_count,
      confidenceTier: pattern.confidence_tier,
      narrative: `No prior ${prettyToken(pattern.edit_type_token)} edits on ${prettyAsset(pattern.asset_type)}s have landed as helping yet in your workspace (${pattern.sample_count} sample${pattern.sample_count === 1 ? "" : "s"}, 0 helping). Using 7-day default.`,
    };
  }

  // Case 3 — no pattern bucket at all for this (token × asset_type).
  const readyMs = changeMs + FALLBACK_DAYS * 86_400_000;
  return {
    readyDate: new Date(readyMs).toISOString().slice(0, 10),
    daysFromChange: FALLBACK_DAYS,
    patternId: null,
    helpingCount: 0,
    sampleCount: 0,
    confidenceTier: null,
    narrative: `No prior similar-edit data in your workspace yet. Using 7-day default. Beacon will sharpen this once more changes land.`,
  };
}

function prettyToken(token: string): string {
  return token.replace(/_/g, " ");
}

function prettyAsset(asset: string): string {
  return asset.replace(/_/g, " ");
}
