"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { KpiCard } from "@/components/viz/kpi-card";
import { DonutRing } from "@/components/viz/donut-ring";
import type { ChangeVerdict } from "@/domains/attribution/types";
import type { TrustSource } from "@/domains/attribution/scorecard";
import type { EvidenceTier } from "@/domains/pages/types";
import type { PageType } from "@/domains/pages/types";

// ── Types (unchanged, re-exported for server component) ──

type PageStatus = "winning" | "building" | "unresolved" | "dormant";
type PageNextMove = "double_down" | "review_signals" | "strengthen_evidence" | "wait" | "no_action";

export type PageEvent = { id: string; type: string; platform: string; topic: string; triggerDate: string; anchorResultId: string; isDecided: boolean };
export type PageChange = { id: string; name: string; description: string; verdict: ChangeVerdict; topScore: number | null; topTrust: TrustSource | null; evidenceTier: EvidenceTier; operatorConfirmed: boolean; date: string };
export type PageSnapshotSummary = {
  scannedAt: string;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  h1: string | null;
  faqCount: number;
  schemaTypes: string[];
  internalLinks: number;
  externalLinks: number;
  wordCount: number;
  hasCanonicalMismatch: boolean;
  robotsMeta: string | null;
  httpStatus: number;
  observationRunId?: string | null;
};
export type PageDiffSummary = { changed: boolean; summary: string; titleChanged: boolean; h1Changed: boolean; faqCountChanged: boolean; schemaChanged: boolean; contentChanged: boolean };
export type ClientFixBrief = {
  issueId: string; issueSummary: string; severity: string; citationCount: number;
  expectedState: string[]; observedState: string[]; likelyCauses: string[];
  verificationChecklist: string[]; bestNextMove: string; intentConflict: boolean;
  intentDetail: string | null;
  relatedChangelog: { id: string; date: string; name: string; description: string }[];
  issueStatus: string; handedOffAt: string | null; shippedAt: string | null;
  verifiedAt: string | null; verifyResult: { cleared: boolean; remaining: string[]; summary: string } | null;
  /** How this issue row is grounded (scanner vs legacy vs missing data). */
  issueEvidenceBasis: string;
  observationRunId?: string | null;
  verificationObservationRunId?: string | null;
  verificationBaselineObservationRunId?: string | null;
  /** Verified before verify-time run binding shipped. */
  verificationBindingLegacy?: boolean;
};
export type PageRow = {
  id: string; url: string; path: string; label: string; pageType: PageType;
  city: string | null; status: PageStatus; statusReason?: string; opportunityScore: number;
  topics: string[]; platforms: string[]; totalCitations: number;
  totalChanges: number; validatedChanges: number; partialChanges: number;
  operatorConfirmed: number; totalEvents: number; unresolvedEvents: number;
  bestTrust: TrustSource | null; bestEvidenceTier: EvidenceTier | null;
  bestChangeName: string | null; bestChangeId: string | null;
  nextMove: PageNextMove; nextMoveDetail: string;
  events: PageEvent[]; changes: PageChange[];
  snapshot: PageSnapshotSummary | null; diff: PageDiffSummary | null;
  guardrails: {
    severity: string;
    category: string;
    message: string;
    observationRunId?: string | null;
  }[];
  fixBriefs: ClientFixBrief[];
  playbookBriefs: ClientPlaybookBrief[];
  pendingFindingCount: number;
  waveId: string | null;
  waveName: string | null;
  wave: {
    id: string; title: string; status: string; waveType: string;
    rationale: string; targetPages: string[]; priorityScore: number;
    progress: { totalPages: number; tracked: number; shipped: number; verified: number; blocked: number; pct: number };
    briefIds: string[];
  } | null;
};

type ClientPlaybookBrief = {
  id: string;
  type: "fix" | "growth";
  title: string;
  patternId: string;
  patternName: string;
  rationale: string;
  evidence: string[];
  recommendations: string[];
  verificationChecklist: string[];
  priority: number;
  citationOpportunity: number;
  spec: {
    componentType: string;
    targetPage: string;
    requiredElements: string[];
    schemaPackage: string[];
    faqCountTarget: number;
    wordCountTarget: number | null;
    internalLinkTarget: number | null;
  };
  sourcePages: { path: string; citations: number }[];
  gapTrigger: string;
  rolloutIssueId: string | null;
  rolloutStatus: string | null;
  rolloutShippedAt: string | null;
  rolloutVerifiedAt: string | null;
  rolloutVerifyResult: { cleared: boolean; remaining: string[]; summary: string } | null;
  outcomeWatch: {
    daysSinceVerified: number;
    citationDelta: number | null;
    outcomeAssessment: string;
    evidenceSummary: string;
    linkedResultCount: number;
  } | null;
  patternEvidence: {
    executionConfidence: string;
    executionsTotal: number;
    executionsVerified: number;
    evidenceSummary: string;
    trustBasis: string;
    outcomeMaturity: string;
  };
};

// ── Config ──

