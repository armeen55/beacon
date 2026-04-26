import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import { MatchFactors } from "@/components/display/match-factors";
import { buildAttributionConfidenceBasis } from "@/lib/attribution-confidence-basis";
import { getResults, getOpportunities } from "@/lib/seed-data.server";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { getEventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact, computeChangeImpact } from "@/domains/attribution/change-impact";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { getOwnedPages } from "@/domains/pages/page-store";
import {
  getRolloutExecutions,
  getPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { computeTrackRecord, wasChangeRecommended } from "@/domains/product/recommendation-tracker";
import { getSectionAnalyzerConfig } from "@/lib/business-config";
import { ATTRIBUTION_CONFIDENCE_LABEL, REC_CONFIDENCE_LABEL } from "@/lib/confidence-labels";
import type { EventAttribution, TrustSource } from "@/domains/attribution/scorecard";
import type { AttributionConfidence, ImpactConfidence, ImpactDirection } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";
import type { BeaconRecommendation } from "@/domains/product/recommendation-engine";
import {
  SIGNAL_TYPE_LABELS,
  ASSET_TYPE_LABELS,
} from "@/lib/constants";
import { deriveCoverageState, coverageWarningLine } from "@/lib/coverage-state";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { sampleQualityTierFromObservationCount } from "@/lib/sample-quality-tier";
import { HypothesisEditor } from "./hypothesis-editor";
import { AttributionDrilldown } from "../attribution-drilldown";
import { loadChangeOutcomeById } from "@/domains/attribution/change-outcome-store";

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "Google AI Overviews",
  perplexity: "Perplexity",
};

const CONF_LABELS = ATTRIBUTION_CONFIDENCE_LABEL as Record<AttributionConfidence, string>;

const TIER_LABELS: Record<EvidenceTier, string> = {
  exact: "Exact — verified page in registry",
  probable: "Probable — structural URL or strong description",
  weak: "Weak — vague description or no URL",
  inferred: "Inferred — reconstructed from patterns",
};

const TIER_COLORS: Record<EvidenceTier, string> = {
  exact: "text-status-success bg-status-success/10 border-status-success/20",
  probable: "text-foreground-secondary bg-surface-inset border-border",
  weak: "text-status-warning bg-status-warning/10 border-status-warning/20",
  inferred: "text-muted-foreground bg-surface-inset border-border",
};

const ROLE_LABELS: Record<string, string> = {
  primary: "Strongest Match",
  contributing: "Contributing Match",
  candidate: "Unresolved Candidate",
};

const ROLE_BORDER: Record<string, string> = {
  primary: "border-l-status-success",
  contributing: "border-l-status-warning",
  candidate: "border-l-muted-foreground",
};

const TRUST_LABELS: Record<TrustSource, string> = {
  operator_confirmed: "Confirmed in Review",
  auto_cleared: "Auto-cleared",
  system_primary: "System pick",
  contributing: "Contributing",
  candidate: "Needs review",
  operator_rejected: "Rejected in Review",
};

const TRUST_DOT: Record<TrustSource, string> = {
  operator_confirmed: "bg-status-success",
  auto_cleared: "bg-accent-primary",
  system_primary: "bg-accent-primary",
  contributing: "bg-status-warning",
  candidate: "bg-muted-foreground/50",
  operator_rejected: "bg-status-danger",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  first_appearance: "First Appearance",
  visibility_regained: "Visibility Regained",
  mention_surge: "Mention Surge",
  visibility_lost: "Visibility Lost",
  mention_decline: "Mention Decline",
};

// Phase 1.6 (Sprint 1 follow-up, 2026-04-24): force dynamic render so every
// request runs the fresh-repo-read pattern below. Matches /changes main list.
export const dynamic = "force-dynamic";

