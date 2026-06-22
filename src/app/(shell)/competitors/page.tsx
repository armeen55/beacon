import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { EvidenceFreshnessBanner } from "@/components/shell/evidence-freshness-banner";
import { KpiCard } from "@/components/viz/kpi-card";
import { getCompetitors, getResults, hasActiveExperiment } from "@/lib/seed-data.server";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { getPageIssues } from "@/domains/pages/issues";
import { computeMarketBenchmark, prettifyDomain, type MarketBenchmark } from "@/domains/pages/builder-benchmark";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { normalizeCompetitorDomain } from "@/domains/competitors/universe-normalize";
import { CompetitorsManageClient } from "./competitors-manage-client";
import { loadCompetitorMoves } from "@/domains/competitor-intel/load-moves";
import { loadWhyThemReports } from "@/domains/competitor-intel/load-why-them";
import { CoMentionSection } from "./co-mention-section";
import { StealThisMoveSection } from "./steal-this-move-section";
import { WhyThemSection } from "./why-them-section";
import { SourceTrustSection } from "./source-trust-section";
import { LocalPressureSection } from "./local-pressure-section";
import { BattlecardSection } from "./battlecard-section";
import { getCachedCoMentionMatrix, computeCoMentionMatrix, persistCoMentionMatrix } from "@/domains/competitors/co-mention";
import { computeSourceTrustIndex } from "@/domains/competitors/source-trust";
import { computeBattlecards } from "@/domains/competitors/battlecards";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { getOwnedPages } from "@/domains/pages/page-store";
import { getActivePrompts } from "@/domains/prompts/prompt-library";
import { getSiteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import {
  sampleQualityTierFromObservationCount,
  sampleQualityTierLabel,
} from "@/lib/sample-quality-tier";
import { deriveCoverageState, coverageWarningLine } from "@/lib/coverage-state";
import { LAYER2_MARKET_METHODOLOGY_BULLETS } from "@/lib/beacon-proof-copy";
import { classifyCompetitorType, COMPETITOR_TYPE_LABELS, COMPETITOR_TYPE_COLORS } from "@/domains/competitors/classify-type";
import { discoverCompetitorUniverse } from "@/domains/competitors/discover";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import {
  computeLocalOperatorSurface,
  loadLocalOperatorImport,
} from "@/domains/local-operator/surface";
import { LocalOperatorPanel } from "@/components/local-operator/local-operator-panel";
import { MarketLocalStrip } from "@/components/local/market-local-strip";
import { getLocalPresenceSnapshot, buildMarketLocalStripModel } from "@/lib/local-presence";
import { computeCitationDecay, getDecayAlerts } from "@/domains/attribution/citation-decay";
import { buildCompetitorRank } from "@/lib/performance-timeseries";
import {
  syncMilestonesFromWorkspace,
  filterMarketMilestones,
} from "@/domains/milestones";
import { latestWebsiteCrawlRun } from "@/domains/observations/read";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";

export default async function CompetitorsPage() {
  // Same signal as Today / Pages / Changes (Phase 2B): no import runs ⇒ sample workspace, not operator Market.
  if (!(await hasActiveExperiment())) {
    return (
      <div className="max-w-4xl">
        <PageHeader
          title="Market"
          description="Who beats you, where they beat you, and exactly what to do about it."
        />
        <section
          className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
          aria-labelledby="market-import-empty-heading"
        >
          <h2
            id="market-import-empty-heading"
            className="text-[13px] font-semibold text-foreground tracking-tight"
          >
            Connect your data sources to see your real Market view
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Rankings, co-mentions, battlecards, and local pressure are built from your data and configured
            competitor universe. Connect Google Search Console (plus GA4, SEMrush, or Clarity) and
            refresh to see your business. Until then, this route shows sample market data for orientation
            only — not your business.
          </p>
          <Link
            href="/settings/connectors"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Connect data sources →
          </Link>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Or{" "}
            <Link
              href="/settings/import"
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              import a CSV
            </Link>{" "}
            instead.
          </p>
        </section>
      </div>
    );
  }

  const universe = await loadCompetitorUniverseRuntime();
  const activeUniverse = universe.entries.filter((e) => e.status === "active");
  const citIndex = await getCitationEvidenceIndex();
  const answerIntelligenceIndex = await getAnswerIntelligenceIndex();
  const [competitors, results] = await Promise.all([getCompetitors(), getResults()]);
  void results; // some downstream JSX may use this; keep available

  const { siteDomain } = getSiteConfig();
  const universeDomains = new Set(activeUniverse.map((e) => e.domain.replace(/^www\./, "").toLowerCase()));
  let coMentionMatrix = await getCachedCoMentionMatrix();
  if (!coMentionMatrix) {
    coMentionMatrix = await computeCoMentionMatrix(siteDomain, universeDomains);
    if (coMentionMatrix.entries.length > 0) {
      persistCoMentionMatrix(coMentionMatrix).catch(() => {});
    }
  }

  const trustIndex = await computeSourceTrustIndex(siteDomain, universeDomains);

  // Sprint 7 Phase 7.5c/3 (2026-04-25) — tenant-scoped page fetch.
  const allPages = await getOwnedPages();
  const geoCoverage = computeGeoCoverage(
    allPages,
    citIndex?.by_page_and_topic ?? [],
    await getActivePrompts(),
  );
  const competitorPressureCities = geoCoverage.cities
    .filter((c) => c.competitor_pages >= 5 && (c.coverage_status === "absent" || c.coverage_status === "weak"))
    .slice(0, 5);

  const compNames = new Map<string, string>();
  for (const e of activeUniverse) {
    compNames.set(e.domain.replace(/^www\./, "").toLowerCase(), e.display_name);
  }
  for (const c of competitors) {
    const d = c.domain.replace(/^www\./, "").toLowerCase();
    if (!compNames.has(d)) compNames.set(d, c.name);
  }

  const battlecardIndex = citIndex
    ? computeBattlecards({
        citationIndex: citIndex,
        coMentionMatrix: coMentionMatrix,
        trustIndex,
        geoCoverage,
        ownedDomain: siteDomain,
        competitorNames: compNames,
      })
    : null;

  // §competitor-intel (2026-06-09) — both loaders soft-fail to [] so
  // the sections render nothing rather than break this page.
  // Multi-property (2026-06-10): local-service sections segment-gated.
  const { getCurrentTenantFeatures } = await import(
    "@/domains/tenants/tenant-features"
  );
  const [competitorMoves, whyThemReports, tenantFeatures] = await Promise.all([
    loadCompetitorMoves(),
    loadWhyThemReports(),
    getCurrentTenantFeatures(),
  ]);

  // MT-2/MT-3B (2026-05-22) — tenant-aware config resolved once here
  // (no tenantId in scope on this page); threaded into competitor
  // classification + the local-operator surface below.
  const businessConfig = await getBusinessConfigForCurrentTenant();

  const benchmark: MarketBenchmark | null = citIndex
    ? computeMarketBenchmark(citIndex, await getPageIssues(), {
        competitorNames: universe.domainToLabel,
        directoryDomains: businessConfig.directoryDomains,
      })
    : null;
  const discovery = discoverCompetitorUniverse({
    citationIndex: citIndex,
    coMentionMatrix,
    sourceTrustIndex: trustIndex,
    ownedDomain: siteDomain,
    universeDomains,
    directoryDomains: businessConfig.directoryDomains,
  });

  const decayForLocal = getDecayAlerts(computeCitationDecay(siteDomain));
  const topGeoGap = geoCoverage.gaps[0] ?? null;
  const localMarketSurface = computeLocalOperatorSurface({
    business: businessConfig,
    importRow: await loadLocalOperatorImport(),
    geoGap: topGeoGap
      ? {
          city: topGeoGap.city,
          competitor_pages: topGeoGap.competitor_pages,
          owned_pages: topGeoGap.owned_pages,
        }
      : null,
    meaningfulDecayCount: decayForLocal.filter((d) => d.status === "meaningful_decline")
      .length,
  });

  const aheadCount =
    benchmark?.topCompetitors.filter((c) => c.mentions > benchmark.ownedAIMentions).length ?? 0;

  const lastCrawl = await latestWebsiteCrawlRun();
  const marketCrawlAgeDays = lastCrawl?.completed_at
    ? Math.floor(
        (Date.now() - new Date(lastCrawl.completed_at).getTime()) / 86_400_000,
      )
    : null;
  const marketCoverageState = deriveCoverageState({
    crawlAgeDays: marketCrawlAgeDays,
    visibilityStaleVsCrawl: false,
    sampleQualityTier: benchmark
      ? sampleQualityTierFromObservationCount(benchmark.trackedCitationObservations)
      : "limited",
  });
  const marketCoverageWarning = coverageWarningLine(marketCoverageState);

  const hasTopicReadout =
    benchmark &&
    (benchmark.strongestAreas.length > 0 ||
      benchmark.biggestLosses.length > 0 ||
      benchmark.weakestAreas.length > 0);

  const competitorRankForMilestones = buildCompetitorRank(
    citIndex,
    siteDomain,
    (domain) => classifyCompetitorType(domain, businessConfig.directoryDomains),
  );
  const { state: milestoneStateMarket } = await syncMilestonesFromWorkspace({
    results,
    citationIndex: citIndex,
    siteDomain,
    competitorRank: competitorRankForMilestones,
  });
  const marketMilestones = filterMarketMilestones(milestoneStateMarket.events);

  const marketLocalStripModel = buildMarketLocalStripModel(await getLocalPresenceSnapshot());

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Market"
        description="Who beats you, where they beat you, and exactly what to do about it."
      />

      {/* #336 — primary, one-click affordance to add a competitor. Anchors
          to the manage section below so the owner never has to hunt through
          the collapsed "data setup" area to start tracking a rival. */}
      <div className="mb-6 flex justify-end">
        <Link
          href="#manage-competitors"
          className="inline-flex items-center gap-1.5 rounded-md border border-accent-primary/40 bg-accent-primary/[0.06] px-3 py-1.5 text-[12px] font-medium text-accent-primary hover:bg-accent-primary/[0.12]"
          data-competitors-track-cta="true"
        >
          <span aria-hidden="true">+</span> Track a competitor
        </Link>
      </div>

      {/* audit-4: gate on local_service like the other local sections (840,
          933). A content tenant (e.g. an encyclopedia) is not a local-service
          business, so "Listing health / NAP / Reviews" is inapplicable local-SEO
          jargon as the page's lead strip. */}
      {tenantFeatures.local_service ? (
        <MarketLocalStrip model={marketLocalStripModel} className="mb-6" />
      ) : null}

      {/* Commit 2 (2026-04-24): evidence-freshness honesty banner. The
          citation_evidence_index feeding rankings below is frozen at the last
          Profound import (no native-poll rebuild yet). Surface the cutoff
          plainly so the operator reads rankings as "known snapshot" vs live.

          audit-4: render ONLY when a real frozen index exists. With no index
          (no AI-citation source connected — e.g. a content tenant without
          Profound), the null-copy promised a "rebuild with the latest
          Perplexity + ChatGPT readings" the tenant can't run. The empty/connect
          state in the benchmark ternary below carries the honest message
          instead. */}
      {citIndex?.built_at ? (
        <EvidenceFreshnessBanner
          builtAt={citIndex.built_at}
          label="Competitor rankings"
          className="mb-6"
        />
      ) : null}

      {benchmark ? (
        <div className="space-y-8">
          {/* At a glance — KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Your Citation Share" value={`${benchmark.ownedAppearanceRate}%`} meta={`of ${benchmark.trackedCitationObservations.toLocaleString()} observations`} />
            <KpiCard label="Your Citations" value={benchmark.ownedAIMentions} meta={`${benchmark.trackedCitationObservations.toLocaleString()} observations tracked`} />
            <KpiCard label="Top competitors by citations" value={benchmark.topCompetitors.length} />
            <KpiCard label="Ahead of You" value={aheadCount} meta={aheadCount > 0 ? `of ${benchmark.topCompetitors.length} top competitors` : "You lead the field"} />
          </div>
          <div className="-mt-5 space-y-0.5">
            <p className="text-[10px] text-muted-foreground/70">
              Directional — based on your tracked prompt sample, not a market census.
              {marketCoverageState === "partial" && (
                <span className="text-status-warning/70"> (limited sample)</span>
              )}
              {" "}
              <a href="/settings/methodology#citation-share" className="text-accent-primary hover:underline">
                How this works →
              </a>
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              {sampleQualityTierLabel(
                sampleQualityTierFromObservationCount(
                  benchmark.trackedCitationObservations,
                ),
              )}
            </p>
            {marketCoverageWarning &&
              (marketCoverageState === "stale" ||
                marketCoverageState === "critical" ||
                marketCoverageState === "aging" ||
                marketCoverageState === "partial") && (
              <p className="text-[10px] text-status-warning/70">
                {marketCoverageWarning}{" "}
                <a
                  href="/settings/methodology#coverage-states"
                  className="text-accent-primary hover:underline font-medium"
                >
                  Coverage states →
                </a>
              </p>
            )}
          </div>

          <details className="text-[11px] text-muted-foreground leading-relaxed">
            <summary className="cursor-pointer font-medium text-foreground/85 hover:underline select-none">
              How this works
            </summary>
            <ul className="mt-2 ml-4 list-disc space-y-1.5 pl-0.5">
              {LAYER2_MARKET_METHODOLOGY_BULLETS.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="mt-2">
              <Link
                href="/settings/methodology#citation-share"
                className="text-accent-primary font-medium hover:underline"
              >
                Full methodology: Citation Share &amp; sample quality →
              </Link>
            </p>
          </details>

          {marketMilestones.length > 0 && (
            <div className="rounded-lg border border-border/50 px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Competitive records
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 mb-2 leading-relaxed">
                Share and lead metrics from the same citation corpus as the table below — logged when a new high is measured.
              </p>
              <ul className="space-y-2">
                {marketMilestones.map((e) => (
                  <li key={e.id} className="text-[11px] border-l-2 border-border/60 pl-3">
                    <span className="font-semibold text-foreground">{e.title}</span>
                    <span className="text-muted-foreground"> — {e.subtitle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ranked threats — list-first */}
          {benchmark.topCompetitors.length > 0 && (
            <section>
              <div className="flex items-end justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Who leads in citations</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Ordered by AI-visible citations across tracked topics — not a full market census.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border/70 overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0 px-3 py-2 bg-surface-inset/50 text-[10px] font-medium text-muted-foreground border-b border-border/60 sm:grid-cols-[2rem_1fr_minmax(0,7rem)_minmax(0,4rem)]">
                  <span className="hidden sm:block">#</span>
                  <span className="sm:hidden"> </span>
                  <span>Competitor</span>
                  <span className="text-right hidden sm:block">Citations</span>
                  <span className="text-right hidden sm:block">Topic share</span>
                </div>
                {benchmark.topCompetitors.map((comp, i) => {
                  const compEntity = competitors.find(
                    (c) => normalizeCompetitorDomain(c.domain) === normalizeCompetitorDomain(comp.domain)
                  );
                  const isAhead = comp.mentions > benchmark.ownedAIMentions;
                  return (
                    <div
                      key={comp.domain}
                      className={cn(
                        "grid grid-cols-1 gap-1 px-3 py-2.5 border-b border-border/50 last:border-b-0 sm:grid-cols-[2rem_1fr_minmax(0,7rem)_minmax(0,4rem)] sm:items-center sm:gap-x-3",
                        isAhead ? "bg-status-danger/[0.04]" : "hover:bg-surface-inset/30",
                      )}
                    >
                      <span className="text-[11px] text-muted-foreground tabular-nums sm:pt-0">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {compEntity ? (
                            <Link
                              href={`/competitors/${compEntity.id}`}
                              className="text-[13px] font-semibold text-foreground hover:text-accent-primary transition-colors truncate"
                            >
                              {comp.name}
                            </Link>
                          ) : (
                            <span className="text-[13px] font-semibold truncate">{comp.name}</span>
                          )}
                          {isAhead && (
                            <span className="text-[10px] font-medium text-status-danger shrink-0">Ahead of you</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{comp.domain}</p>
                          {(() => {
                            const cType = classifyCompetitorType(comp.domain, businessConfig.directoryDomains);
                            return (
                              <span className={cn("text-[9px] font-medium rounded border px-1 py-0.5 leading-none shrink-0", COMPETITOR_TYPE_COLORS[cType])}>
                                {COMPETITOR_TYPE_LABELS[cType]}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="h-1 rounded-full bg-border/30 mt-1.5 overflow-hidden hidden sm:block">
                          <div
                            className={cn("h-full rounded-full transition-all", isAhead ? "bg-status-danger/60" : "bg-accent-primary/60")}
                            style={{ width: `${Math.min(comp.rate, 100)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground sm:hidden tabular-nums">
                          <span>{comp.mentions.toLocaleString()} cit.</span>
                          <span>{comp.rate}% share</span>
                        </div>
                      </div>
                      <span className="text-right text-[13px] font-semibold tabular-nums hidden sm:block">
                        {comp.mentions.toLocaleString()}
                      </span>
                      <span className="text-right text-[12px] font-medium tabular-nums text-muted-foreground hidden sm:block">
                        {comp.rate}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Next moves — elevated, calmer list */}
          {benchmark.topNextMoves.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-foreground mb-1">Next moves</h2>
              <p className="text-[11px] text-muted-foreground mb-3">Shortest paths from this snapshot — same links, less chrome.</p>
              <ul className="rounded-lg border border-border/60 divide-y divide-border/50 overflow-hidden">
                {benchmark.topNextMoves.map((m, i) => (
                  <li key={i}>
                    <Link
                      href={m.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium hover:bg-surface-inset/40 transition-colors"
                    >
                      <span className="min-w-0">{m.label}</span>
                      <span className="text-xs text-accent-primary shrink-0 font-medium">Open</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Topic signals — one frame, three beats */}
          {hasTopicReadout && (
            <section className="rounded-lg border border-border/70 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 bg-surface-inset/25">
                <h2 className="text-sm font-semibold text-foreground">Topic signals</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Three lenses on the same topic model — not three separate stories.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x lg:divide-border/60 divide-y divide-border/60 lg:divide-y-0">
                {benchmark.strongestAreas.length > 0 && (
                  <div className="p-4 lg:min-h-[140px]">
                    <p className="text-[10px] font-medium text-status-success mb-3">Where you lead</p>
                    <ul className="space-y-3">
                      {benchmark.strongestAreas.map((a) => (
                        <li key={a.topic}>
                          <p className="text-[12px] font-medium leading-snug">{a.topic}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 rounded-full bg-status-success/15 flex-1 min-w-0">
                              <div
                                className="h-1 rounded-full bg-status-success"
                                style={{ width: `${Math.min(a.rate, 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums text-status-success shrink-0">
                              {a.rate}%
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {benchmark.biggestLosses.length > 0 && (
                  <div className="p-4 lg:min-h-[140px]">
                    <p className="text-[10px] font-medium text-status-danger mb-3">Highest pressure</p>
                    <ul className="space-y-3">
                      {benchmark.biggestLosses.map((l) => (
                        <li key={l.topic}>
                          <p className="text-[12px] font-medium leading-snug">{l.topic}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 rounded-full bg-status-danger/15 flex-1 min-w-0">
                              <div
                                className="h-1 rounded-full bg-status-danger"
                                style={{ width: `${Math.min(l.competitorRate, 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums text-status-danger shrink-0">
                              {l.competitorRate}%
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">you {l.ownedRate}%</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {benchmark.weakestAreas.length > 0 && (
                  <div className="p-4 lg:min-h-[140px]">
                    <p className="text-[10px] font-medium text-status-warning mb-3">Thinnest share</p>
                    <ul className="space-y-3">
                      {benchmark.weakestAreas.map((a) => (
                        <li key={a.topic}>
                          <p className="text-[12px] font-medium leading-snug">{a.topic}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 rounded-full bg-status-warning/15 flex-1 min-w-0">
                              <div
                                className="h-1 rounded-full bg-status-warning"
                                style={{ width: `${Math.min(a.rate, 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums text-status-warning shrink-0">
                              {a.rate}%
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}
          {/* Answer intelligence — who replaces you in AI answers */}
          {(() => {
            if (!answerIntelligenceIndex) return null;
            // Gate: only show when we have meaningful competitor data
            // Require ≥ 50 total appearances to avoid noise from thin samples
            const qualifiedCompetitors = answerIntelligenceIndex.co_citation.competitors
              .filter((c) => c.total_answer_appearances >= 50 && c.displacement_ratio >= 0.3)
              .sort((a, b) => b.when_owned_absent - a.when_owned_absent)
              .slice(0, 6);
            if (qualifiedCompetitors.length === 0) return null;

            // Gate: need enough answer data to be meaningful
            const totalAnswers = answerIntelligenceIndex.co_citation.total_answers_with_owned +
              answerIntelligenceIndex.co_citation.total_answers_without_owned;
            if (totalAnswers < 100) return null;

            return (
              <section>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Who replaces you</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Competitors who appear in AI answers where you{"'"}re absent.
                    Sorted by how often they show up without you.
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 bg-surface-inset/50 text-[10px] font-medium text-muted-foreground border-b border-border/60">
                    <span>Competitor</span>
                    <span className="text-right">Answers with you</span>
                    <span className="text-right">Answers without you</span>
                  </div>
                  {qualifiedCompetitors.map((comp) => {
                    const absentHeavy = comp.when_owned_absent > comp.when_owned_present * 3;
                    // #293 — show the friendly competitor name (from the
                    // configured universe's domainToLabel) where available,
                    // falling back to a prettified domain. The raw domain
                    // stays as a small subtitle for verification.
                    const normalizedDomain = normalizeCompetitorDomain(comp.domain);
                    const friendlyName =
                      universe.domainToLabel[normalizedDomain] ??
                      universe.domainToLabel[comp.domain] ??
                      prettifyDomain(comp.domain);
                    const showDomainSubtitle =
                      friendlyName.toLowerCase() !== comp.domain.toLowerCase();
                    return (
                      <div
                        key={comp.domain}
                        className={cn(
                          "grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2.5 border-b border-border/50 last:border-b-0 items-center",
                          absentHeavy ? "bg-status-danger/[0.04]" : "hover:bg-surface-inset/30",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate">{friendlyName}</p>
                          {showDomainSubtitle && (
                            <p className="text-[10px] text-muted-foreground/70 truncate">
                              {comp.domain}
                            </p>
                          )}
                        </div>
                        <span className="text-right text-[12px] tabular-nums font-medium">
                          {comp.when_owned_present.toLocaleString()}
                        </span>
                        <span className={cn(
                          "text-right text-[12px] tabular-nums font-medium",
                          absentHeavy ? "text-status-danger" : "text-foreground",
                        )}>
                          {comp.when_owned_absent.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-1">
                  From {totalAnswers.toLocaleString()} AI answer observations.
                  Directories and platforms are excluded.
                </p>
                {/* Per-topic: where are you absent? */}
                {(() => {
                  const topicGaps = answerIntelligenceIndex.co_citation.by_topic
                    .filter((t) => t.answers_without_owned >= 20 && t.top_when_absent.length > 0)
                    .sort((a, b) => {
                      const aRatio = a.answers_without_owned / (a.answers_with_owned + a.answers_without_owned);
                      const bRatio = b.answers_without_owned / (b.answers_with_owned + b.answers_without_owned);
                      return bRatio - aRatio;
                    })
                    .slice(0, 5);
                  if (topicGaps.length === 0) return null;
                  return (
                    <details className="mt-3 text-[11px]">
                      <summary className="cursor-pointer font-medium text-foreground/85 hover:underline select-none px-1">
                        By topic — where you{"'"}re absent most
                      </summary>
                      <div className="mt-2 rounded-lg border border-border/50 overflow-hidden">
                        {topicGaps.map((topic) => {
                          const total = topic.answers_with_owned + topic.answers_without_owned;
                          const absentPct = total > 0 ? Math.round((topic.answers_without_owned / total) * 100) : 0;
                          return (
                            <div key={topic.topic} className="px-3 py-2.5 border-b border-border/50 last:border-b-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[12px] font-medium text-foreground">{topic.topic}</p>
                                <span className="text-[10px] tabular-nums text-muted-foreground">
                                  absent in {absentPct}% of answers
                                </span>
                              </div>
                              {topic.top_when_absent.length > 0 && (
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  Who fills the gap:{" "}
                                  <span className="text-foreground font-medium">
                                    {topic.top_when_absent
                                      .slice(0, 3)
                                      .map(
                                        (c) =>
                                          universe.domainToLabel[
                                            normalizeCompetitorDomain(c.domain)
                                          ] ??
                                          universe.domainToLabel[c.domain] ??
                                          prettifyDomain(c.domain),
                                      )
                                      .join(", ")}
                                  </span>
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
              </section>
            );
          })()}

          {/* Discovered domains — broader competitive universe */}
          {discovery.newDiscoveries.length > 0 && (
            <section>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">Discovered competitors</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Domains appearing in AI citations that are not in your configured universe.
                  {discovery.totalDomainsAnalyzed > 0 && (
                    <span className="ml-1">{discovery.totalDomainsAnalyzed} total domains analyzed.</span>
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 overflow-hidden">
                <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-x-3 px-3 py-2 bg-surface-inset/50 text-[10px] font-medium text-muted-foreground border-b border-border/60">
                  <span>#</span>
                  <span>Domain</span>
                  <span className="text-right">Citations</span>
                  <span className="text-right">Domain share</span>
                </div>
                {discovery.newDiscoveries.slice(0, 10).map((d, i) => {
                  const topicsTheyLead = d.topicThreats.filter((t) => t.theyLead);
                  return (
                    <div
                      key={d.domain}
                      className="px-3 py-3 border-b border-border/50 last:border-b-0 hover:bg-surface-inset/30"
                    >
                      <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-x-3 items-center">
                        <span className="text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-medium truncate">{d.domain}</span>
                            <span className={cn("text-[9px] font-medium rounded border px-1 py-0.5 leading-none shrink-0", COMPETITOR_TYPE_COLORS[d.type])}>
                              {COMPETITOR_TYPE_LABELS[d.type]}
                            </span>
                            {d.citationDelta > 0 && (
                              <span className="text-[9px] font-semibold text-status-danger shrink-0">
                                +{d.citationDelta.toLocaleString()} more than you
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-right text-[12px] font-semibold tabular-nums">
                          {d.citations.toLocaleString()}
                        </span>
                        <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                          {d.share}%
                        </span>
                      </div>
                      {/* Actionable intel */}
                      <div className="ml-8 mt-2 space-y-1.5">
                        {topicsTheyLead.length > 0 && (
                          <p className="text-[10px] text-status-danger/80">
                            They beat you in {topicsTheyLead.length} topic{topicsTheyLead.length !== 1 ? "s" : ""}:{" "}
                            <span className="text-foreground font-medium">
                              {topicsTheyLead.slice(0, 3).map((t) => t.topic).join(", ")}
                            </span>
                          </p>
                        )}
                        {d.topicThreats.filter((t) => !t.theyLead).length > 0 && (
                          <p className="text-[10px] text-status-success/80">
                            You lead in {d.topicThreats.filter((t) => !t.theyLead).length} topic{d.topicThreats.filter((t) => !t.theyLead).length !== 1 ? "s" : ""} where they also appear
                          </p>
                        )}
                        {d.suggestedMove && (
                          <p className="text-[10px] font-medium text-accent-primary">
                            → {d.suggestedMove}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-[8px] text-muted-foreground/40 font-medium uppercase tracking-wider">
                          {d.discoveredVia.map((v) => (
                            <span key={v}>{v.replace("_", " ")}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {discovery.newDiscoveries.length > 10 && (
                <p className="text-[10px] text-muted-foreground mt-2 px-1">
                  + {discovery.newDiscoveries.length - 10} more discovered domains
                </p>
              )}
            </section>
          )}

          {/* Growth opportunities — directive attack cards */}
          {benchmark.biggestLosses.length > 0 && (
            <section id="opportunities">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">Growth opportunities</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Topics where competitors lead. Build or strengthen content here to close the gap.
                </p>
              </div>
              <div className="space-y-2">
                {[...benchmark.biggestLosses, ...benchmark.weakestAreas.filter((w) => !benchmark.biggestLosses.some((l) => l.topic === w.topic))].slice(0, 6).map((area, i) => {
                  const loss = benchmark.biggestLosses.find((l) => l.topic === area.topic);
                  const yourRate = loss ? loss.ownedRate : (area as { rate: number }).rate;
                  const theirRate = loss ? loss.competitorRate : 0;
                  const delta = theirRate - yourRate;
                  return (
                    <div key={area.topic} className="rounded-lg border border-border/50 px-4 py-3 hover:bg-surface-inset/20 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-foreground truncate">{area.topic}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {delta > 0
                              ? `Competitors lead by ${delta}% share — strengthen your content here`
                              : `Your share is ${yourRate}% — create dedicated content to grow`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {theirRate > 0 && (
                            <span className="text-[10px] text-status-danger font-semibold tabular-nums">{theirRate}% them</span>
                          )}
                          <span className="text-[10px] text-muted-foreground font-semibold tabular-nums">{yourRate}% you</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/30 mt-2 overflow-hidden flex">
                        <div className="h-full rounded-l-full bg-accent-primary/60" style={{ width: `${yourRate}%` }} />
                        {theirRate > 0 && (
                          <div className="h-full bg-status-danger/40" style={{ width: `${theirRate}%` }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Domain type breakdown */}
          {discovery.all.length > 5 && (
            <section className="rounded-lg border border-border/50 px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Domain universe breakdown</p>
              <div className="flex items-center gap-4 text-[11px]">
                <span><span className="font-semibold text-foreground">{discovery.direct.length}</span> direct</span>
                <span className="text-border">·</span>
                <span><span className="font-semibold text-foreground">{discovery.directories.length}</span> directories</span>
                <span className="text-border">·</span>
                <span><span className="font-semibold text-foreground">{discovery.editorial.length}</span> editorial</span>
                <span className="text-border">·</span>
                <span><span className="font-semibold text-foreground">{discovery.forums.length}</span> forums</span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">{discovery.totalDomainsAnalyzed} total</span>
              </div>
            </section>
          )}

          {competitorMoves.length > 0 && (
            <StealThisMoveSection moves={competitorMoves} />
          )}
          {coMentionMatrix && coMentionMatrix.entries.length > 0 && (
            <CoMentionSection matrix={coMentionMatrix} />
          )}
          {trustIndex.platforms.length > 0 && (
            <SourceTrustSection index={trustIndex} />
          )}
          {tenantFeatures.local_service && competitorPressureCities.length > 0 && (
            <LocalPressureSection cities={competitorPressureCities} />
          )}
          {battlecardIndex && battlecardIndex.cards.length > 0 && (
            <BattlecardSection index={battlecardIndex} />
          )}
          {whyThemReports.length > 0 && (
            <WhyThemSection reports={whyThemReports} />
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-status-warning/25 bg-status-warning/[0.06] px-4 py-4">
          <p className="text-[13px] text-foreground font-medium mb-1">No citation evidence yet</p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Competitive ranking needs citation evidence. Run a poll or import a historical citation CSV to populate this view.
          </p>
          <Link
            href="/settings/import"
            className="text-[12px] text-accent-primary hover:underline font-medium mt-2 inline-block"
          >
            Go to Import
          </Link>
        </div>
      )}

      <div className="border-t border-border/50 pt-6 mt-10" id="manage-competitors">
        {/* #336 — make "Track a competitor" discoverable. The add/edit
            form used to be buried inside this collapsed "data setup"
            section; now it opens by default whenever no competitors are
            configured (the case that most needs the form), and the
            summary names the action plainly. */}
        <details className="group/universe" open={activeUniverse.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/universe:rotate-90">▶</span>
            Track a competitor &amp; manage your universe
          </summary>
          <div className="mt-5 space-y-6">
            <div className="rounded-md border border-border/60 bg-surface-raised/25 px-4 py-3 text-[11px] text-muted-foreground space-y-2">
              <p>
                <span className="font-medium text-foreground">Configured universe: </span>
                {universe.origin === "empty_import_mode" && activeUniverse.length === 0
                  ? "None — add competitors below or edit `.data/competitor-universe.json`."
                  : universe.origin === "demo_defaults_explicit"
                    ? `${activeUniverse.length} active (demo defaults).`
                    : `${activeUniverse.length} active from workspace file.`}
              </p>
              {activeUniverse.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {activeUniverse.map((e) => (
                    <li key={e.id}>
                      <span className="text-foreground font-medium">{e.display_name}</span>
                      <span className="font-mono text-[10px] ml-1">({e.domain})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <CompetitorsManageClient
              initialEntries={universe.entries.map((e) => ({ ...e }))}
              universeVersion={universe.pin.universe_version}
              universeFingerprint={universe.pin.universe_fingerprint}
            />

            {competitors.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-foreground mb-2">Imported entities vs universe</h3>
                <div className="rounded-lg border border-border/60 divide-y divide-border/50 overflow-hidden">
                  {competitors.map((comp) => {
                    const dom = normalizeCompetitorDomain(comp.domain);
                    const inUniverse = !!universe.domainToLabel[dom];
                    return (
                      <div
                        key={comp.id}
                        className="px-3 py-2 text-[11px] flex items-center justify-between gap-3 hover:bg-surface-inset/25"
                      >
                        <div className="min-w-0">
                          <span className="font-medium">{comp.name}</span>
                          <span className="text-muted-foreground font-mono ml-2 text-[10px]">{comp.domain}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {inUniverse ? "In universe" : "Outside universe"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </details>
      </div>

      {tenantFeatures.local_service && (
        <div className="mt-10 border-t border-border/50 pt-8">
          <LocalOperatorPanel surface={localMarketSurface} variant="market" />
        </div>
      )}
    </div>
  );
}