const STATUS_CONFIG: Record<PageStatus, { label: string; color: string; dot: string }> = {
  winning: { label: "Strong", color: "text-status-success", dot: "bg-status-success" },
  building: { label: "Building", color: "text-accent-primary", dot: "bg-accent-primary" },
  unresolved: { label: "Follow up", color: "text-status-warning", dot: "bg-status-warning" },
  dormant: { label: "Low signal", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

const NEXT_MOVE: Record<PageNextMove, { label: string; color: string }> = {
  double_down: { label: "Strong", color: "text-status-success" },
  review_signals: { label: "Review", color: "text-status-warning" },
  strengthen_evidence: { label: "Strengthen", color: "text-accent-primary" },
  wait: { label: "Watching", color: "text-muted-foreground" },
  no_action: { label: "No action", color: "text-muted-foreground" },
};

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  homepage: "Homepage", city_page: "City", service_page: "Service",
  project_page: "Project", directory_profile: "Directory", other: "Page",
};

const STATUS_BADGE: Record<string, { label: string; dot: string }> = {
  new: { label: "Open", dot: "bg-status-danger" },
  handed_off: { label: "With dev", dot: "bg-status-warning" },
  in_progress: { label: "In progress", dot: "bg-accent-primary" },
  shipped: { label: "Live", dot: "bg-accent-primary" },
  verified: { label: "Checked", dot: "bg-status-success" },
  not_fixed: { label: "Still open", dot: "bg-status-danger" },
  dismissed: { label: "Dismissed", dot: "bg-muted-foreground/40" },
};

type FilterView = "fix" | "winning" | "watch" | "all";

export type PageSummary = {
  total: number;
  winning: number;
  needsAction: number;
  building: number;
  unresolved: number;
  dormant: number;
  cited: number;
  totalCitations: number;
  noFaq: number;
  noSchema: number;
  scanned: number;
};

// ── Main Component ──

export function PagesClient({
  pageSummary,
  rows,
  staleRows = [],
  lastScanAt,
  latestObservationRunId = null,
  onScan,
  onUpdateIssue,
  onVerifyIssue,
  onGenerateHandoff,
  onConvertBrief,
  onRefreshOutcome,
  onHandOffWave,
  onDismissWave,
}: {
  pageSummary?: PageSummary;
  rows: PageRow[];
  staleRows?: PageRow[];
  lastScanAt?: string | null;
  latestObservationRunId?: string | null;
  onScan?: () => Promise<{ success: boolean; pagesScanned?: number; pagesChanged?: number; alertCount?: number; error?: string }>;
  onUpdateIssue?: (issueId: string, status: string, meta?: { pageUrl?: string; pagePath?: string; category?: string }) => Promise<{ success: boolean }>;
  onVerifyIssue?: (issueId: string, pageUrl: string) => Promise<{ success: boolean; cleared: boolean; remaining: string[]; summary: string; error?: string }>;
  onGenerateHandoff?: (issueId: string, brief: { issueSummary: string; pageUrl: string; pagePath: string; severity: string; citationCount: number; expectedState: string[]; observedState: string[]; likelyCauses: string[]; verificationChecklist: string[]; bestNextMove: string; intentConflict: boolean; intentDetail: string | null }) => Promise<{ success: boolean; text: string }>;
  onConvertBrief?: (briefId: string, briefTitle: string, briefType: "fix" | "growth", pageUrl: string, pagePath: string, sourcePatternId: string, copyHandoff?: boolean, spec?: { schemaPackage: string[]; faqCountTarget: number; wordCountTarget: number | null; internalLinkTarget: number | null; requiredElements: string[] }, gapTrigger?: string, recommendations?: string[], verificationChecklist?: string[]) => Promise<{ success: boolean; issueId: string; handoffText?: string }>;
  onRefreshOutcome?: (issueId: string, pageUrl: string) => Promise<{ success: boolean; summary: string }>;
  onHandOffWave?: (waveId: string) => Promise<{ success: boolean; handoffText: string }>;
  onDismissWave?: (waveId: string) => Promise<{ success: boolean }>;
}) {
  const fixRows = rows.filter((r) => r.fixBriefs.length > 0 || r.guardrails.length > 0);
  const winningRows = rows.filter((r) => r.status === "winning");
  const watchRows = rows.filter((r) => r.status === "building" || r.status === "unresolved");

  const [view, setView] = useState<FilterView>(() => fixRows.length > 0 ? "fix" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const param = params.get("p");
      if (param && rows.some((r) => r.id === param)) return param;
    }
    const first = fixRows.length > 0 ? fixRows : rows;
    return first[0]?.id ?? null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const briefParam = new URLSearchParams(window.location.search).get("b");
    if (briefParam) {
      setTimeout(() => {
        const el = document.querySelector(`[data-brief-id="${briefParam}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 200);
    }
  }, []);
  const [scanPending, startScanTransition] = useTransition();
  const [issuePending, startIssueTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const filtered = view === "fix" ? fixRows : view === "winning" ? winningRows : view === "watch" ? watchRows : rows;
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const vc: Record<FilterView, number> = { fix: fixRows.length, winning: winningRows.length, watch: watchRows.length, all: rows.length };

  useEffect(() => {
    if (selectedId) {
      window.history.replaceState(null, "", `/pages?p=${selectedId}`);
    }
  }, [selectedId]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const idx = filtered.findIndex((r) => r.id === selectedId);
      const next = filtered[idx + 1];
      if (next) setSelectedId(next.id);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = filtered.findIndex((r) => r.id === selectedId);
      const prev = filtered[idx - 1];
      if (prev) setSelectedId(prev.id);
    } else if (e.key === "Enter" && selected?.bestChangeId) {
      e.preventDefault();
      window.location.href = `/changes/${selected.bestChangeId}`;
    }
  }, [filtered, selectedId, selected]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    const el = document.querySelector(`[data-page-id="${selectedId}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const crawlAgeDays = lastScanAt
    ? Math.floor((Date.now() - new Date(lastScanAt).getTime()) / 86_400_000)
    : null;
  const crawlIsStale = crawlAgeDays !== null && crawlAgeDays > 14;
  const uncrawledCount = pageSummary ? pageSummary.total - pageSummary.scanned : 0;

  return (
    <div>
      {/* ── Stale / missing crawl warning ── */}
      {(crawlIsStale || (pageSummary && pageSummary.scanned === 0)) && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/[0.05] px-4 py-3 mb-4 text-[12px]">
          {pageSummary && pageSummary.scanned === 0 ? (
            <p className="text-foreground">
              <span className="font-semibold text-status-warning">No pages have been scanned.</span>{" "}
              Use <span className="font-medium">Refresh scan</span> to inspect your pages.
            </p>
          ) : crawlIsStale ? (
            <p className="text-foreground">
              <span className="font-semibold text-status-warning">Scan data is {crawlAgeDays} days old.</span>{" "}
              Page structure may have changed since the last scan.
              {uncrawledCount > 0 && <span className="text-muted-foreground"> · {uncrawledCount} pages not yet scanned.</span>}
            </p>
          ) : null}
        </div>
      )}

      {/* ── Summary strip: KPI cards + status donut ── */}
      {pageSummary && (
        <div className="mb-5 space-y-4">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
              <KpiCard label="Tracked" value={pageSummary.total} size="lg" />
              <KpiCard label="Cited" value={pageSummary.cited} meta={`${pageSummary.totalCitations.toLocaleString()} total mentions`} size="lg" />
              <KpiCard label="Need Work" value={pageSummary.needsAction} meta={pageSummary.needsAction > 0 ? "Open issues" : "All clear"} size="lg" />
              <KpiCard label="Scanned" value={pageSummary.scanned} size="lg" />
            </div>
            {(pageSummary.winning > 0 || pageSummary.building > 0 || pageSummary.unresolved > 0 || pageSummary.dormant > 0) && (
              <div className="shrink-0">
                <DonutRing
                  segments={[
                    ...(pageSummary.winning > 0 ? [{ label: "Strong", value: pageSummary.winning, color: "stroke-status-success" }] : []),
                    ...(pageSummary.building > 0 ? [{ label: "Building", value: pageSummary.building, color: "stroke-accent-primary" }] : []),
                    ...(pageSummary.unresolved > 0 ? [{ label: "Follow up", value: pageSummary.unresolved, color: "stroke-status-warning" }] : []),
                    ...(pageSummary.dormant > 0 ? [{ label: "Low signal", value: pageSummary.dormant, color: "stroke-muted-foreground/40" }] : []),
                  ]}
                  size={90}
                  thickness={10}
                  centerLabel="Status"
                  centerValue={pageSummary.total}
                />
              </div>
            )}
          </div>
          {(pageSummary.noFaq > 0 || pageSummary.noSchema > 0) && pageSummary.scanned > 0 && (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
              {pageSummary.noFaq > 0 && (
                <span>
                  <span className="font-medium text-foreground/80">{pageSummary.noFaq}</span> without Q&amp;A block
                </span>
              )}
              {pageSummary.noSchema > 0 && (
                <span>
                  <span className="font-medium text-foreground/80">{pageSummary.noSchema}</span> without structured data
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top bar: scan + view tabs */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {onScan && (
          <button
            onClick={() => startScanTransition(async () => { await onScan(); })}
            disabled={scanPending}
            className={cn("px-3 py-1.5 rounded-md text-xs font-medium border transition-colors shrink-0", scanPending ? "border-border text-muted-foreground opacity-50" : "border-border/80 text-foreground hover:bg-surface-inset")}
          >
            {scanPending ? "Scanning…" : "Refresh scan"}
          </button>
        )}
        {lastScanAt && (
          <span className="text-[11px] text-muted-foreground/70 shrink-0 flex items-center gap-2 flex-wrap">
            <span>
              Last scan{" "}
              {new Date(lastScanAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {latestObservationRunId && (
              <Link
                href={`/observations/${encodeURIComponent(latestObservationRunId)}`}
                className="text-accent-primary hover:underline font-medium"
              >
                View run
              </Link>
            )}
          </span>
        )}
        <span className="flex-1 min-w-[8px]" />
        {(["fix", "winning", "watch", "all"] as const).map((v) =>
          vc[v] > 0 || v === "all" ? (
            <button key={v} onClick={() => { setView(v); const first = (v === "fix" ? fixRows : v === "winning" ? winningRows : v === "watch" ? watchRows : rows)[0]; if (first) setSelectedId(first.id); }}
              className={cn("px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/80")}
            >
              {v === "fix" ? "Needs work" : v === "winning" ? "Strong" : v === "watch" ? "Active" : "All"} · {vc[v]}
            </button>
          ) : null
        )}
      </div>

      {/* Split workbench: queue left, detail right */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,280px)_1fr] gap-5">
        {/* Left: list */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-background">
          <div className="px-3 py-2.5 border-b border-border/50">
            <p className="text-xs font-medium text-muted-foreground">
              {filtered.length} in this view
            </p>
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto divide-y divide-border/40">
            {filtered.map((row) => {
              const sc = STATUS_CONFIG[row.status];
              const isSelected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  data-page-id={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={cn(
                    "w-full text-left px-3 py-3 transition-colors",
                    isSelected
                      ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary"
                      : "hover:bg-surface-inset/50 border-l-[3px] border-l-transparent"
                  )}
                >
                  <p className="text-[13px] font-medium text-foreground leading-snug truncate">{row.label}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", sc.dot)} />
                    {row.fixBriefs.length > 0 ? (
                      <span className="text-[11px] font-medium text-status-danger tabular-nums">
                        {row.fixBriefs.length} open item{row.fixBriefs.length !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className={cn("text-[11px] font-medium", sc.color)}>{sc.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                    {row.totalCitations > 0 && <span className="tabular-nums">{row.totalCitations} mentions</span>}
                    {row.pendingFindingCount > 0 && (
                      <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[10px] text-accent-primary font-medium">
                        {row.pendingFindingCount} new
                      </span>
                    )}
                    {!row.snapshot && <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning font-medium">Not scanned</span>}
                    {row.snapshot && row.snapshot.faqCount === 0 && (
                      <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">No Q&amp;A</span>
                    )}
                    {row.snapshot && row.snapshot.schemaTypes.length === 0 && (
                      <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">No schema</span>
                    )}
                    {row.snapshot && row.snapshot.hasCanonicalMismatch && (
                      <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning font-medium">Canonical mismatch</span>
                    )}
                    <span className={cn("font-medium", NEXT_MOVE[row.nextMove].color)}>{NEXT_MOVE[row.nextMove].label}</span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-[11px] text-muted-foreground py-6 text-center">No pages in this view</p>
            )}
          </div>
        </div>

          {/* Right: page brief */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-background">
          {selected ? (
            <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
              {/* ── Header + health ── */}
              <div className="px-6 pt-5 pb-5 border-b border-border/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold tracking-tight leading-snug">{selected.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={selected.path}>{selected.path}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", STATUS_CONFIG[selected.status].dot)} />
                      <span className={cn("text-sm font-semibold", STATUS_CONFIG[selected.status].color)}>
                        {STATUS_CONFIG[selected.status].label}
                      </span>
                    </div>
                    {selected.statusReason && (
                      <p className="text-[11px] text-muted-foreground/80 max-w-[220px] leading-snug">{selected.statusReason}</p>
                    )}
                  </div>
                </div>

                {/* ── Ship status verdict ── */}
                <div className={cn(
                  "mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold",
                  selected.pendingFindingCount > 0
                    ? "bg-status-warning/[0.06] text-status-warning border border-status-warning/20"
                    : !selected.snapshot
                      ? "bg-surface-inset/30 text-muted-foreground border border-dashed border-border/50"
                      : selected.diff?.changed
                        ? "bg-accent-primary/[0.05] text-accent-primary border border-accent-primary/20"
                        : "bg-status-success/[0.06] text-status-success border border-status-success/20",
                )}>
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    selected.pendingFindingCount > 0
                      ? "bg-status-warning animate-pulse"
                      : !selected.snapshot
                        ? "bg-muted-foreground/40"
                        : selected.diff?.changed
                          ? "bg-accent-primary"
                          : "bg-status-success",
                  )} />
                  {selected.pendingFindingCount > 0
                    ? `${selected.pendingFindingCount} change${selected.pendingFindingCount !== 1 ? "s" : ""} detected — verify in Today`
                    : !selected.snapshot
                      ? "Not scanned yet"
                      : selected.diff?.changed
                        ? "Changes detected since last scan"
                        : selected.snapshot.scannedAt
                          ? `Verified live · ${new Date(selected.snapshot.scannedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${new Date(selected.snapshot.scannedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                          : "Scanned — no changes"
                  }
                </div>

                {/* ── Pending scan findings for this page ── */}
                {selected.pendingFindingCount > 0 && (
                  <div className="mt-4 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.03] px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-accent-primary animate-pulse" />
                      <p className="text-[12px] font-semibold text-foreground">
                        {selected.pendingFindingCount} change{selected.pendingFindingCount !== 1 ? "s" : ""} detected since last scan
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Review in <Link href="/" className="text-accent-primary hover:underline font-medium">Today</Link> to accept, dismiss, or mark expected.
                    </p>
                  </div>
                )}

                {/* ── 1. Live HTML: what the scan actually saw (verification truth) ── */}
                {selected.snapshot ? (
                  <div className="mt-4 rounded-lg border border-border/60 overflow-hidden">
                    <div className="px-4 py-2.5 bg-surface-inset/30 border-b border-border/40 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold text-foreground">What the scan found</p>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(selected.snapshot.scannedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {selected.snapshot.httpStatus !== 200 && (
                          <span className="text-status-danger font-medium ml-2">HTTP {selected.snapshot.httpStatus}</span>
                        )}
                      </span>
                    </div>
                    <div className="px-4 py-3 space-y-2.5 text-[12px]">
                      <CrawlRow label="Title" value={selected.snapshot.title} />
                      <CrawlRow label="Meta description" value={selected.snapshot.metaDescription} truncate />
                      <CrawlRow label="H1" value={selected.snapshot.h1} />
                      <CrawlRow label="Canonical" value={selected.snapshot.canonicalUrl} warn={selected.snapshot.hasCanonicalMismatch} warnText="Mismatch with page URL" />
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <CrawlChip label="Q&A blocks" value={selected.snapshot.faqCount} good={selected.snapshot.faqCount > 0} />
                        <CrawlChip label="Schema types" value={selected.snapshot.schemaTypes.length > 0 ? selected.snapshot.schemaTypes.join(", ") : "None"} good={selected.snapshot.schemaTypes.length > 0} />
                        <CrawlChip label="Word count" value={selected.snapshot.wordCount.toLocaleString()} good={selected.snapshot.wordCount >= 300} />
                        <CrawlChip label="Internal links" value={selected.snapshot.internalLinks} good={selected.snapshot.internalLinks >= 3} />
                      </div>
                      {selected.snapshot.robotsMeta && selected.snapshot.robotsMeta !== "index, follow" && (
                        <div className="flex items-center gap-2 text-[11px] text-status-warning font-medium">
                          <span>Robots: {selected.snapshot.robotsMeta}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-border/60 px-4 py-3">
                    <p className="text-[12px] text-muted-foreground">Not scanned yet. Use <span className="font-medium text-foreground">Refresh scan</span> to inspect this page.</p>
                  </div>
                )}

                {/* ── 2. What changed since last scan ── */}
                {selected.diff && selected.diff.changed ? (
                  <div className="mt-3 rounded-lg border border-status-warning/20 bg-status-warning/[0.03] px-4 py-3">
                    <p className="text-[11px] font-semibold text-foreground mb-1.5">Changed since last scan</p>
                    <div className="flex flex-wrap gap-2">
                      {selected.diff.titleChanged && <DiffChip label="Title" />}
                      {selected.diff.h1Changed && <DiffChip label="H1" />}
                      {selected.diff.faqCountChanged && <DiffChip label="Q&A" />}
                      {selected.diff.schemaChanged && <DiffChip label="Schema" />}
                      {selected.diff.contentChanged && <DiffChip label="Content" />}
                    </div>
                    {selected.diff.summary && (
                      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{selected.diff.summary}</p>
                    )}
                  </div>
                ) : selected.snapshot ? (
                  <div className="mt-3 flex items-center gap-2 px-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                    <p className="text-[11px] text-muted-foreground">No changes since last scan</p>
                  </div>
                ) : null}

                {/* ── 3. Visibility importance ── */}
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <div className="inline-flex items-baseline gap-1 rounded-md border border-border/50 bg-surface-raised/30 px-2.5 py-1">
                    <span className="text-lg font-bold tabular-nums">{selected.totalCitations}</span>
                    <span className="text-xs text-muted-foreground">{selected.totalCitations === 1 ? "mention" : "mentions"}</span>
                  </div>
                  {selected.platforms.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {selected.platforms.slice(0, 4).join(" · ")}
                    </span>
                  )}
                  {selected.validatedChanges > 0 && (
                    <span className="text-xs font-medium text-status-success">{selected.validatedChanges} validated</span>
                  )}
                </div>

                {/* ── 4. Next step ── */}
                <div className="mt-4 rounded-lg border border-border/50 bg-surface-inset/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground">Next step</p>
                  <p className={cn("text-sm font-semibold mt-0.5", NEXT_MOVE[selected.nextMove].color)}>
                    {NEXT_MOVE[selected.nextMove].label}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                    {selected.nextMoveDetail}
                  </p>
                </div>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Deployment truth guard */}
                {selected.pendingFindingCount > 0 && selected.fixBriefs.length > 0 && (
                  <div className="rounded-lg border border-status-warning/30 bg-status-warning/[0.03] px-4 py-2.5">
                    <p className="text-[11px] text-status-warning font-semibold">Verify site truth before acting on recommendations</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      This page has {selected.pendingFindingCount} pending scan finding{selected.pendingFindingCount !== 1 ? "s" : ""}. Resolve findings in <Link href="/" className="text-accent-primary hover:underline font-medium">Today</Link> first — the recommendation below may change after verification.
                    </p>
                  </div>
                )}
                {/* Action summary for fix pages */}
                {selected.fixBriefs.length > 0 && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Why it matters</p>
                      <p className="text-[13px] text-foreground/90 leading-relaxed">
                        {selected.fixBriefs[0].issueSummary.replace(/citation/gi, "mention").replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Recommended move</p>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        {selected.fixBriefs[0].bestNextMove.replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data").replace(/JSON-LD/g, "page details")}
                      </p>
                    </div>
                  </div>
                )}
                {selected.playbookBriefs.length > 0 && selected.fixBriefs.length === 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Opportunity</p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">
                      {selected.playbookBriefs[0].rationale.replace(/citation/gi, "mention").replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data")}
                    </p>
                  </div>
                )}
                {selected.fixBriefs.length === 0 && selected.playbookBriefs.length === 0 && !selected.snapshot && (
                  <p className="text-sm text-muted-foreground border border-dashed border-border/60 rounded-lg px-3 py-2.5">
                    Not scanned yet. Use <span className="font-medium text-foreground">Refresh scan</span> to analyze this URL.
                  </p>
                )}
                {selected.fixBriefs.length === 0 && selected.playbookBriefs.length === 0 && selected.snapshot && (
                  <p className="text-sm text-muted-foreground">No open issues on this page.</p>
                )}

                {/* Primary actions */}
                <div className="flex items-center gap-3 flex-wrap">
                  {selected.fixBriefs.length > 0 && selected.fixBriefs[0].issueStatus === "new" && onConvertBrief && (
                    <button
                      onClick={() => startIssueTransition(async () => {
                        const fb = selected.fixBriefs[0];
                        const pb = selected.playbookBriefs[0];
                        const briefId = pb?.id ?? fb.issueId;
                        const r = await onConvertBrief(briefId, fb.issueSummary, "fix", selected.url, selected.path, pb?.patternId ?? "", true, pb?.spec, pb?.gapTrigger, pb?.recommendations, pb?.verificationChecklist);
                        if (r.success && r.handoffText) {
                          try { await navigator.clipboard.writeText(r.handoffText); } catch {}
                          setCopiedId(briefId);
                          setTimeout(() => setCopiedId(null), 2000);
                        }
                      })}
                      disabled={issuePending}
                      className="px-4 py-2.5 rounded-md bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      {copiedId ? "Copied" : "Hand off to dev"}
                    </button>
                  )}
                  {selected.fixBriefs.length > 0 && (selected.fixBriefs[0].issueStatus === "handed_off" || selected.fixBriefs[0].issueStatus === "in_progress") && onUpdateIssue && (
                    <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(selected.fixBriefs[0].issueId, "shipped", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-4 py-2.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-surface-inset transition-colors">Mark live</button>
                  )}
                  {selected.fixBriefs.length > 0 && (selected.fixBriefs[0].issueStatus === "shipped" || selected.fixBriefs[0].issueStatus === "not_fixed") && onVerifyIssue && (
                    <button onClick={() => startIssueTransition(async () => { await onVerifyIssue(selected.fixBriefs[0].issueId, selected.url); })} disabled={issuePending} className="px-4 py-2.5 rounded-md border border-status-success/40 text-sm font-semibold text-status-success hover:bg-status-success/5 transition-colors">{issuePending ? "Checking…" : "Verify fix"}</button>
                  )}
                  {selected.fixBriefs.length > 0 && selected.fixBriefs[0].issueStatus === "verified" && (
                    <span className="text-sm text-status-success font-medium">Verified</span>
                  )}
                  {copiedId && <span className="text-xs text-muted-foreground">Handoff copied</span>}
                  {verifyMsg && <span className="text-xs text-muted-foreground">{verifyMsg}</span>}
                </div>

                {selected.fixBriefs.length > 0 && (
                  <Link
                    href={`/changes?page=${encodeURIComponent(selected.url)}&city=${encodeURIComponent(selected.city ?? "")}&topic=${encodeURIComponent(selected.topics[0] ?? "")}`}
                    className="text-xs text-accent-primary hover:underline font-medium"
                  >
                    Log in Changes →
                  </Link>
                )}

                <details className="group mt-2">
                  <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-block text-[9px] text-muted-foreground/50 transition-transform group-open:rotate-90">▶</span>
                    Evidence &amp; technical detail
                  </summary>
                  <div className="mt-4 space-y-5">

                {/* Wave panel */}
                {selected.wave && (
                  <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.02] px-4 py-3 text-[10px]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[8px] font-bold text-muted-foreground bg-surface-inset px-1.5 py-0.5 rounded border border-border">Rollout plan</span>
                      <p className="text-[12px] font-semibold text-foreground flex-1 truncate">{selected.wave.title}</p>
                      <span className="text-[9px] text-muted-foreground font-medium">{selected.wave.status.replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-muted-foreground mb-2">{selected.wave.rationale}</p>
                    <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
                      <span>{selected.wave.progress.totalPages} pages</span>
                      <span>{selected.wave.progress.tracked} tracked</span>
                      {selected.wave.progress.shipped > 0 && <span className="text-accent-primary font-medium">{selected.wave.progress.shipped} shipped</span>}
                      {selected.wave.progress.verified > 0 && <span className="text-status-success font-medium">{selected.wave.progress.verified} verified</span>}
                      {selected.wave.progress.blocked > 0 && <span className="text-status-danger font-medium">{selected.wave.progress.blocked} blocked</span>}
                      <span>{selected.wave.progress.pct}% complete</span>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                      {selected.wave.status === "proposed" && onHandOffWave && (
                        <button
                          onClick={() => startIssueTransition(async () => {
                            const r = await onHandOffWave(selected.wave!.id);
                            if (r.success && r.handoffText) {
                              try { await navigator.clipboard.writeText(r.handoffText); } catch {}
                              setCopiedId(`wave-${selected.wave!.id}`);
                              setTimeout(() => setCopiedId(null), 2000);
                            }
                          })}
                          disabled={issuePending}
                          className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-[9px] font-semibold hover:bg-accent-primary/90 transition-colors"
                        >
                          {copiedId === `wave-${selected.wave.id}` ? "Handed off + Copied ✓" : "Send rollout plan"}
                        </button>
                      )}
                      {selected.wave.status === "proposed" && onDismissWave && (
                        <button
                          onClick={() => startIssueTransition(async () => { await onDismissWave(selected.wave!.id); })}
                          disabled={issuePending}
                          className="px-2 py-1.5 rounded-md border border-border text-muted-foreground text-[9px] font-medium hover:bg-surface-inset transition-colors"
                        >
                          Dismiss
                        </button>
                      )}
                      {selected.wave.status !== "proposed" && (
                        <span className="text-[9px] text-muted-foreground/50">
                          {selected.wave.targetPages.filter((p) => p !== selected.url).map((p) => p.replace(/^https?:\/\/[^/]+/, "")).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Fix briefs */}
                {selected.fixBriefs.length > 0 && (
                  <div className="space-y-4">
                    {selected.fixBriefs.map((fb) => {
                      const sb = STATUS_BADGE[fb.issueStatus] ?? STATUS_BADGE.new;
                      return (
                        <div key={fb.issueId} className={cn("rounded-lg border px-4 py-3 text-[10px]", fb.intentConflict ? "border-status-danger/30 bg-status-danger/[0.02]" : "border-border")}>
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div>
                              <p className="text-[12px] font-semibold text-foreground">{fb.issueSummary}</p>
                              <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">
                                {fb.issueEvidenceBasis}
                                {fb.observationRunId ? (
                                  <>
                                    {" "}
                                    <Link
                                      href={`/observations/${encodeURIComponent(fb.observationRunId)}`}
                                      className="text-accent-primary hover:underline font-medium"
                                    >
                                      Open run →
                                    </Link>
                                  </>
                                ) : null}
                              </p>
                              {fb.intentDetail && <p className="text-[9px] text-status-danger/80 mt-1">{fb.intentDetail}</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {fb.intentConflict && <span className="text-[10px] font-medium text-status-danger bg-status-danger/10 px-2 py-0.5 rounded-md">Intent mismatch</span>}
                              <span className="inline-flex items-center gap-1">
                                <span className={cn("h-1.5 w-1.5 rounded-full", sb.dot)} />
                                <span className="text-[9px] font-semibold text-muted-foreground">{sb.label}</span>
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground mb-1">Target</p>
                              {fb.expectedState.map((s, i) => <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">{s}</p>)}
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground mb-1">Live page</p>
                              {fb.observedState.map((s, i) => <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">{s}</p>)}
                            </div>
                          </div>

                          <div className="mb-3">
                            <p className="text-[10px] font-medium text-muted-foreground mb-1">Likely causes</p>
                            {fb.likelyCauses.slice(0, 3).map((c, i) => (
                              <p key={i} className="text-muted-foreground flex gap-1.5"><span className="text-muted-foreground/40 shrink-0">→</span>{c}</p>
                            ))}
                          </div>

                          <div className="rounded-lg border border-border/40 bg-surface-inset/50 px-3 py-2.5 mb-3">
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Next move</p>
                            <p className="text-[13px] text-foreground leading-relaxed">{fb.bestNextMove}</p>
                          </div>

                          {/* Issue controls */}
                          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/50">
                            {fb.issueStatus === "new" && onGenerateHandoff && (
                              <button onClick={() => { startIssueTransition(async () => {
                                const r = await onGenerateHandoff(fb.issueId, { issueSummary: fb.issueSummary, pageUrl: selected.url, pagePath: selected.path, severity: fb.severity, citationCount: fb.citationCount, expectedState: fb.expectedState, observedState: fb.observedState, likelyCauses: fb.likelyCauses, verificationChecklist: fb.verificationChecklist, bestNextMove: fb.bestNextMove, intentConflict: fb.intentConflict, intentDetail: fb.intentDetail });
                                if (r.success) { try { await navigator.clipboard.writeText(r.text); } catch {} setCopiedId(fb.issueId); setTimeout(() => setCopiedId(null), 2000); }
                              }); }} disabled={issuePending} className="px-2 py-1 rounded border border-accent-primary/30 text-accent-primary font-semibold hover:bg-accent-primary/10 text-[9px]">
                                {copiedId === fb.issueId ? "Copied ✓" : "Copy handoff"}
                              </button>
                            )}
                            {fb.issueStatus === "new" && onUpdateIssue && (
                              <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(fb.issueId, "dismissed", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-2 py-1 rounded border border-border text-muted-foreground font-medium hover:bg-surface-inset text-[9px]">Dismiss</button>
                            )}
                            {(fb.issueStatus === "handed_off" || fb.issueStatus === "in_progress") && onUpdateIssue && (
                              <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(fb.issueId, "shipped", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-2 py-1 rounded border border-accent-primary/30 text-accent-primary font-semibold hover:bg-accent-primary/10 text-[9px]">Mark shipped</button>
                            )}
                            {(fb.issueStatus === "shipped" || fb.issueStatus === "not_fixed") && onVerifyIssue && (
                              <button onClick={() => startIssueTransition(async () => { const r = await onVerifyIssue(fb.issueId, selected.url); setVerifyMsg(r.success ? (r.cleared ? "All clear ✓" : r.summary) : `Failed: ${r.error?.slice(0,80)}`); setTimeout(() => setVerifyMsg(null), 4000); })} disabled={issuePending} className="px-2 py-1 rounded border border-status-success/30 text-status-success font-semibold hover:bg-status-success/10 text-[9px]">{issuePending ? "Verifying…" : "Verify fix"}</button>
                            )}
                            {(fb.issueStatus === "verified" || fb.issueStatus === "dismissed") && onUpdateIssue && (
                              <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(fb.issueId, "new", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-2 py-1 rounded border border-border text-muted-foreground font-medium hover:bg-surface-inset text-[9px]">Re-open</button>
                            )}
                            {verifyMsg && <span className="text-[9px] text-muted-foreground">{verifyMsg}</span>}
                          </div>

                          {/* Issue lifecycle timeline */}
                          {(fb.handedOffAt || fb.shippedAt || fb.verifiedAt) && (
                            <div className="flex items-center gap-3 text-[9px] text-muted-foreground/60 pt-2 border-t border-border/30">
                              {fb.handedOffAt && (
                                <span>Handed off {new Date(fb.handedOffAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                              )}
                              {fb.handedOffAt && (fb.shippedAt || fb.verifiedAt) && <span>→</span>}
                              {fb.shippedAt && (
                                <span>Shipped {new Date(fb.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                              )}
                              {fb.shippedAt && fb.verifiedAt && <span>→</span>}
                              {fb.verifiedAt && (
                                <span className="text-status-success">Verified {new Date(fb.verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                              )}
                              {fb.verifyResult && (
                                <span className={fb.verifyResult.cleared ? "text-status-success font-medium" : "text-status-danger font-medium"}>
                                  {fb.verifyResult.cleared ? "All clear" : fb.verifyResult.summary}
                                </span>
                              )}
                              {fb.verificationBindingLegacy && (
                                <span className="text-[9px] text-muted-foreground block mt-1">
                                  Older verification — run details not recorded.
                                </span>
                              )}
                              {fb.verificationObservationRunId && (
                                <span className="text-[9px] text-muted-foreground block mt-1">
                                  Verify fetch:{" "}
                                  <Link
                                    href={`/observations/${encodeURIComponent(fb.verificationObservationRunId)}`}
                                    className="text-accent-primary hover:underline font-medium"
                                  >
                                    View run
                                  </Link>
                                  {fb.verificationBaselineObservationRunId ? (
                                    <>
                                      {" "}
                                      · prior scan:{" "}
                                      <Link
                                        href={`/observations/${encodeURIComponent(fb.verificationBaselineObservationRunId)}`}
                                        className="text-accent-primary hover:underline font-medium"
                                      >
                                        baseline
                                      </Link>
                                    </>
                                  ) : null}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Playbook briefs */}
                {selected.playbookBriefs.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold text-muted-foreground">
                      {selected.playbookBriefs.some((b) => b.type === "growth") ? "Ship next" : "Recommended fix"}
                    </p>
                    {selected.playbookBriefs.map((pb) => {
                      const isTracked = !!pb.rolloutIssueId;
                      const statusLabel = pb.rolloutStatus
                        ? (STATUS_BADGE[pb.rolloutStatus]?.label ?? pb.rolloutStatus)
                        : null;
                      return (
                        <div key={pb.id} data-brief-id={pb.id} className={cn("rounded-lg border px-4 py-3 text-[10px]", pb.type === "growth" ? "border-status-success/20 bg-status-success/[0.02]" : "border-accent-primary/20 bg-accent-primary/[0.02]")}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded", pb.type === "growth" ? "bg-status-success/10 text-status-success" : "bg-accent-primary/10 text-accent-primary")}>
                              {pb.type === "growth" ? "Growth" : "Fix"}
                            </span>
                            <p className="text-[12px] font-semibold text-foreground flex-1">{pb.title}</p>
                            {statusLabel && (
                              <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded", pb.rolloutStatus === "verified" ? "bg-status-success/10 text-status-success" : pb.rolloutStatus === "shipped" ? "bg-accent-primary/10 text-accent-primary" : "bg-surface-inset text-muted-foreground")}>
                                {statusLabel}
                              </span>
                            )}
                          </div>

                          <p className="text-muted-foreground leading-relaxed mb-2">{pb.rationale}</p>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/50 mb-2 flex-wrap">
                            <span>Gap: {pb.gapTrigger}</span>
                            <span>·</span>
                            <span className={cn(
                              "font-medium",
                              pb.patternEvidence.executionConfidence === "execution_validated" ? "text-status-success" :
                              pb.patternEvidence.executionConfidence === "execution_mixed" ? "text-status-warning" :
                              "text-muted-foreground/60"
                            )}>
                              {pb.patternEvidence.executionConfidence === "execution_validated" ? "Execution validated" :
                               pb.patternEvidence.executionConfidence === "execution_mixed" ? "Mixed results" :
                               pb.patternEvidence.executionConfidence === "execution_weak" ? "Shipped, verifying" :
                               "Structurally observed"}
                              {pb.patternEvidence.executionsTotal > 0 && ` · ${pb.patternEvidence.executionsVerified}/${pb.patternEvidence.executionsTotal} verified`}
                            </span>
                            {pb.patternEvidence.outcomeMaturity !== "not_applicable" && (
                              <>
                                <span>·</span>
                                <span className={cn(
                                  pb.patternEvidence.outcomeMaturity === "positive_signal" ? "text-status-success font-medium" :
                                  "text-muted-foreground/60"
                                )}>
                                  {pb.patternEvidence.outcomeMaturity === "positive_signal" ? "Early positive signal" :
                                   pb.patternEvidence.outcomeMaturity === "no_clear_impact" ? "No clear impact yet" :
                                   "Outcome too early"}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Structured spec */}
                          <div className="rounded bg-surface-inset/50 px-3 py-2 mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
                            <div><span className="text-muted-foreground/60">Schema:</span> <span className="font-medium">{pb.spec.schemaPackage.join(", ") || "—"}</span></div>
                            <div><span className="text-muted-foreground/60">FAQ target:</span> <span className="font-medium">{pb.spec.faqCountTarget}</span></div>
                            {pb.spec.wordCountTarget && <div><span className="text-muted-foreground/60">Words:</span> <span className="font-medium">{pb.spec.wordCountTarget}+</span></div>}
                            {pb.spec.internalLinkTarget && <div><span className="text-muted-foreground/60">Int. links:</span> <span className="font-medium">{pb.spec.internalLinkTarget}+</span></div>}
                            <div className="col-span-2"><span className="text-muted-foreground/60">Elements:</span> <span className="font-medium">{pb.spec.requiredElements.join(", ")}</span></div>
                          </div>

                          {pb.sourcePages.length > 0 && (
                            <p className="text-[9px] text-muted-foreground/50 mb-2">
                              Source: {pb.sourcePages.map((s) => `${s.path} (${s.citations} mentions)`).join(", ")}
                            </p>
                          )}

                          <div className="mb-2">
                            <p className="text-[8px] font-semibold text-muted-foreground mb-1">Steps</p>
                            {pb.recommendations.map((r, i) => <p key={i} className="text-foreground leading-relaxed">{i + 1}. {r}</p>)}
                          </div>

                          <details className="group mb-2">
                            <summary className="text-[9px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">Verification · {pb.verificationChecklist.length} steps</summary>
                            <div className="mt-1 space-y-0.5">
                              {pb.verificationChecklist.map((s, i) => <p key={i} className="text-muted-foreground">{i + 1}. {s}</p>)}
                            </div>
                          </details>

                          {/* Rollout lifecycle timeline */}
                          {isTracked && (pb.rolloutShippedAt || pb.rolloutVerifiedAt) && (
                            <div className="flex items-center gap-2 text-[9px] text-muted-foreground/50 mb-2">
                              {pb.rolloutShippedAt && <span>Shipped {new Date(pb.rolloutShippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                              {pb.rolloutShippedAt && pb.rolloutVerifiedAt && <span>→</span>}
                              {pb.rolloutVerifiedAt && <span className="text-status-success">Verified {new Date(pb.rolloutVerifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                              {pb.rolloutVerifyResult && <span className={pb.rolloutVerifyResult.cleared ? "text-status-success" : "text-status-danger"}>{pb.rolloutVerifyResult.summary}</span>}
                            </div>
                          )}

                          {/* Outcome watch */}
                          {pb.outcomeWatch && (
                            <div className={cn(
                              "rounded px-3 py-2 text-[9px] mb-2",
                              pb.outcomeWatch.outcomeAssessment === "promising_but_ambiguous" || pb.outcomeWatch.outcomeAssessment === "early_movement"
                                ? "bg-status-success/5 border border-status-success/20"
                                : pb.outcomeWatch.outcomeAssessment === "likely_no_visible_effect_yet" || pb.outcomeWatch.outcomeAssessment === "mixed_signal"
                                  ? "bg-status-warning/5 border border-status-warning/20"
                                  : "bg-surface-inset/50"
                            )}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[8px] font-bold text-muted-foreground">Outcome watch</span>
                                <span className="text-muted-foreground/50">{pb.outcomeWatch.daysSinceVerified}d since verified</span>
                                {pb.outcomeWatch.citationDelta != null && (
                                  <span className={pb.outcomeWatch.citationDelta > 0 ? "text-status-success font-medium" : "text-muted-foreground"}>
                                    {pb.outcomeWatch.citationDelta > 0 ? `+${pb.outcomeWatch.citationDelta}` : pb.outcomeWatch.citationDelta} tracked mentions
                                  </span>
                                )}
                                {pb.outcomeWatch.linkedResultCount > 0 && (
                                  <span className="text-accent-primary">{pb.outcomeWatch.linkedResultCount} linked result{pb.outcomeWatch.linkedResultCount !== 1 ? "s" : ""}</span>
                                )}
                              </div>
                              <p className="text-muted-foreground leading-relaxed">{pb.outcomeWatch.evidenceSummary}</p>
                            </div>
                          )}
                          {isTracked && pb.rolloutStatus === "verified" && !pb.outcomeWatch && onRefreshOutcome && pb.rolloutIssueId && (
                            <button
                              onClick={() => startIssueTransition(async () => { await onRefreshOutcome(pb.rolloutIssueId!, selected.url); })}
                              disabled={issuePending}
                              className="px-2 py-1 rounded border border-border text-muted-foreground font-medium hover:bg-surface-inset text-[9px] mb-2"
                            >
                              Check outcome
                            </button>
                          )}

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                            {!isTracked && onConvertBrief && (
                              <button
                                onClick={() => startIssueTransition(async () => {
                                  const r = await onConvertBrief(pb.id, pb.title, pb.type, selected.url, selected.path, pb.patternId, true, pb.spec, pb.gapTrigger, pb.recommendations, pb.verificationChecklist);
                                  if (r.success && r.handoffText) {
                                    try { await navigator.clipboard.writeText(r.handoffText); } catch {}
                                    setCopiedId(pb.id);
                                    setTimeout(() => setCopiedId(null), 2000);
                                  }
                                })}
                                disabled={issuePending}
                                className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-[9px] font-semibold hover:bg-accent-primary/90 transition-colors"
                              >
                                {copiedId === pb.id ? "Tracked + Copied ✓" : "Track & hand off"}
                              </button>
                            )}
                            {isTracked && pb.rolloutStatus === "handed_off" && onUpdateIssue && (
                              <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(pb.rolloutIssueId!, "shipped", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-2 py-1 rounded border border-accent-primary/30 text-accent-primary font-semibold hover:bg-accent-primary/10 text-[9px]">Mark shipped</button>
                            )}
                            {isTracked && (pb.rolloutStatus === "shipped" || pb.rolloutStatus === "not_fixed") && onVerifyIssue && (
                              <button onClick={() => startIssueTransition(async () => { await onVerifyIssue(pb.rolloutIssueId!, selected.url); })} disabled={issuePending} className="px-2 py-1 rounded border border-status-success/30 text-status-success font-semibold hover:bg-status-success/10 text-[9px]">{issuePending ? "Verifying…" : "Verify"}</button>
                            )}
                            {isTracked && <span className="text-[9px] text-muted-foreground/40 ml-auto">Tracked</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Changes + Events */}
                {(selected.changes.length > 0 || selected.events.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {selected.changes.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Changes tied to this URL</p>
                        <div className="space-y-0.5">
                          {selected.changes.map((c) => (
                            <Link key={c.id} href={`/changes/${c.id}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium truncate">{c.name}</p>
                                {c.description && <p className="text-[9px] text-muted-foreground/70 line-clamp-1 mt-0.5">{c.description}</p>}
                              </div>
                              <ChangeVerdictBadge verdict={c.verdict} />
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {selected.events.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Visibility shifts</p>
                        <div className="space-y-0.5">
                          {selected.events.map((e) => (
                            <Link key={e.id} href={`/results/${e.anchorResultId}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors text-xs">
                              <span className="truncate flex-1">{e.topic}</span>
                              {e.isDecided ? <span className="text-status-success text-[11px] font-medium">Reviewed</span> : <span className="text-muted-foreground text-[11px]">Open</span>}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/40">
                  {selected.bestChangeId && (
                    <Link href={`/changes/${selected.bestChangeId}`} className="text-xs text-accent-primary hover:underline font-medium">Open linked change →</Link>
                  )}
                </div>

                  </div>{/* end details content */}
                </details>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
              Choose a page from the list
            </div>
          )}
        </div>
      </div>

      {/* Stale pages */}
      {staleRows.length > 0 && (
        <details className="mt-8">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
            Outside current sitemap ({staleRows.length})
          </summary>
          <div className="mt-2 space-y-1">
            {staleRows.map((row) => (
              <div key={row.id} className="rounded-md border border-border/50 px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/50">
                <span className="font-mono text-[9px] truncate flex-1">{row.url}</span>
                {row.totalCitations > 0 && <span className="tabular-nums">{row.totalCitations} mentions</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CrawlRow({ label, value, truncate, warn, warnText }: { label: string; value: string | null; truncate?: boolean; warn?: boolean; warnText?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide w-28 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 flex-1">
        {value ? (
          <p className={cn("text-[12px] text-foreground leading-snug", truncate && "line-clamp-2")}>{value}</p>
        ) : (
          <p className="text-[12px] text-muted-foreground/50 italic">Not found</p>
        )}
        {warn && warnText && (
          <p className="text-[10px] text-status-warning font-medium mt-0.5">{warnText}</p>
        )}
      </div>
    </div>
  );
}

function CrawlChip({ label, value, good }: { label: string; value: string | number; good: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn(
        "text-[11px] font-semibold tabular-nums",
        good ? "text-status-success" : "text-muted-foreground",
      )}>
        {value}
      </span>
    </div>
  );
}

function DiffChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/10 px-2 py-0.5 text-[10px] font-medium text-status-warning">
      {label} changed
    </span>
  );
}
