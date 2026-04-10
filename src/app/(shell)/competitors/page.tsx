import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { competitors } from "@/lib/seed-data.server";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { pageIssues } from "@/domains/pages/issues";
import { computeMarketBenchmark, type MarketBenchmark } from "@/domains/pages/builder-benchmark";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { normalizeCompetitorDomain } from "@/domains/competitors/universe-normalize";
import { CompetitorsManageClient } from "./competitors-manage-client";
import { cn } from "@/lib/utils";

export default function CompetitorsPage() {
  const universe = loadCompetitorUniverseRuntime();
  const activeUniverse = universe.entries.filter((e) => e.status === "active");
  const citIndex = citationEvidenceIndex;

  const benchmark: MarketBenchmark | null = citIndex
    ? computeMarketBenchmark(citIndex, pageIssues)
    : null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Competitors"
        description=""
      />

      {benchmark ? (
        <div className="space-y-5">
          {/* ── Summary strip ── */}
          <div className="rounded-lg border border-border bg-surface-raised/40 p-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold tabular-nums">{benchmark.ownedAppearanceRate}%</span>
                <span className="text-[12px] text-muted-foreground">your AI share</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold tabular-nums">{benchmark.ownedAIMentions.toLocaleString()}</span>
                <span className="text-[11px] text-muted-foreground">your citations</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold tabular-nums">{benchmark.topCompetitors.length}</span>
                <span className="text-[11px] text-muted-foreground">tracked competitors</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-2">
              Based on {benchmark.trackedCitationObservations.toLocaleString()} citation observations
            </p>
          </div>

          {/* ── Top competitors ── */}
          {benchmark.topCompetitors.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-2">
                Top competitors by AI citations
              </p>
              <div className="space-y-1.5">
                {benchmark.topCompetitors.map((comp, i) => {
                  const compEntity = competitors.find(
                    (c) => normalizeCompetitorDomain(c.domain) === normalizeCompetitorDomain(comp.domain)
                  );
                  const isAhead = comp.mentions > benchmark.ownedAIMentions;
                  return (
                    <div key={comp.domain} className={cn(
                      "rounded-lg border px-4 py-3",
                      isAhead ? "border-status-danger/20 bg-status-danger/[0.03]" : "border-border",
                    )}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-muted-foreground w-5">#{i + 1}</span>
                            {compEntity ? (
                              <Link href={`/competitors/${compEntity.id}`} className="text-[13px] font-semibold hover:text-accent-primary transition-colors">
                                {comp.name}
                              </Link>
                            ) : (
                              <span className="text-[13px] font-semibold">{comp.name}</span>
                            )}
                            {isAhead && (
                              <span className="text-[9px] font-bold uppercase text-status-danger bg-status-danger/10 px-1.5 py-0.5 rounded">
                                Ahead of you
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5 ml-7">{comp.domain}</p>
                        </div>
                        <div className="flex items-baseline gap-3 shrink-0">
                          <div className="text-right">
                            <span className="text-[16px] font-bold tabular-nums">{comp.mentions.toLocaleString()}</span>
                            <span className="text-[10px] text-muted-foreground ml-1">citations</span>
                          </div>
                          <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{comp.rate}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-2">
                Your position: {benchmark.ownedAIMentions.toLocaleString()} citations ({benchmark.ownedAppearanceRate}% share)
              </p>
            </div>
          )}

          {/* ── Competitive gaps ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {benchmark.strongestAreas.length > 0 && (
              <div className="rounded-lg border border-status-success/20 bg-status-success/[0.03] p-4">
                <p className="text-[10px] font-semibold text-status-success mb-2">
                  Where you are strongest
                </p>
                <div className="space-y-2">
                  {benchmark.strongestAreas.map((a) => (
                    <div key={a.topic}>
                      <p className="text-[12px] font-medium">{a.topic}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="h-1.5 rounded-full bg-status-success/20 flex-1">
                          <div className="h-1.5 rounded-full bg-status-success" style={{ width: `${Math.min(a.rate, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold tabular-nums text-status-success">{a.rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {benchmark.biggestLosses.length > 0 && (
              <div className="rounded-lg border border-status-danger/20 bg-status-danger/[0.03] p-4">
                <p className="text-[10px] font-semibold text-status-danger mb-2">
                  Biggest competitive gaps
                </p>
                <div className="space-y-2">
                  {benchmark.biggestLosses.map((l) => (
                    <div key={l.topic}>
                      <p className="text-[12px] font-medium">{l.topic}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="h-1.5 rounded-full bg-status-danger/20 flex-1">
                          <div className="h-1.5 rounded-full bg-status-danger" style={{ width: `${Math.min(l.competitorRate, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold tabular-nums text-status-danger">{l.competitorRate}%</span>
                        <span className="text-[10px] text-muted-foreground">vs your {l.ownedRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Weakest areas ── */}
          {benchmark.weakestAreas.length > 0 && (
            <div className="rounded-lg border border-status-warning/20 bg-status-warning/[0.03] p-4">
              <p className="text-[10px] font-semibold text-status-warning mb-2">
                Where you are weakest
              </p>
              <div className="space-y-1.5">
                {benchmark.weakestAreas.map((a) => (
                  <div key={a.topic} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium">{a.topic}</span>
                    <span className="text-[11px] text-status-warning font-semibold tabular-nums">{a.rate}% share</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Next moves ── */}
          {benchmark.topNextMoves.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-2">
                What to do
              </p>
              <div className="space-y-1.5">
                {benchmark.topNextMoves.map((m, i) => (
                  <Link key={i} href={m.href} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5 hover:bg-surface-inset/50 transition-colors">
                    <span className="text-[12px] font-medium flex-1">{m.label}</span>
                    <span className="text-[11px] text-accent-primary font-medium">Go →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-status-warning/20 bg-status-warning/5 px-4 py-3 mb-4">
          <p className="text-[12px] text-status-warning font-medium mb-0.5">No citation data</p>
          <p className="text-[11px] text-muted-foreground">
            Competitive intelligence requires citation evidence. Import Profound data to see who is beating you.
          </p>
          <Link href="/import" className="text-[11px] text-accent-primary hover:underline font-medium mt-1 inline-block">
            Import data →
          </Link>
        </div>
      )}

      {/* ── Settings (collapsed) ── */}
      <div className="border-t border-border pt-4 mt-6">
        <details>
          <summary className="text-[10px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            Competitor settings
          </summary>
          <div className="mt-4 space-y-6">
            <div className="rounded-md border border-border bg-surface-raised/30 px-4 py-3 text-[11px] text-muted-foreground space-y-2">
              <p>
                <span className="font-semibold text-foreground">Configured universe: </span>
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
                <h3 className="text-[12px] font-semibold text-foreground mb-2">Imported competitor entities</h3>
                <div className="space-y-1.5">
                  {competitors.map((comp) => {
                    const dom = normalizeCompetitorDomain(comp.domain);
                    const inUniverse = !!universe.domainToLabel[dom];
                    return (
                      <div key={comp.id} className="rounded-md border border-border px-4 py-2 text-[11px] flex items-center justify-between gap-3">
                        <div>
                          <span className="font-medium">{comp.name}</span>
                          <span className="text-muted-foreground font-mono ml-2">{comp.domain}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {inUniverse ? "In universe" : "Not in universe"}
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
