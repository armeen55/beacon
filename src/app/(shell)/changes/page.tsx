import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { EvidenceFreshnessBanner } from "@/components/shell/evidence-freshness-banner";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  opportunities,
  results,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { ScorecardTable, type EnrichedChangeRow } from "./scorecard-client";
import {
  loadAllChangeOutcomes,
  type StoredChangeOutcome,
} from "@/domains/attribution/change-outcome-store";
import { deriveCoverageState, coverageWarningLine } from "@/lib/coverage-state";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { sampleQualityTierFromObservationCount } from "@/lib/sample-quality-tier";
// Legacy Z-score "watching" outcomes import removed in Phase 2C cleanup.
import { findDuplicatePairs } from "@/domains/changelog/dedupe";
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
import { isEventTruthPreviewEnabled } from "@/lib/flags";

// Phase 1.2 (Sprint 1, 2026-04-24): force dynamic render so every request
// runs the single-fresh-repo-read pattern below. Prevents any accidental ISR
// caching that would re-introduce the cross-lambda staleness we just fixed.
export const dynamic = "force-dynamic";

export default async function ChangeScorecardPage() {
  if (!hasActiveExperiment()) {
    return (
      <div>
        <PageHeader
          title="Changes"
          description="Every change you've made. Newest first."
        />
        <section
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
          aria-labelledby="changes-import-empty-heading"
        >
          <h2
            id="changes-import-empty-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            Import your data to see your real Changes workspace
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            The changelog shows every change you&apos;ve imported plus every change
            Beacon detects on your site. Import to get started.
          </p>
          <Link
            href="/settings/import"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Go to Import →
          </Link>
        </section>
      </div>
    );
  }

  // ── Refresh URL watcher if stale (≥6h since last success). No-op when
  // throttled or if another run is already in flight. Never throws —
  // page still renders on watcher failure.
  try {
    await maybeRefreshUrlWatcher("page-load");
  } catch (err) {
    console.error("[changes] URL watcher refresh error (non-fatal)", err);
  }

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
  const repository = getRepository().forTenant(await currentTenantId());
  let freshChangelogEntries: ChangelogEntry[];
  try {
    freshChangelogEntries = await repository.getChangelogEntries();
  } catch (error) {
    return <ChangesReadError error={error} />;
  }

  // Hide archived (dedupe-retired) entries from the main list.
  const liveEntries = freshChangelogEntries.filter((c) => !c.archived);

  // ── Build URL citation history once per page load ──
  // The watcher above persisted the latest to disk if it ran this tick;
  // `buildUrlCitationHistory` itself is cheap enough (~100ms) to call on
  // every render. Watcher's real job is persistence + experiment metrics.
  const urlHistory = buildUrlCitationHistory({ ownedOnly: true });
  const today = new Date().toISOString().slice(0, 10);
  const historyRange = {
    first: urlHistory.date_range.first ?? today,
    last: urlHistory.date_range.last ?? today,
  };

  // ── Legacy scorecard rows (still used for drill-down topic/platform breakdown) ──
  const rawRows = computeScorecard(liveEntries, results, opportunities, eventDecisions);
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
  const urlPatterns = readStore<UrlChangePattern>("url-change-patterns");

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

  const allTopics = [...new Set(rows.flatMap((r) => r.topics))].sort();
  const allPlatforms = [...new Set(rows.flatMap((r) => r.platforms))].sort();

  const lastCrawl = await latestWebsiteCrawlRun();
  const crawlAgeDays = lastCrawl?.completed_at
    ? Math.floor(
        (Date.now() - new Date(lastCrawl.completed_at).getTime()) / 86_400_000,
      )
    : null;
  const coverageState = deriveCoverageState({
    crawlAgeDays,
    visibilityStaleVsCrawl: false,
    sampleQualityTier: sampleQualityTierFromObservationCount(results.length),
  });
  const coverageWarning = coverageWarningLine(coverageState);

  // Dedupe banner — reuses the single fresh read above (Phase 1.2, Sprint 1).
  // Prior Phase B fix did its own repo round-trip here; consolidating with the
  // main fresh read eliminates a duplicate fetch per request and keeps all
  // page-level changelog computations on the same snapshot.
  const duplicatePairs = findDuplicatePairs(freshChangelogEntries);
  const duplicatePairCount = duplicatePairs.length;

  const newestISO = rows[0]?.change.timestamp ?? null;
  const newestLabel = newestISO ? describeRecency(newestISO) : null;

  const truthPreviewEnabled = isEventTruthPreviewEnabled();

  // Phase 2C cleanup — legacy "watching" rows removed. Attribution status
  // (computed / weak_estimate / no_controls / ...) is now the single source
  // of truth in the scorecard below.

  // Phase 2C — load stored attribution outcomes (natural-controls engine output)
  // and key by change_id so the scorecard row can render the new attribution
  // status pill instead of the legacy verdict label. Absent key → no outcome
  // yet (row shows muted "not yet" pill instead of fake verdict).
  let outcomesById: Record<string, StoredChangeOutcome> = {};
  try {
    const stored = loadAllChangeOutcomes();
    outcomesById = Object.fromEntries(stored.map((o) => [o.source_id, o]));
  } catch {
    // Store may not exist yet on a fresh machine — graceful degrade.
    outcomesById = {};
  }

  // Phase 2C cleanup — at-a-glance counts now derived from the attribution
  // store (computed / weak_estimate / no_controls). Legacy verdict counts
  // (helping / hurting / too_early) retired.
  const countsByStatus = {
    computed: Object.values(outcomesById).filter((o) => o.status === "computed").length,
    weak_estimate: Object.values(outcomesById).filter((o) => o.status === "weak_estimate").length,
    no_controls: Object.values(outcomesById).filter((o) => o.status === "no_controls").length,
    unsupported_scope: Object.values(outcomesById).filter((o) => o.status === "unsupported_scope").length,
  };

  return (
    <div>
      <PageHeader
        title="Changes"
        description="Every change you've made. Newest first. Each row shows its attribution status and confidence."
      />

      {/* Commit 2 (2026-04-24): evidence-freshness honesty banner. Z-score
          verdicts below are computed from url-citation-history which reads
          Profound citation shards only. Native polls from Apr 22+ are not
          yet mixed into the series. Changes made post-pivot render
          "too_early" (honest); changes pre-pivot get Profound-only verdicts. */}
      <EvidenceFreshnessBanner
        builtAt={citationEvidenceIndex?.built_at ?? null}
        label="Change verdicts"
        className="mb-6"
      />

      {/* At-a-glance */}
      <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="font-bold tabular-nums">{enriched.length}</span>
            <span className="text-muted-foreground ml-1.5">changes tracked</span>
          </span>
          {newestLabel && (
            <span className="text-muted-foreground">
              Latest: <span className="font-medium text-foreground">{newestLabel}</span>
            </span>
          )}
          {countsByStatus.computed > 0 && (
            <span className="text-accent-primary font-semibold tabular-nums">
              {countsByStatus.computed} computed
            </span>
          )}
          {countsByStatus.weak_estimate > 0 && (
            <span className="text-status-warning/90 font-semibold tabular-nums">
              {countsByStatus.weak_estimate} weak
            </span>
          )}
          {countsByStatus.no_controls > 0 && (
            <span className="text-status-warning/90 font-semibold tabular-nums">
              {countsByStatus.no_controls} no controls
            </span>
          )}
          {countsByStatus.unsupported_scope > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {countsByStatus.unsupported_scope} unsupported
            </span>
          )}
          {coverageWarning && (
            <span className="text-[11px] text-status-warning/70">
              · {coverageWarning.toLowerCase()}
            </span>
          )}
        </div>
      </div>

      {/* Event-level truth preview (flag-gated) */}
      {truthPreviewEnabled && (
        <div className="mb-4 flex items-center justify-end">
          <Link
            href="/changes/truth"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent-primary hover:text-accent-primary/85 underline underline-offset-2"
          >
            Event-level truth (preview) →
          </Link>
        </div>
      )}

      {/* Dedupe banner */}
      {duplicatePairCount > 0 && (
        <div className="mb-5 rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-foreground">
              {duplicatePairCount} possible duplicate{duplicatePairCount === 1 ? "" : "s"} in your changelog
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              CSV summaries that look like they describe the same edits as your PDF entries. Review once to clean the list.
            </p>
          </div>
          <Link
            href="/changes/dedupe"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-accent-primary/50 bg-accent-primary/10 px-3 py-1.5 text-[11px] font-semibold text-accent-primary hover:bg-accent-primary/20 transition-colors"
          >
            Review duplicates →
          </Link>
        </div>
      )}

      <ScorecardTable
        rows={enriched}
        allTopics={allTopics}
        allPlatforms={allPlatforms}
        coverageState={coverageState}
        outcomesById={outcomesById}
      />

      {/* Phase 2C cleanup — legacy "Currently being watched" strip removed.
          Its helping/hurting/too-early language contradicted the new
          attribution status model. The scorecard list above renders every
          change's attribution status; detail pages drill into the math. */}
    </div>
  );
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
    narrative: `No prior similar-edit data in your workspace yet. Using 7-day default. The pattern brain will sharpen this once more changes land.`,
  };
}

function prettyToken(token: string): string {
  return token.replace(/_/g, " ");
}

function prettyAsset(asset: string): string {
  return asset.replace(/_/g, " ");
}

function describeRecency(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
