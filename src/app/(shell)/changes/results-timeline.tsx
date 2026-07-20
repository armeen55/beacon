import Link from "next/link";
// R4 (2026-07-03) - this timeline renders only on /results, so its ledger COUNT
// reads the same request-memoized SWR snapshot the page already serves instead of
// re-triggering a full re-measure (loadProofLedger) for one number.
import { loadResultsLedgerSurface } from "../results/results-ledger-data";
import { isOperatorModeServer } from "@/lib/operator-mode";
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

/**
 * ResultsTimeline — the "what changed / is it measuring / did it work" timeline.
 *
 * IA consolidation (2026-06-23): this is the former `/changes` index body,
 * extracted verbatim (no attribution/proof math changes) so it can be embedded
 * inside the single Results (/results) page. The /changes index is now a thin
 * redirect to /results; this component renders the v2 proof timeline with its
 * own header SUPPRESSED (Results shows the page header) and without the
 * duplicate proof-ledger strip (Results already renders the measured-outcomes
 * ledger above it).
 *
 * Embedded empty/error states are compact (no PageHeader) so they compose
 * cleanly as a section under the Results page.
 */
export async function ResultsTimeline() {
  const trace = createPerfTrace("loader:results-timeline", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/results",
  });
  try {
    const repository = getRepository().forTenant(await currentTenantId());
    let freshChangelogEntries: ChangelogEntry[];
    try {
      freshChangelogEntries = await repository.getChangelogEntries();
    } catch (error) {
      // The raw technical error (which can carry the store internals and the
      // failing table name) goes to the SERVER log only, never to the operator.
      console.error("[results-timeline] change history read failed", error);
      return <ResultsTimelineReadError />;
    }

    const liveEntries = freshChangelogEntries.filter((c) => !c.archived);

    let recommendedEdits: RecommendedEditRow[] = [];
    try {
      recommendedEdits = await repository.getRecommendedEdits();
    } catch (err) {
      console.error(
        "[results-timeline] recommended_edits read failed (non-fatal)",
        err,
      );
    }

    // Compact embedded empty state (no duplicate page header).
    if (liveEntries.length === 0 && recommendedEdits.length === 0) {
      return (
        <section
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
          aria-labelledby="results-timeline-empty-heading"
          data-results-timeline-empty="true"
        >
          <h2
            id="results-timeline-empty-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            No changes yet
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Every edit you ship, and every change Beacon detects on your site,
            shows up here, newest first. Approve a suggested fix to get your
            first change tracked.
          </p>
          <Link
            href="/recommendations"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            See suggested fixes &rarr;
          </Link>
        </section>
      );
    }

    try {
      await maybeRefreshUrlWatcher("page-load");
    } catch (err) {
      console.error("[results-timeline] URL watcher refresh error (non-fatal)", err);
    }

    const lifecycleBuckets = computeLifecycleCounts(recommendedEdits);
    const syntheticPendingRows = buildSyntheticChangelogRows({
      changelogEntries: liveEntries,
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

    const [results, opportunities, eventDecisions] = await Promise.all([
      getResults(),
      getOpportunities(),
      getEventDecisions(),
    ]);
    const rawRows = computeScorecard(
      allRowsForClassifier,
      results,
      opportunities,
      eventDecisions,
    );
    const rows = enrichWithImpact(rawRows);

    rows.sort(
      (a, b) =>
        new Date(b.change.timestamp).getTime() -
        new Date(a.change.timestamp).getTime(),
    );

    const urlPatterns = await readStore<UrlChangePattern>("url-change-patterns");

    const enriched: EnrichedChangeRow[] = rows.map((scorecard) => {
      const change = scorecard.change;
      const changeDate = change.timestamp.slice(0, 10);

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
          const c = new Date(changeDate).getTime();
          const t = new Date(d.date).getTime();
          return Math.abs(t - c) / 86_400_000 <= 45;
        }),
        hasUrl: true,
        readyOn,
      };
    });

    let proofLedgerCount = 0;
    if (isOperatorModeServer()) {
      try {
        proofLedgerCount = (await loadResultsLedgerSurface()).ledger.length;
      } catch {
        proofLedgerCount = 0;
      }
    }

    return (
      <ChangesV2Client
        rows={enriched}
        classByChangelogId={Object.fromEntries(classification.classOf)}
        editStatusByChangelogId={editStatusByChangelogId}
        proofLedgerCount={proofLedgerCount}
        showHeader={false}
      />
    );
  } finally {
    trace.flush();
  }
}

/**
 * Compact embedded error state (no PageHeader). Never falls back to stale
 * cached truth, and never leaks the raw technical error (store internals, table
 * names, stack fragments) to the operator - that goes to the server log at the
 * catch site. The operator sees calm, plain recovery copy only.
 */
export function ResultsTimelineReadError() {
  return (
    <section
      className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
      aria-labelledby="results-timeline-read-error-heading"
      data-results-timeline-error="true"
    >
      <h2
        id="results-timeline-read-error-heading"
        className="text-[13px] font-semibold text-foreground tracking-tight"
      >
        I could not read your change history just now.
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Try again in a minute.
      </p>
    </section>
  );
}

/**
 * G5 — "Ready on [date]" prediction for a too-early row (moved verbatim from
 * the /changes index; no math change).
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
