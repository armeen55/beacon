"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import type { ChangeVerdict } from "@/domains/attribution/types";
import type { TrustSource } from "@/domains/attribution/scorecard";
import {
  deriveGapLedgerFields,
  GAP_EVIDENCE_LABELS,
  type GapLedgerCompetitorUniverseContext,
} from "@/domains/product/gap-ledger";

type TopicStatus = "breakthrough" | "building" | "unresolved" | "stalled";
type NextMove = "review_easy_calls" | "review_unresolved" | "double_down" | "inspect_weak" | "push_supporting" | "too_early";

export type TopicEvent = { id: string; type: string; platform: string; triggerDate: string; anchorResultId: string; description: string; isDecided: boolean };
export type TopicChange = { id: string; name: string; verdict: ChangeVerdict; topScore: number | null; topTrust: TrustSource | null; eventsLinked: number; operatorConfirmed: boolean };

export type TopicRow = {
  topic: string; status: TopicStatus; platforms: string[];
  totalEvents: number; decidedEvents: number; autoEvents: number; unresolvedEvents: number; easyCalls: number;
  totalChanges: number; validatedChanges: number; partialChanges: number; operatorConfirmed: number;
  bestChangeName: string | null; bestChangeId: string | null; bestTrust: TrustSource | null;
  recentEventDate: string | null; recentEventType: string | null;
  nextMove: NextMove; nextMoveDetail: string;
  events: TopicEvent[]; changes: TopicChange[];
};

type ClientMissingPage = {
  suggestedTitle: string; pageType: string; targetTopic: string;
  targetCity: string | null; targetService: string | null;
  rationale: string; suggestedComponents: string[];
  suggestedInternalLinksIn: string[]; suggestedInternalLinksOut: string[];
  verificationExpectations: string[];
};

type ClientAttackPackage = {
  id: string; title: string; status: string; moveType: string;
  pagesToRepair: string[]; pagesToCreate: ClientMissingPage[];
  internalLinkTargets: { from: string; to: string; reason: string }[];
  comparisonTargets: string[];
  executionSteps: string[]; verificationPlan: string[];
  rationale: string; priorityScore: number;
  linkedBriefCount: number; linkedWaveCount: number;
  notes: string | null; isPersisted: boolean;
  progress: { repairTotal: number; repairTracked: number; repairShipped: number; repairVerified: number; wavesLinked: number; wavesCompleted: number; missingTotal: number; missingLaunched: number; missingIndexed: number; totalActions: number; completedActions: number; pct: number };
  missingPages: { id: string; title: string; pageType: string; status: string; components: number }[];
};

type ClientFrontier = {
  id: string; frontierKey: string; topic: string; type: string; title: string; status: string;
  ownedShare: number; ownedPages: number; ownedPagesWithFaq: number;
  competitorCitations: number; citationOpportunity: number; structuralOpportunity: number;
  recommendedMove: string; rationale: string; priorityScore: number;
  linkedBriefCount: number; linkedWaveCount: number;
  competitive: {
    ownedShare: number;
    totalExternal: number;
    dominantSourceType: string;
    insight: string;
    responseType: string;
    responseRationale: string;
    coverageGaps: string[];
    topCompetitors: { domain: string; citations: number; sourceType: string; structural: string }[];
    sourcePatterns: { type: string; share: number; count: number; domains: string[] }[];
  } | null;
  assetResponse: {
    recommendedAssetType: string;
    confidenceLabel: string;
    rationale: string;
    ownedEquivalentExists: boolean;
    ownedEquivalentPages: string[];
    missingAssetSignals: string[];
    supportingSourcePatterns: string[];
  } | null;
  attackPackage: ClientAttackPackage;
};

type GapLedgerCtx = {
  websiteCrawlRunId: string | null;
  citationIndexLoaded: boolean;
  visibilityObservationRunId: string | null;
  visibilitySampleStaleVsCrawl: boolean;
  competitorUniverse: GapLedgerCompetitorUniverseContext | null;
};