export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Phase 1.6 (Sprint 1 follow-up, 2026-04-24): fresh per-request repo read.
  // The prior implementation called `changelogEntries.find(...)` against the
  // module-level array from @/lib/seed-data.server, which is hydrated once
  // per Vercel lambda cold start. A scan_detection entry written by a
  // different lambda was invisible here and the page rendered notFound.
  //
  // Scope: only `changelogEntries` is fresh this phase. `results`,
  // `opportunities`, and `eventDecisions` below continue to read from their
  // module-level arrays — they enrich the attribution/coverage display but
  // do not affect whether the target entry renders or what its core fields
  // say. Full mutable-array sweep is Sprint 4/5 scope.
  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read.
  const tenantId = await currentTenantId();
  const repository = getRepository().forTenant(tenantId);
  let freshChangelogEntries: ChangelogEntry[];
  try {
    freshChangelogEntries = await repository.getChangelogEntries();
  } catch (error) {
    return <ChangeDetailReadError error={error} />;
  }

  const entry = freshChangelogEntries.find((c) => c.id === id);
  if (!entry) notFound();

  const [results, opportunities, eventDecisions, rolloutExecutions, persistedPatternEvidence] = await Promise.all([
    getResults(),
    getOpportunities(),
    getEventDecisions(),
    getRolloutExecutions(),
    getPatternEvidence(),
  ]);
  const allRows = computeScorecard(
    freshChangelogEntries,
    results,
    opportunities,
    eventDecisions,
  );
  const row = allRows.find((r) => r.change.id === id);
  if (!row) notFound();

  const lastCrawlDetail = await latestWebsiteCrawlRun();
  const changeCrawlAgeDays = lastCrawlDetail?.completed_at
    ? Math.floor(
        (Date.now() - new Date(lastCrawlDetail.completed_at).getTime()) / 86_400_000,
      )
    : null;
  const changeCoverageState = deriveCoverageState({
    crawlAgeDays: changeCrawlAgeDays,
    visibilityStaleVsCrawl: false,
    sampleQualityTier: sampleQualityTierFromObservationCount(results.length),
  });
  const changeCoverageWarning = coverageWarningLine(changeCoverageState);

  const impact = computeChangeImpact(row);

  const sortedAttributions = [...row.eventAttributions].sort(
    (a, b) => b.score - a.score
  );

  // Compute recommendations originating from this change
  const impactRows = enrichWithImpact(allRows);

  const citationIndex2 = citationEvidenceIndex as {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
    }[];
    by_topic: { topic: string }[];
  } | null;
  const citMap = new Map<string, number>();
  if (citationIndex2) {
    for (const r of citationIndex2.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — tenant-bound read; reuses
  // tenantId resolved at the top of the page render.
  const repo = getRepository().forTenant(tenantId);
  const pageSnapshots = await repo.getPageSnapshots();
  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    allRows,
    rolloutExecutions,
    persistedPatternEvidence,
  );
  const briefs = generateBriefs(pageSnapshots, citMap, patterns);
  const allRecs = computeRecommendations({ impactRows, patterns, briefs, sectionAnalyzerConfig: getSectionAnalyzerConfig() });

  const trackRecord = computeTrackRecord({ impactRows, patterns });
  const recommendedMatch = wasChangeRecommended(id, trackRecord);

  const replicateRecs = allRecs.filter(
    (r) => r.type === "replicate" && r.sourceChangeId === id,
  );

  const strengthenRec = allRecs.find(
    (r) => r.type === "strengthen" && r.sourceChangeId === id,
  );

  // Sprint 7 Phase 7.5c/3 (2026-04-25) — tenant-scoped page fetch.
  const allPages = await getOwnedPages();
  const urlToPageId = new Map<string, string>();
  for (const p of allPages) {
    urlToPageId.set(p.url.replace(/\/+$/, "").toLowerCase(), p.id);
  }
  function pagesHref(pageUrl: string): string {
    const pageId = urlToPageId.get(pageUrl.replace(/\/+$/, "").toLowerCase());
    if (!pageId) return "/pages";
    return `/pages?p=${pageId}`;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              {entry.asset_name}
            </h2>
            <div className="flex items-center gap-2 mt-1.5 text-[12px] text-muted-foreground flex-wrap">
              <span>{SIGNAL_TYPE_LABELS[entry.signal_type]}</span>
              <span className="text-border">·</span>
              <span>{ASSET_TYPE_LABELS[entry.asset_type]}</span>
              <span className="text-border">·</span>
              <span>
                {new Date(entry.timestamp).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="text-border">·</span>
              <span>{row.daysSinceChange}d ago</span>
            </div>
          </div>
          {/* Legacy verdict badge removed in Phase 2C — the attribution
              drilldown panel below is the source of truth for this change's
              status. */}
        </div>
        {recommendedMatch && (
          <div className="flex items-center gap-2 mt-2 text-[10px]">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent-primary/30 bg-accent-primary/8 text-accent-primary font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
              Beacon recommended
            </span>
            <span className="text-muted-foreground">
              {recommendedMatch.matchConfidence === "likely" ? "Likely" : "Possibly"} fulfilling a recommendation from the {recommendedMatch.patternId.replace("pattern-", "").replace(/-/g, " ")} pattern
            </span>
          </div>
        )}
      </div>

      {/* Phase 2C: attribution drilldown (natural-controls engine output).
          Source of truth for this change's attribution status. Replaces the
          old verdict-led block. */}
      {await (async () => {
        const storedOutcome = await loadChangeOutcomeById(entry.id);
        return storedOutcome ? <AttributionDrilldown outcome={storedOutcome} /> : null;
      })()}

      {/* What changed */}
      <div className="bg-surface-inset rounded-lg px-4 py-3 space-y-2">
        <p className="text-[13px] leading-relaxed">
          {entry.change_description}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          {entry.url && (
            <span className="font-mono">{entry.url}</span>
          )}
          {entry.topic_targeted && (
            <span>Topic: {entry.topic_targeted}</span>
          )}
          {entry.city_targeted && (
            <span>City: {entry.city_targeted}</span>
          )}
        </div>
      </div>

      {/* Hypothesis (editable) */}
      <HypothesisEditor
        changeId={entry.id}
        initialHypothesis={entry.hypothesis}
        initialSource={entry.hypothesis_source ?? null}
      />

      {/* Verdict summary */}
      <div className={`border rounded-lg px-4 py-3 ${row.operatorConfirmedCount > 0 ? "border-status-success/30 bg-status-success/5" : "border-border"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                Outcome summary
              </p>
              {row.topTrust && (
                <span className="inline-flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${TRUST_DOT[row.topTrust]}`} />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {TRUST_LABELS[row.topTrust]}
                  </span>
                </span>
              )}
            </div>
            <p className="text-[13px] font-medium">{row.verdictSummary}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {row.topScore != null && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Best match score</p>
                <p className="text-[16px] font-semibold tabular-nums">
                  {Math.round(row.topScore)}
                </p>
              </div>
            )}
            {row.topConfidence && (
              <div className="text-right max-w-[min(100%,14rem)]">
                <p className="text-[10px] text-muted-foreground mb-0.5">
                  Attribution fit
                </p>
                <div className="flex justify-end">
                  <ConfidenceBadge
                    confidence={row.topConfidence}
                    explanation={buildAttributionConfidenceBasis(row)}
                    className="max-w-full flex-wrap justify-end"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Evidence tier + platforms */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded border ${TIER_COLORS[row.evidenceTier]}`}
          >
            {TIER_LABELS[row.evidenceTier]}
          </span>
          {row.platforms.map((p) => (
            <span
              key={p}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground"
            >
              {PLATFORM_LABELS[p] ?? p}
            </span>
          ))}
        </div>
      </div>

      {/* Impact assessment */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-surface-inset/50 border-b border-border">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Impact assessment
          </p>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Confidence:</span>
              <ImpactConfidenceBadge confidence={impact.confidence} />
              {(changeCoverageState === "stale" ||
                changeCoverageState === "critical" ||
                changeCoverageState === "aging") && (
                <span className="text-[8px] text-status-warning/60">
                  (
                  {changeCoverageState === "critical"
                    ? "no recent data"
                    : changeCoverageState === "aging"
                      ? "data may be outdated"
                      : "stale data"}
                  )
                </span>
              )}
              {changeCoverageState === "partial" && impact.confidence === "high" && <span className="text-[8px] text-status-warning/60">(limited sample)</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Direction:</span>
              <DirectionBadge direction={impact.direction} />
            </div>
          </div>
          {changeCoverageWarning && (
            <p className="text-[10px] text-status-warning/70 mt-1">{changeCoverageWarning}</p>
          )}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Why</p>
            <p className="text-[12px] text-foreground-secondary leading-relaxed">
              {impact.whyExplanation}
            </p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-medium text-muted-foreground mb-1">What to do next</p>
            <p className="text-[13px] font-medium leading-relaxed">
              {impact.nextAction}
            </p>
          </div>
        </div>
      </div>

      {/* Replicate: actionable pages from this validated change */}
      {replicateRecs.length > 0 && (
        <div className="border-2 border-status-success/40 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-status-success/8 border-b border-status-success/20">
            <p className="text-[11px] font-bold text-status-success">
              Similar pattern observed ({replicateRecs.length} page{replicateRecs.length !== 1 ? "s" : ""})
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              This change correlates with positive visibility shifts. These pages share a similar structural gap — worth considering based on observed patterns.
            </p>
          </div>
          <div className="divide-y divide-border">
            {replicateRecs.slice(0, 6).map((rec) => (
              <ReplicateRow key={rec.id} rec={rec} pagesHref={pagesHref} />
            ))}
          </div>
        </div>
      )}

      {/* Strengthen: evidence quality nudge for weak-tier changes */}
      {strengthenRec && (
        <div className="border border-status-warning/40 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-status-warning/8 border-b border-status-warning/20">
            <p className="text-[11px] font-bold text-status-warning">
              Strengthen this entry
            </p>
          </div>
          <div className="px-4 py-3 space-y-2">
            <p className="text-[12px] text-foreground-secondary leading-relaxed">
              {strengthenRec.rationale}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {strengthenRec.sourceEvidence}
            </p>
          </div>
        </div>
      )}

      {/* Expected outcome */}
      {entry.hypothesis && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
            Expected outcome
          </p>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md px-3 py-2">
            {entry.hypothesis}
          </p>
        </div>
      )}

      {/* Attribution chain */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-2">
          Outcome Events ({sortedAttributions.length})
        </p>

        {sortedAttributions.length > 0 ? (
          <div className="space-y-2">
            {sortedAttributions.map((ea, i) => (
              <EventAttributionCard key={i} ea={ea} />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg px-4 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              {row.verdict === "too_early"
                ? `No outcome events detected yet. This change is ${row.daysSinceChange} days old — results may still emerge.`
                : "No outcome events linked to this change."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 1.6 (Sprint 1 follow-up, 2026-04-24) — honest error state.
 *
 * Rendered when the repository fetch fails. Deliberately does NOT fall back
 * to the stale module-level `changelogEntries` array that this page used to
 * read from — the whole point of the fresh-read pattern is that operators
 * never see a detail page that conflicts with /changes. A transient read
 * failure is rare enough that a plain retry message is the right UX.
 * Matches the error shape on /changes main list.
 */
function ChangeDetailReadError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown error reading changelog entry";
  return (
    <div className="max-w-3xl">
      <section
        className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
        aria-labelledby="change-detail-read-error-heading"
      >
        <h2
          id="change-detail-read-error-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Couldn&apos;t load this change
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This usually means the database is temporarily unreachable. Refresh
          the page to retry. We never fall back to cached data here, so you
          won&apos;t see stale truth by accident.
        </p>
        <Link
          href="/changes"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          ← Back to Changes
        </Link>
      </section>
    </div>
  );
}

function EventAttributionCard({ ea }: { ea: EventAttribution }) {
  return (
    <Link
      href={`/settings/history/${ea.event.anchor_result_id}`}
      className={`block border rounded-lg px-4 py-3 hover:bg-surface-inset/50 transition-colors border-l-[3px] ${ROLE_BORDER[ea.role]} ${ea.trustSource === "operator_confirmed" ? "border-status-success/30 bg-status-success/5" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-inset text-muted-foreground">
              {ROLE_LABELS[ea.role]}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${TRUST_DOT[ea.trustSource]}`} />
              <span className="text-[9px] font-medium text-muted-foreground">
                {TRUST_LABELS[ea.trustSource]}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              {EVENT_TYPE_LABELS[ea.event.type] ?? ea.event.type}
            </span>
          </div>
          <p className="text-[13px] font-medium">{ea.event.topic}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {ea.event.description}
          </p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span>{PLATFORM_LABELS[ea.event.platform] ?? ea.event.platform}</span>
            <span>·</span>
            <span>
              {new Date(ea.event.trigger_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span>·</span>
            <span>{ea.event.context.cited ? "Cited" : "Mentioned"}</span>
            <span>·</span>
            <span>
              {ea.event.context.mentions_after}/{ea.event.context.mentions_after + (ea.event.context.mentions_before ?? 0)} prompts
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-[16px] font-semibold tabular-nums">
            {Math.round(ea.score)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {CONF_LABELS[ea.confidence]}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <MatchFactors matches={ea.matches} />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 italic">
        {ea.explanation}
      </p>
    </Link>
  );
}

const IMPACT_CONF_STYLE: Record<ImpactConfidence, { label: string; className: string }> = {
  high: { label: REC_CONFIDENCE_LABEL.high, className: "text-status-success bg-status-success/10 border-status-success/20" },
  medium: { label: REC_CONFIDENCE_LABEL.medium, className: "text-foreground-secondary bg-surface-inset border-border" },
  low: { label: REC_CONFIDENCE_LABEL.low, className: "text-muted-foreground bg-surface-inset border-border" },
};

function ImpactConfidenceBadge({ confidence }: { confidence: ImpactConfidence }) {
  const cfg = IMPACT_CONF_STYLE[confidence];
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const DIRECTION_STYLE: Record<ImpactDirection, { label: string; className: string }> = {
  positive: { label: "Positive", className: "text-status-success" },
  negative: { label: "Decline", className: "text-status-danger" },
  mixed: { label: "Mixed", className: "text-status-warning" },
  none: { label: "No signal", className: "text-muted-foreground" },
};

function DirectionBadge({ direction }: { direction: ImpactDirection }) {
  const cfg = DIRECTION_STYLE[direction];
  return (
    <span className={`text-[11px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function ReplicateRow({
  rec,
  pagesHref,
}: {
  rec: BeaconRecommendation;
  pagesHref: (url: string) => string;
}) {
  const href = rec.targetPageUrl ? pagesHref(rec.targetPageUrl) : "/pages";
  return (
    <Link
      href={href}
      className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-inset/50 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium truncate">
          {rec.headline}
        </p>
        {rec.citationOpportunity > 0 && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {rec.citationOpportunity} existing citations on target page
          </p>
        )}
      </div>
      <span className="text-[10px] font-semibold text-accent-primary shrink-0 mt-0.5">
        Open →
      </span>
    </Link>
  );
}
