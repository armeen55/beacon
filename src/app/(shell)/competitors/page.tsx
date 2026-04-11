import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { KpiCard } from "@/components/viz/kpi-card";
import { competitors } from "@/lib/seed-data.server";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { pageIssues } from "@/domains/pages/issues";
import { computeMarketBenchmark, type MarketBenchmark } from "@/domains/pages/builder-benchmark";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { normalizeCompetitorDomain } from "@/domains/competitors/universe-normalize";
import { CompetitorsManageClient } from "./competitors-manage-client";
import { CoMentionSection } from "./co-mention-section";
import { SourceTrustSection } from "./source-trust-section";
import { LocalPressureSection } from "./local-pressure-section";
import { BattlecardSection } from "./battlecard-section";
import { getCachedCoMentionMatrix, computeCoMentionMatrix, persistCoMentionMatrix } from "@/domains/competitors/co-mention";
import { computeSourceTrustIndex } from "@/domains/competitors/source-trust";
import { computeBattlecards } from "@/domains/competitors/battlecards";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { allPages } from "@/domains/pages/page-store";
import { getActivePrompts } from "@/domains/prompts/prompt-library";
import { getSiteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export default function CompetitorsPage() {
  const universe = loadCompetitorUniverseRuntime();
  const activeUniverse = universe.entries.filter((e) => e.status === "active");
  const citIndex = citationEvidenceIndex;

  const { siteDomain } = getSiteConfig();
  const universeDomains = new Set(activeUniverse.map((e) => e.domain.replace(/^www\./, "").toLowerCase()));
  let coMentionMatrix = getCachedCoMentionMatrix();
  if (!coMentionMatrix) {
    coMentionMatrix = computeCoMentionMatrix(siteDomain, universeDomains);
    if (coMentionMatrix.entries.length > 0) {
      persistCoMentionMatrix(coMentionMatrix).catch(() => {});
    }
  }

  const trustIndex = computeSourceTrustIndex(siteDomain, universeDomains);

  const geoCoverage = computeGeoCoverage(
    allPages,
    citIndex?.by_page_and_topic ?? [],
    getActivePrompts(),
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

  const benchmark: MarketBenchmark | null = citIndex
    ? computeMarketBenchmark(citIndex, pageIssues)
    : null;

  const aheadCount =
    benchmark?.topCompetitors.filter((c) => c.mentions > benchmark.ownedAIMentions).length ?? 0;

  const hasTopicReadout =
    benchmark &&
    (benchmark.strongestAreas.length > 0 ||
      benchmark.biggestLosses.length > 0 ||
      benchmark.weakestAreas.length > 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Competitors"
        description="Threat-ranked citations first, then topic pressure and the shortest path to act."
      />

      {benchmark ? (
        <div className="space-y-8">
          {/* At a glance — KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Your AI Share" value={`${benchmark.ownedAppearanceRate}%`} meta="Across all tracked topics" />
            <KpiCard label="Your Citations" value={benchmark.ownedAIMentions} meta={`${benchmark.trackedCitationObservations.toLocaleString()} observations`} />
            <KpiCard label="Competitors Tracked" value={benchmark.topCompetitors.length} />
            <KpiCard label="Ahead of You" value={aheadCount} meta={aheadCount > 0 ? "On raw citation count" : "You lead the field"} />
          </div>

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
                  <span className="text-right hidden sm:block">Share</span>
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
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{comp.domain}</p>
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
          {coMentionMatrix && coMentionMatrix.entries.length > 0 && (
            <CoMentionSection matrix={coMentionMatrix} />
          )}
          {trustIndex.platforms.length > 0 && (
            <SourceTrustSection index={trustIndex} />
          )}
          {competitorPressureCities.length > 0 && (
            <LocalPressureSection cities={competitorPressureCities} />
          )}
          {battlecardIndex && battlecardIndex.cards.length > 0 && (
            <BattlecardSection index={battlecardIndex} />
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-status-warning/25 bg-status-warning/[0.06] px-4 py-4">
          <p className="text-[13px] text-foreground font-medium mb-1">No citation evidence yet</p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Competitive ranking needs imported citation data. Bring Profound (or equivalent) into Beacon to populate this view.
          </p>
          <Link
            href="/import"
            className="text-[12px] text-accent-primary hover:underline font-medium mt-2 inline-block"
          >
            Go to Import
          </Link>
        </div>
      )}

      <div className="border-t border-border/50 pt-6 mt-10">
        <details className="group/universe">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/universe:rotate-90">▶</span>
            Universe &amp; data setup
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
    </div>
  );
}