function gapLedgerFields(f: ClientFrontier | undefined, ctx: GapLedgerCtx) {
  const frontierDomains =
    f?.competitive?.topCompetitors?.map((c) => c.domain) ?? undefined;
  return deriveGapLedgerFields(
    f
      ? {
          frontierType: f.type,
          recommendedMove: f.recommendedMove,
          structuralOpportunity: f.structuralOpportunity,
          pagesToRepairCount: f.attackPackage.pagesToRepair.length,
          pagesToCreateCount: f.attackPackage.pagesToCreate.length,
          ownedEquivalentExists: f.assetResponse?.ownedEquivalentExists ?? false,
        }
      : null,
    {
      websiteCrawlRunId: ctx.websiteCrawlRunId,
      citationIndexLoaded: ctx.citationIndexLoaded,
      visibilityObservationRunId: ctx.visibilityObservationRunId,
      visibilitySampleStaleVsCrawl: ctx.visibilitySampleStaleVsCrawl,
      competitorUniverse: ctx.competitorUniverse,
    },
    frontierDomains
  );
}

const STATUS_DOT: Record<TopicStatus, string> = {
  breakthrough: "bg-muted-foreground",
  building: "bg-muted-foreground",
  unresolved: "bg-status-warning",
  stalled: "bg-muted-foreground/40",
};

const PLATFORM_SHORT: Record<string, string> = { chatgpt: "GPT", google_aio: "AIO", perplexity: "Pplx" };

const SRC_LABELS: Record<string, string> = {
  competitor_service_page: "Service page", competitor_city_page: "City page",
  editorial_roundup: "Editorial", directory: "Directory", review_platform: "Reviews",
  entity_profile: "Entity", guide_article: "Guide", comparison_article: "Comparison",
  forum: "Forum", other: "Other",
};

const ASSET_LABELS: Record<string, string> = {
  city_page: "Create a local page", service_page: "Create a service page",
  comparison_page: "Create comparison content", guide_article: "Create a guide",
  entity_profile_strengthening: "Improve business profiles", directory_profile_strengthening: "Update directory listings",
  roundup_outreach_target: "Get listed in guides", internal_link_support_package: "Improve page connections",
  structural_refresh_existing_page: "Improve existing page content",
};

const CONF_COLORS: Record<string, string> = {
  strong_fit: "text-muted-foreground",
  probable_fit: "text-muted-foreground",
  weak_fit: "text-muted-foreground",
  mixed: "text-muted-foreground",
};

/** Plain labels for package status (keep in sync with `PackageStatus` in frontier-compiler). */
const PLAN_STATUS_LABELS: Record<string, string> = {
  proposed: "Draft",
  compiled: "Ready",
  launched: "Started",
  handed_off: "Handed off",
  in_progress: "In progress",
  partially_verified: "Partly verified",
  completed: "Done",
  dismissed: "Dismissed",
};

const FRONTIER_TYPE_LABELS: Record<string, string> = {
  topic_frontier: "Topic gap",
  city_frontier: "Local gap",
  service_frontier: "Service gap",
  page_gap_frontier: "Missing page",
  competitor_pressure_frontier: "Competitor pressure",
};

const FRONTIER_STATUS_LABELS: Record<string, string> = {
  opportunity: "Open",
  attacking: "In progress",
  watching: "Watching",
  dismissed: "Dismissed",
};

const MOVE_LABELS: Record<string, string> = {
  repair_existing_pages: "Fix existing pages", roll_out_validated_pattern: "Improve pages",
  create_missing_page: "Create a new page", expand_internal_link_cluster: "Connect pages better",
  strengthen_entity_support: "Polish business listings", comparison_content_play: "Add comparison content",
  review_easy_calls: "Quick wins available", review_unresolved: "Needs review",
  double_down: "Keep going", inspect_weak: "Investigate", push_supporting: "Improve page", too_early: "Too early",
};

