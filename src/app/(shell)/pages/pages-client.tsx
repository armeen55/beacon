"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { PageRowCard } from "@/components/pages/page-row-card";
import { PagesSelectedDetail } from "@/components/pages/pages-selected-detail";
import { PagesWorkbenchTop } from "@/components/pages/pages-workbench-top";
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
      <PagesWorkbenchTop
        crawlIsStale={crawlIsStale}
        uncrawledCount={uncrawledCount}
        crawlAgeDays={crawlAgeDays}
        pageSummary={pageSummary}
        onScan={onScan}
        scanPending={scanPending}
        startScanTransition={startScanTransition}
        lastScanAt={lastScanAt}
        latestObservationRunId={latestObservationRunId}
        viewCounts={vc}
        view={view}
        setView={setView}
        fixRows={fixRows}
        winningRows={winningRows}
        watchRows={watchRows}
        rows={rows}
        setSelectedId={setSelectedId}
      />

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
            {filtered.map((row) => (
              <PageRowCard
                  key={row.id}
                row={row}
                isSelected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-[11px] text-muted-foreground py-6 text-center">No pages in this view</p>
            )}
          </div>
        </div>

          {/* Right: page brief */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-background">
          {selected ? (
            <PagesSelectedDetail
              selected={selected}
              issuePending={issuePending}
              startIssueTransition={startIssueTransition}
              copiedId={copiedId}
              setCopiedId={setCopiedId}
              verifyMsg={verifyMsg}
              setVerifyMsg={setVerifyMsg}
              onUpdateIssue={onUpdateIssue}
              onVerifyIssue={onVerifyIssue}
              onGenerateHandoff={onGenerateHandoff}
              onConvertBrief={onConvertBrief}
              onRefreshOutcome={onRefreshOutcome}
              onHandOffWave={onHandOffWave}
              onDismissWave={onDismissWave}
            />
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