export function TopicsClient({
  rows,
  ownedBrandShort = "You",
  frontiers = [],
  gapLedgerContext,
  onLaunchPackage, onDismissPackage, onUpdateMissingPage, onRefreshEvidence,
}: {
  rows: TopicRow[];
  ownedBrandShort?: string;
  frontiers?: ClientFrontier[];
  gapLedgerContext: GapLedgerCtx;
  onLaunchPackage?: (frontierKey: string) => Promise<{ success: boolean; handoffText: string }>;
  onDismissPackage?: (packageId: string) => Promise<{ success: boolean }>;
  onUpdateMissingPage?: (planId: string, status: string) => Promise<{ success: boolean }>;
  onRefreshEvidence?: () => Promise<{ success: boolean; topicCount: number }>;
}) {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(rows[0]?.topic ?? null);
  const [pending, startTransition] = useTransition();
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    const idx = rows.findIndex((r) => r.topic === selectedTopic);
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); if (idx < rows.length - 1) setSelectedTopic(rows[idx + 1].topic); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); if (idx > 0) setSelectedTopic(rows[idx - 1].topic); }
  }, [rows, selectedTopic]);

  useEffect(() => { window.addEventListener("keydown", handleKey); return () => window.removeEventListener("keydown", handleKey); }, [handleKey]);

  const selected = rows.find((r) => r.topic === selectedTopic);
  const frontier = frontiers.find((f) => f.topic === selectedTopic);
  const ledger = gapLedgerFields(frontier, gapLedgerContext);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      {/* Left: Queue */}
      <div className="rounded-lg border border-border overflow-hidden bg-background">
        <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
          <p className="text-[11px] font-semibold text-muted-foreground/60">Opportunities ({rows.length})</p>
          {onRefreshEvidence && (
            <button onClick={() => startTransition(async () => { await onRefreshEvidence(); })} disabled={pending} className="text-[8px] text-accent-primary hover:underline font-medium">
              {pending ? "…" : "Refresh"}
            </button>
          )}
        </div>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
          {rows.map((row) => {
            const isSelected = row.topic === selectedTopic;
            const f = frontiers.find((fr) => fr.topic === row.topic);
            const g = gapLedgerFields(f, gapLedgerContext);
            return (
              <button key={row.topic} onClick={() => setSelectedTopic(row.topic)}
                className={cn("w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-b-0",
                  isSelected ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary" : "hover:bg-surface-inset/60 border-l-[3px] border-l-transparent"
                )}>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-[6px] w-[6px] rounded-full shrink-0", STATUS_DOT[row.status])} />
                  <p className="text-[11px] font-semibold truncate">{row.topic}</p>
                </div>
                <div className="flex flex-col gap-0.5 mt-1 ml-[18px] text-[9px] text-left">
                  <span className="inline-flex w-fit items-center rounded border border-border bg-surface-inset px-1.5 py-0.5 font-semibold text-muted-foreground">
                    {GAP_EVIDENCE_LABELS[g.evidenceClass].short}
                  </span>
                  <Link
                    href={g.action.href}
                    onClick={(e) => e.stopPropagation()}
                    className="text-accent-primary hover:underline font-medium w-fit"
                  >
                    {g.action.label}
                  </Link>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Simple recommendation */}
      <div className="rounded-lg border border-border overflow-hidden bg-background">
        {selected ? (
          <div className="overflow-y-auto max-h-[calc(100vh-220px)]">
            <div className="px-6 pt-5 pb-4 border-b border-border/40">
              <h3 className="text-[15px] font-semibold tracking-tight mb-1">{selected.topic}</h3>
              <span className="inline-flex items-center rounded border border-border bg-surface-inset px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                {GAP_EVIDENCE_LABELS[ledger.evidenceClass].short}
              </span>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <p className="text-[12px] font-semibold text-foreground mb-1">Evidence basis</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                  {ledger.evidenceLine}
                </p>
                <p className="text-[10px] font-medium text-foreground mb-2">
                  {ledger.evidenceDimensionsLine}
                </p>
                <ul className="text-[10px] text-muted-foreground/85 space-y-1 mb-3 list-disc pl-4">
                  {ledger.provenanceLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3 mb-3">
                  {ledger.observationRunHref && (
                    <Link
                      href={ledger.observationRunHref}
                      className="text-[10px] text-accent-primary hover:underline font-medium"
                    >
                      Website crawl run →
                    </Link>
                  )}
                  {ledger.visibilityObservationRunHref && (
                    <Link
                      href={ledger.visibilityObservationRunHref}
                      className="text-[10px] text-accent-primary hover:underline font-medium"
                    >
                      Visibility ObservationRun →
                    </Link>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Link
                    href={ledger.action.href}
                    className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[11px] font-semibold text-background hover:opacity-90"
                  >
                    {ledger.action.label}
                    <span className="opacity-60">→</span>
                  </Link>
                  {frontier && !frontier.attackPackage.isPersisted && onLaunchPackage && (
                    <button
                      onClick={() => {
                        setLaunchMsg(null);
                        startTransition(async () => {
                          const r = await onLaunchPackage(frontier.frontierKey);
                          if (r.success && r.handoffText) {
                            try {
                              await navigator.clipboard.writeText(r.handoffText);
                            } catch {}
                            setLaunchMsg("Handoff copied ✓");
                          }
                        });
                      }}
                      disabled={pending}
                      className="px-3 py-2 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:bg-surface-inset"
                    >
                      {pending ? "…" : "Generate action-plan handoff"}
                    </button>
                  )}
                  {frontier?.attackPackage.isPersisted &&
                    frontier.attackPackage.status !== "completed" && (
                      <span className="text-[11px] text-muted-foreground">
                        Plan in progress · {frontier.attackPackage.progress.pct}%
                      </span>
                    )}
                  {frontier?.attackPackage.status === "completed" && (
                    <span className="text-[11px] text-muted-foreground">Plan completed</span>
                  )}
                  {launchMsg && (
                    <span className="text-[10px] text-muted-foreground">{launchMsg}</span>
                  )}
                </div>
                {frontier?.recommendedMove === "create_missing_page" &&
                  (frontier.assetResponse?.ownedEquivalentExists || frontier.ownedPages > 0) && (
                    <p className="text-[10px] text-muted-foreground border border-border rounded-md px-2 py-1.5 bg-surface-inset/60">
                      Planner text may say “new page,” but owned URLs already exist — use Website to fix or retarget before
                      opening a net-new URL.
                    </p>
                  )}
              </div>

              {/* Show details — all expert panels collapsed */}
              <details className="group">
                <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground font-medium">Show details</summary>
                <div className="mt-4 space-y-5">

              {/* Frontier panel */}
              {frontier && (
                <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.02] px-4 py-3 text-[10px]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[8px] font-bold text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">{FRONTIER_TYPE_LABELS[frontier.type] ?? frontier.type.replace(/_/g, " ")}</span>
                    <span className="text-[12px] font-semibold text-foreground flex-1">Rank {frontier.priorityScore}</span>
                    <span className="text-[9px] text-muted-foreground">{FRONTIER_STATUS_LABELS[frontier.status] ?? frontier.status}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <p className="text-[8px] font-semibold text-muted-foreground/60">Owned share</p>
                      <p className={cn("text-[14px] font-bold tabular-nums", frontier.ownedShare < 5 ? "text-status-danger" : "text-foreground")}>{frontier.ownedShare}%</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-semibold text-muted-foreground/60">Competitor</p>
                      <p className="text-[14px] font-bold tabular-nums text-foreground">{(frontier.competitorCitations / 1000).toFixed(1)}k</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-semibold text-muted-foreground/60">Structure gap</p>
                      <p className={cn("text-[14px] font-bold tabular-nums", frontier.structuralOpportunity > 50 ? "text-status-danger" : "text-foreground")}>{frontier.structuralOpportunity}%</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-2 text-[9px] text-muted-foreground">
                    <span>{frontier.ownedPages} pages ({frontier.ownedPagesWithFaq} w/ FAQ)</span>
                    {frontier.linkedBriefCount > 0 && <span className="text-accent-primary">{frontier.linkedBriefCount} brief{frontier.linkedBriefCount !== 1 ? "s" : ""} ready</span>}
                    {frontier.linkedWaveCount > 0 && <span className="text-accent-primary">{frontier.linkedWaveCount} plan step group{frontier.linkedWaveCount !== 1 ? "s" : ""}</span>}
                  </div>

                  <div className="rounded bg-surface-inset/70 px-3 py-2 mb-2">
                    <p className="text-[8px] font-semibold text-accent-primary mb-1">Recommended move</p>
                    <p className="text-foreground font-medium">{MOVE_LABELS[frontier.recommendedMove]}: {frontier.rationale}</p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                    <Link href="/pages" className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-[9px] font-semibold hover:bg-accent-primary/90 transition-colors">View pages →</Link>
                    {selected.bestChangeId && <Link href={`/changes/${selected.bestChangeId}`} className="px-2 py-1.5 rounded-md border border-border text-[9px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors">Best change →</Link>}
                  </div>
                </div>
              )}

              {/* Competitor evidence */}
              {frontier?.competitive && (
                <div className="rounded-lg border border-border px-4 py-3 text-[10px] space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-bold text-status-danger bg-status-danger/10 px-1.5 py-0.5 rounded">Competitive landscape</span>
                    <span className="text-[9px] text-muted-foreground">Dominated by: {SRC_LABELS[frontier.competitive.dominantSourceType] ?? frontier.competitive.dominantSourceType}</span>
                  </div>

                  <p className="text-muted-foreground leading-relaxed">{frontier.competitive.insight}</p>
                  <div className="rounded bg-surface-inset/70 px-3 py-1.5">
                    <span className="text-[8px] font-bold text-muted-foreground/60">Response: </span>
                    <span className="text-[10px] font-medium text-foreground">{frontier.competitive.responseType.replace(/_/g, " ")}</span>
                    <span className="text-[9px] text-muted-foreground ml-2">{frontier.competitive.responseRationale}</span>
                  </div>

                  {/* Source type breakdown */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {frontier.competitive.sourcePatterns.map((sp) => (
                      <span key={sp.type} className="inline-flex items-center gap-1 text-[9px]">
                        <span className="tabular-nums font-semibold">{sp.share}%</span>
                        <span className="text-muted-foreground">{SRC_LABELS[sp.type] ?? sp.type}</span>
                      </span>
                    ))}
                  </div>

                  {/* Top competitors */}
                  <div>
                    <p className="text-[8px] font-semibold text-muted-foreground mb-1">Top external sources</p>
                    {frontier.competitive.topCompetitors.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[9px] py-0.5">
                        <span className="tabular-nums font-medium w-[35px] text-right shrink-0">{c.citations}</span>
                        <span className="font-mono truncate flex-1">{c.domain}</span>
                        <span className="text-muted-foreground/60 shrink-0">{SRC_LABELS[c.sourceType] ?? c.sourceType}</span>
                      </div>
                    ))}
                  </div>

                  {/* Coverage gaps */}
                  {frontier.competitive.coverageGaps.length > 0 && (
                    <div>
                      <p className="text-[8px] font-semibold text-status-danger mb-1">Coverage gaps</p>
                      {frontier.competitive.coverageGaps.map((g, i) => (
                        <p key={i} className="text-muted-foreground">→ {g}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Asset response */}
              {frontier?.assetResponse && (
                <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.02] px-4 py-3 text-[10px]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[8px] font-bold text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">Asset response</span>
                    <span className="text-[12px] font-semibold text-foreground">{ASSET_LABELS[frontier.assetResponse.recommendedAssetType] ?? frontier.assetResponse.recommendedAssetType}</span>
                    <span className={cn("text-[9px] font-semibold", CONF_COLORS[frontier.assetResponse.confidenceLabel] ?? "text-muted-foreground")}>
                      {frontier.assetResponse.confidenceLabel.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-2">{frontier.assetResponse.rationale}</p>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground flex-wrap">
                    {frontier.assetResponse.ownedEquivalentExists ? (
                      <span className="text-status-success">Owned equivalent exists: {frontier.assetResponse.ownedEquivalentPages.join(", ")}</span>
                    ) : (
                      <span className="text-status-danger font-medium">No owned equivalent</span>
                    )}
                    {frontier.assetResponse.supportingSourcePatterns.length > 0 && (
                      <span>Sources: {frontier.assetResponse.supportingSourcePatterns.join(" · ")}</span>
                    )}
                  </div>
                  {frontier.assetResponse.missingAssetSignals.length > 0 && (
                    <div className="mt-1">
                      {frontier.assetResponse.missingAssetSignals.map((s, i) => (
                        <p key={i} className="text-[9px] text-status-warning">→ {s}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Attack package */}
              {frontier?.attackPackage && (
                <div className="rounded-lg border border-border px-4 py-3 text-[10px] space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-bold text-foreground bg-surface-inset px-1.5 py-0.5 rounded">Action plan</span>
                    <p className="text-[12px] font-semibold text-foreground flex-1">{frontier.attackPackage.title}</p>
                  </div>

                  <p className="text-muted-foreground leading-relaxed">{frontier.attackPackage.rationale}</p>
                  {frontier.attackPackage.notes && <p className="text-[9px] text-status-warning/80 italic">{frontier.attackPackage.notes}</p>}

                  {/* Competitor gap summary */}
                  {frontier.competitive && (
                    <div className="rounded bg-status-danger/5 border border-status-danger/15 px-3 py-2 text-[9px] space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[8px] text-status-danger/70">Why this package</span>
                        <span className="font-medium text-foreground">{frontier.competitive.responseType.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">Dominant: {SRC_LABELS[frontier.competitive.dominantSourceType] ?? frontier.competitive.dominantSourceType}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">Top: {frontier.competitive.topCompetitors.slice(0, 3).map((c) => c.domain).join(", ")}</span>
                      </div>
                      {frontier.competitive.coverageGaps.length > 0 && (
                        <p className="text-muted-foreground">
                          {ownedBrandShort === "You" ? "Gap for you" : `${ownedBrandShort} gap`}: {frontier.competitive.coverageGaps[0]}
                        </p>
                      )}
                      <p className="text-muted-foreground/70">{frontier.competitive.responseRationale}</p>
                    </div>
                  )}

                  {/* Pages to repair */}
                  {frontier.attackPackage.pagesToRepair.length > 0 && (
                    <div>
                      <p className="text-[8px] font-semibold text-muted-foreground mb-1">Pages to repair ({frontier.attackPackage.pagesToRepair.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {frontier.attackPackage.pagesToRepair.map((p) => (
                          <Link key={p} href="/pages" className="text-[9px] font-mono bg-surface-inset px-1.5 py-0.5 rounded hover:bg-accent-primary/10 transition-colors">{p}</Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing pages */}
                  {frontier.attackPackage.pagesToCreate.length > 0 && (
                    <div>
                      <p className="text-[8px] font-semibold text-status-warning mb-1">Missing page{frontier.attackPackage.pagesToCreate.length !== 1 ? "s" : ""} to create</p>
                      {frontier.attackPackage.pagesToCreate.map((mp, i) => (
                        <div key={i} className="rounded bg-status-warning/5 border border-status-warning/20 px-3 py-2 mb-1">
                          <p className="text-[11px] font-semibold text-foreground mb-1">{mp.suggestedTitle}</p>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground mb-1">
                            <span className="bg-surface-inset px-1.5 py-0.5 rounded">{mp.pageType}</span>
                            {mp.targetCity && <span>{mp.targetCity}</span>}
                            {mp.targetService && <span>{mp.targetService}</span>}
                          </div>
                          <p className="text-muted-foreground mb-2">{mp.rationale}</p>
                          <p className="text-[8px] font-semibold text-muted-foreground mb-1">Components</p>
                          {mp.suggestedComponents.map((c, j) => <p key={j} className="text-muted-foreground">{j + 1}. {c}</p>)}
                          {mp.suggestedInternalLinksIn.length > 0 && (
                            <p className="text-[9px] text-muted-foreground mt-1">Link from: {mp.suggestedInternalLinksIn.join(", ")}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Internal links */}
                  {frontier.attackPackage.internalLinkTargets.length > 0 && (
                    <div>
                      <p className="text-[8px] font-semibold text-muted-foreground mb-1">Internal links to add ({frontier.attackPackage.internalLinkTargets.length})</p>
                      {frontier.attackPackage.internalLinkTargets.slice(0, 5).map((lt, i) => (
                        <p key={i} className="text-muted-foreground">{lt.from} → {lt.to}</p>
                      ))}
                    </div>
                  )}

                  {/* Execution steps */}
                  <div>
                    <p className="text-[8px] font-semibold text-muted-foreground mb-1">Execution steps</p>
                    {frontier.attackPackage.executionSteps.map((s, i) => <p key={i} className="text-foreground">{i + 1}. {s}</p>)}
                  </div>

                  <details className="group">
                    <summary className="text-[9px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">Verification · {frontier.attackPackage.verificationPlan.length} steps</summary>
                    <div className="mt-1">{frontier.attackPackage.verificationPlan.map((v, i) => <p key={i} className="text-muted-foreground">{i + 1}. {v}</p>)}</div>
                  </details>

                  {/* Progress */}
                  {frontier.attackPackage.isPersisted && frontier.attackPackage.progress.totalActions > 0 && (
                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground pt-2 border-t border-border/30 flex-wrap">
                      <span className="font-semibold">{frontier.attackPackage.progress.pct}%</span>
                      {frontier.attackPackage.progress.repairTotal > 0 && <span>{frontier.attackPackage.progress.repairVerified}/{frontier.attackPackage.progress.repairTotal} repaired</span>}
                      {frontier.attackPackage.progress.missingTotal > 0 && <span>{frontier.attackPackage.progress.missingIndexed}/{frontier.attackPackage.progress.missingTotal} created</span>}
                      {frontier.attackPackage.progress.wavesLinked > 0 && <span>{frontier.attackPackage.progress.wavesCompleted}/{frontier.attackPackage.progress.wavesLinked} rollout plans</span>}
                    </div>
                  )}

                  {/* Missing page plans */}
                  {frontier.attackPackage.missingPages.length > 0 && (
                    <div className="pt-2 border-t border-border/30">
                      <p className="text-[8px] font-semibold text-muted-foreground mb-1">Missing pages</p>
                      {frontier.attackPackage.missingPages.map((mp) => (
                        <div key={mp.id} className="flex items-center gap-2 text-[9px] mb-0.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", mp.status === "completed" || mp.status === "indexed" ? "bg-status-success" : mp.status === "launched" ? "bg-accent-primary" : "bg-muted-foreground/40")} />
                          <span className="flex-1 truncate">{mp.title}</span>
                          <span className="text-muted-foreground/50">{mp.status}</span>
                          {onUpdateMissingPage && mp.status === "planned" && (
                            <button onClick={() => startTransition(async () => { await onUpdateMissingPage(mp.id, "handed_off"); })} disabled={pending} className="text-[8px] text-accent-primary hover:underline">hand off</button>
                          )}
                          {onUpdateMissingPage && mp.status === "handed_off" && (
                            <button onClick={() => startTransition(async () => { await onUpdateMissingPage(mp.id, "launched"); })} disabled={pending} className="text-[8px] text-accent-primary hover:underline">launched</button>
                          )}
                          {onUpdateMissingPage && mp.status === "launched" && (
                            <button onClick={() => startTransition(async () => { await onUpdateMissingPage(mp.id, "indexed"); })} disabled={pending} className="text-[8px] text-status-success hover:underline">indexed</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                    {!frontier.attackPackage.isPersisted && onLaunchPackage && (
                      <button onClick={() => { setLaunchMsg(null); startTransition(async () => {
                        const r = await onLaunchPackage(frontier.frontierKey);
                        if (r.success && r.handoffText) {
                          try { await navigator.clipboard.writeText(r.handoffText); } catch {}
                          setLaunchMsg("Launched + handoff copied ✓");
                        }
                      }); }} disabled={pending}
                        className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-[9px] font-semibold hover:bg-accent-primary/90 transition-colors"
                      >
                        {pending ? "Starting…" : "Start this plan"}
                      </button>
                    )}
                    {frontier.attackPackage.isPersisted && frontier.attackPackage.status !== "dismissed" && frontier.attackPackage.status !== "completed" && onDismissPackage && (
                      <button onClick={() => startTransition(async () => { await onDismissPackage(frontier.attackPackage.id); })} disabled={pending}
                        className="px-2 py-1 rounded border border-border text-muted-foreground text-[9px] hover:bg-surface-inset transition-colors"
                      >Dismiss</button>
                    )}
                    {launchMsg && <span className="text-[9px] text-status-success">{launchMsg}</span>}
                    <span className="ml-auto text-[9px] text-muted-foreground/50">
                      {PLAN_STATUS_LABELS[frontier.attackPackage.status] ?? frontier.attackPackage.status.replace(/_/g, " ")} · Priority {frontier.attackPackage.priorityScore}
                    </span>
                  </div>
                </div>
              )}

              {/* Changes + Events */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {selected.changes.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">Linked changes</p>
                    <div className="space-y-0.5">
                      {selected.changes.slice(0, 5).map((c) => (
                        <Link key={c.id} href={`/changes/${c.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors">
                          <p className="text-[11px] font-medium truncate flex-1">{c.name}</p>
                          <ChangeVerdictBadge verdict={c.verdict} />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {selected.events.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">Recent events</p>
                    <div className="space-y-0.5">
                      {selected.events.slice(0, 5).map((e) => (
                        <Link key={e.id} href={`/results/${e.anchorResultId}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors text-[10px]">
                          <span className="truncate flex-1">{e.description}</span>
                          {e.isDecided ? <span className="text-status-success text-[9px]">Decided</span> : <span className="text-muted-foreground text-[9px]">Open</span>}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="text-[9px] text-muted-foreground/40 pt-2">
                {selected.totalEvents} events · {selected.decidedEvents} decided · {selected.totalChanges} changes · {selected.nextMoveDetail}
              </div>

                </div>{/* end details content */}
              </details>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-[12px] text-muted-foreground/50">Select a topic · j/k to navigate</div>
        )}
      </div>
    </div>
  );
}
