"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
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
  h1: string | null;
  faqCount: number;
  schemaTypes: string[];
  internalLinks: number;
  externalLinks: number;
  wordCount: number;
  hasCanonicalMismatch: boolean;
  robotsMeta: string | null;
  /** Website crawl ObservationRun that produced this snapshot, when stamped. */
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
  city: string | null; status: PageStatus; opportunityScore: number;
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
  winning: { label: "Winning", color: "text-status-success", dot: "bg-status-success" },
  building: { label: "Building", color: "text-accent-primary", dot: "bg-accent-primary" },
  unresolved: { label: "Unresolved", color: "text-status-warning", dot: "bg-status-warning" },
  dormant: { label: "Dormant", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

const NEXT_MOVE: Record<PageNextMove, { label: string; color: string }> = {
  double_down: { label: "Doing well", color: "text-status-success" },
  review_signals: { label: "Needs review", color: "text-status-warning" },
  strengthen_evidence: { label: "Needs stronger content", color: "text-accent-primary" },
  wait: { label: "Watch", color: "text-muted-foreground" },
  no_action: { label: "OK", color: "text-muted-foreground" },
};

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  homepage: "Homepage", city_page: "City", service_page: "Service",
  project_page: "Project", directory_profile: "Directory", other: "Page",
};

const STATUS_BADGE: Record<string, { label: string; dot: string }> = {
  new: { label: "New", dot: "bg-status-danger" },
  handed_off: { label: "Handed off", dot: "bg-status-warning" },
  in_progress: { label: "In progress", dot: "bg-accent-primary" },
  shipped: { label: "Shipped", dot: "bg-accent-primary" },
  verified: { label: "Verified", dot: "bg-status-success" },
  not_fixed: { label: "Not fixed", dot: "bg-status-danger" },
  dismissed: { label: "Dismissed", dot: "bg-muted-foreground/40" },
};

type FilterView = "fix" | "winning" | "watch" | "all";

// ── Main Component ──

export function PagesClient({
  rows,
  staleRows = [],
  lastScanAt,
  latestObservationRunId = null,
  onScan,
  onVerify,
  onUpdateIssue,
  onVerifyIssue,
  onGenerateHandoff,
  onConvertBrief,
  onRefreshOutcome,
  onHandOffWave,
  onDismissWave,
}: {
  rows: PageRow[];
  staleRows?: PageRow[];
  lastScanAt?: string | null;
  /** Newest website crawl ObservationRun id (global), for drill-down from the workbench chrome. */
  latestObservationRunId?: string | null;
  onScan?: () => Promise<{ success: boolean; pagesScanned?: number; pagesChanged?: number; alertCount?: number; error?: string }>;
  onVerify?: (url: string) => Promise<{ success: boolean; cleared: string[]; remaining: string[]; diff: { changed: boolean; summary: string } | null; error?: string }>;
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

  return (
    <div>
      {/* Top bar: scan + view tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {onScan && (
          <button
            onClick={() => startScanTransition(async () => { await onScan(); })}
            disabled={scanPending}
            className={cn("px-3 py-1 rounded-md text-[10px] font-semibold border transition-colors shrink-0", scanPending ? "border-border text-muted-foreground opacity-50" : "border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10")}
          >
            {scanPending ? "Scanning…" : "Scan now"}
          </button>
        )}
        {lastScanAt && (
          <span className="text-[9px] text-muted-foreground/50 shrink-0 flex items-center gap-2 flex-wrap">
            <span>
              Last crawl:{" "}
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
                Run detail
              </Link>
            )}
          </span>
        )}
        <span className="flex-1" />
        {(["fix", "winning", "watch", "all"] as const).map((v) =>
          vc[v] > 0 || v === "all" ? (
            <button key={v} onClick={() => { setView(v); const first = (v === "fix" ? fixRows : v === "winning" ? winningRows : v === "watch" ? watchRows : rows)[0]; if (first) setSelectedId(first.id); }}
              className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors", view === v ? "bg-surface-inset text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "fix" ? "Fix now" : v === "winning" ? "Winning" : v === "watch" ? "Watch" : "All"} ({vc[v]})
            </button>
          ) : null
        )}
      </div>

      {/* Split workbench: queue left, detail right */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        {/* Left: Queue */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-surface-raised px-3 py-2 border-b border-border">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pages ({filtered.length})
            </p>
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto divide-y divide-border">
            {filtered.map((row) => {
              const sc = STATUS_CONFIG[row.status];
              const isSelected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  data-page-id={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-b-0",
                    isSelected
                      ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary"
                      : "hover:bg-surface-inset/60 border-l-[3px] border-l-transparent"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", sc.dot)} />
                    {row.fixBriefs.length > 0 && (
                      <span className="text-[8px] font-bold text-status-danger uppercase">{row.fixBriefs.length} issue{row.fixBriefs.length !== 1 ? "s" : ""}</span>
                    )}
                    {row.fixBriefs.length === 0 && (
                      <span className={cn("text-[8px] font-semibold uppercase tracking-wider", sc.color)}>{sc.label}</span>
                    )}
                  </div>
                  <p className="text-[11px] font-medium truncate">{row.label}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[9px] text-muted-foreground">
                    {row.totalCitations > 0 && <span className="tabular-nums">{row.totalCitations} tracked mentions</span>}
                    <span className={cn("font-medium", NEXT_MOVE[row.nextMove].color)}>{NEXT_MOVE[row.nextMove].label}</span>
                    {row.waveId && <span className="text-muted-foreground/80">● rollout plan</span>}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-[11px] text-muted-foreground py-6 text-center">No pages in this view</p>
            )}
          </div>
        </div>

          {/* Right: Simplified detail */}
        <div className="rounded-lg border border-border overflow-hidden bg-background">
          {selected ? (
            <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
              {/* Header */}
              <div className="px-6 pt-5 pb-4 border-b border-border/40">
                <h3 className="text-[15px] font-semibold tracking-tight mb-1">{selected.label}</h3>
                <p className="text-[10px] text-muted-foreground font-mono">{selected.url}</p>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Issue lineage — evidence classes */}
                {(selected.fixBriefs.length > 0 || selected.playbookBriefs.length > 0) && (
                  <div className="rounded-md border border-border bg-surface-inset/40 px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Evidence mix on this page
                    </p>
                    <dl className="grid grid-cols-1 gap-1 text-[10px] text-muted-foreground">
                      <div>
                        <dt className="inline font-medium text-foreground">Observed (scanner)</dt>
                        <dd className="inline">
                          {" "}
                          {selected.guardrails.length > 0
                            ? selected.guardrails
                                .map((g) =>
                                  g.observationRunId
                                    ? g.category
                                    : `${g.category} (run not stamped)`
                                )
                                .join(", ")
                            : selected.fixBriefs.length > 0
                              ? "Issue tied to scan pipeline (see alert-derived brief)."
                              : "None flagged."}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Inferred (playbook)</dt>
                        <dd className="inline">
                          {" "}
                          {selected.playbookBriefs.length > 0
                            ? "Yes — citation/pattern gap suggestions below."
                            : "No playbook row for this page."}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Changelog expectation</dt>
                        <dd className="inline">
                          {" "}
                          {selected.fixBriefs[0]?.intentConflict
                            ? `Mismatch — ${selected.fixBriefs[0].intentDetail ?? "logged change does not match live signals."}`
                            : "No conflict surfaced between changelog and scan."}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Ship / verify</dt>
                        <dd className="inline">
                          {" "}
                          {selected.fixBriefs[0]
                            ? `${selected.fixBriefs[0].issueStatus.replace(/_/g, " ")}${selected.fixBriefs[0].issueStatus === "verified" ? " (checklist passed — not AI outcome proof)" : ""}`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed border-t border-border/40 pt-2">
                      {selected.snapshot?.observationRunId ? (
                        <>
                          Snapshot from{" "}
                          <Link
                            href={`/observations/${encodeURIComponent(selected.snapshot.observationRunId)}`}
                            className="text-accent-primary hover:underline font-medium"
                          >
                            this ObservationRun
                          </Link>
                          .
                        </>
                      ) : selected.snapshot ? (
                        <>
                          Snapshot on file —{" "}
                          <span className="text-muted-foreground/90">
                            no ObservationRun id on this URL (legacy import or pre-spine crawl).
                          </span>
                        </>
                      ) : (
                        <>No snapshot for this URL — not observed in on-disk crawl data.</>
                      )}
                    </p>
                  </div>
                )}
                {selected.fixBriefs.length === 0 &&
                  selected.playbookBriefs.length === 0 &&
                  !selected.snapshot && (
                    <p className="text-[10px] text-muted-foreground border border-dashed border-border rounded-md px-2 py-1.5">
                      Not checked yet — no snapshot or issue row. Run scan from Your Website when ready.
                    </p>
                  )}
                {/* Simple summary */}
                {selected.fixBriefs.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-foreground mb-1">What needs fixing</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {selected.fixBriefs[0].issueSummary.replace(/citation/gi, "tracked mention").replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data")}
                    </p>
                  </div>
                )}
                {selected.fixBriefs.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-foreground mb-1">Why it matters</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {selected.totalCitations > 0
                        ? `We see ${selected.totalCitations} tracked mention${selected.totalCitations !== 1 ? "s" : ""} of this page in the sample, but it's missing content that would strengthen how it shows up.`
                        : "Competitors with stronger page content are showing up more in the tracked sample."}
                    </p>
                  </div>
                )}
                {selected.fixBriefs.length > 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-foreground mb-1">What to do</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {selected.fixBriefs[0].bestNextMove.replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data").replace(/JSON-LD/g, "page details")}
                    </p>
                  </div>
                )}
                {selected.playbookBriefs.length > 0 && selected.fixBriefs.length === 0 && (
                  <div>
                    <p className="text-[12px] font-semibold text-foreground mb-1">How to make this page stronger</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {selected.playbookBriefs[0].rationale.replace(/citation/gi, "tracked mention").replace(/FAQ/g, "Q&A").replace(/schema/g, "structured data")}
                    </p>
                  </div>
                )}
                {selected.fixBriefs.length === 0 && selected.playbookBriefs.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">This page looks good. No issues found.</p>
                )}

                {/* Primary actions */}
                <div className="flex items-center gap-2 flex-wrap">
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
                      className="px-4 py-2 rounded-md bg-accent-primary text-white text-[11px] font-semibold hover:bg-accent-primary/90 transition-colors"
                    >
                      {copiedId ? "Sent ✓" : "Send to developer"}
                    </button>
                  )}
                  {selected.fixBriefs.length > 0 && (selected.fixBriefs[0].issueStatus === "handed_off" || selected.fixBriefs[0].issueStatus === "in_progress") && onUpdateIssue && (
                    <button onClick={() => startIssueTransition(async () => { await onUpdateIssue(selected.fixBriefs[0].issueId, "shipped", { pageUrl: selected.url, pagePath: selected.path }); })} disabled={issuePending} className="px-4 py-2 rounded-md border border-accent-primary/30 text-accent-primary text-[11px] font-semibold hover:bg-accent-primary/10 transition-colors">Changes are live</button>
                  )}
                  {selected.fixBriefs.length > 0 && (selected.fixBriefs[0].issueStatus === "shipped" || selected.fixBriefs[0].issueStatus === "not_fixed") && onVerifyIssue && (
                    <button onClick={() => startIssueTransition(async () => { await onVerifyIssue(selected.fixBriefs[0].issueId, selected.url); })} disabled={issuePending} className="px-4 py-2 rounded-md border border-status-success/30 text-status-success text-[11px] font-semibold hover:bg-status-success/10 transition-colors">{issuePending ? "Checking…" : "Check if it worked"}</button>
                  )}
                  {selected.fixBriefs.length > 0 && selected.fixBriefs[0].issueStatus === "verified" && (
                    <span className="text-[11px] text-status-success font-semibold">✓ Confirmed working</span>
                  )}
                  {copiedId && <span className="text-[10px] text-muted-foreground">Copied to clipboard</span>}
                  {verifyMsg && <span className="text-[10px] text-muted-foreground">{verifyMsg}</span>}
                </div>

                {/* Log as tracked change */}
                {selected.fixBriefs.length > 0 && (
                  <Link
                    href={`/changes?page=${encodeURIComponent(selected.url)}&city=${encodeURIComponent(selected.city ?? "")}&topic=${encodeURIComponent(selected.topics[0] ?? "")}`}
                    className="text-[10px] text-accent-primary hover:underline font-medium"
                  >
                    Log this as a tracked change →
                  </Link>
                )}

                {/* Show details — everything else collapsed */}
                <details className="group">
                  <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground font-medium">Show details</summary>
                  <div className="mt-4 space-y-5">

                {/* Wave panel */}
                {selected.wave && (
                  <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.02] px-4 py-3 text-[10px]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground bg-surface-inset px-1.5 py-0.5 rounded border border-border">Rollout plan</span>
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
                              {fb.intentConflict && <span className="text-[8px] font-bold uppercase text-status-danger bg-status-danger/10 px-1.5 py-0.5 rounded">Intent conflict</span>}
                              <span className="inline-flex items-center gap-1">
                                <span className={cn("h-1.5 w-1.5 rounded-full", sb.dot)} />
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{sb.label}</span>
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                              <p className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Expected</p>
                              {fb.expectedState.map((s, i) => <p key={i} className="text-muted-foreground leading-relaxed">{s}</p>)}
                            </div>
                            <div>
                              <p className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Observed</p>
                              {fb.observedState.map((s, i) => <p key={i} className="text-muted-foreground leading-relaxed">{s}</p>)}
                            </div>
                          </div>

                          <div className="mb-3">
                            <p className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Likely causes</p>
                            {fb.likelyCauses.slice(0, 3).map((c, i) => (
                              <p key={i} className="text-muted-foreground flex gap-1.5"><span className="text-muted-foreground/40 shrink-0">→</span>{c}</p>
                            ))}
                          </div>

                          <div className="rounded bg-surface-inset/70 px-3 py-2 mb-3">
                            <p className="text-[8px] font-semibold uppercase tracking-wider text-accent-primary mb-1">Best next move</p>
                            <p className="text-foreground font-medium leading-relaxed">{fb.bestNextMove}</p>
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
                                  Legacy verify — exact fetch ObservationRun not recorded.
                                </span>
                              )}
                              {fb.verificationObservationRunId && (
                                <span className="text-[9px] text-muted-foreground block mt-1">
                                  Verify fetch:{" "}
                                  <Link
                                    href={`/observations/${encodeURIComponent(fb.verificationObservationRunId)}`}
                                    className="text-accent-primary hover:underline font-medium"
                                  >
                                    ObservationRun
                                  </Link>
                                  {fb.verificationBaselineObservationRunId ? (
                                    <>
                                      {" "}
                                      · prior crawl:{" "}
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
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
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
                            <span className={cn("text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", pb.type === "growth" ? "bg-status-success/10 text-status-success" : "bg-accent-primary/10 text-accent-primary")}>
                              {pb.type === "growth" ? "Growth" : "Fix"}
                            </span>
                            <p className="text-[12px] font-semibold text-foreground flex-1">{pb.title}</p>
                            {statusLabel && (
                              <span className={cn("text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", pb.rolloutStatus === "verified" ? "bg-status-success/10 text-status-success" : pb.rolloutStatus === "shipped" ? "bg-accent-primary/10 text-accent-primary" : "bg-surface-inset text-muted-foreground")}>
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
                            <p className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Steps</p>
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
                                <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Outcome watch</span>
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
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {selected.changes.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Linked changes</p>
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
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Outcome events</p>
                        <div className="space-y-0.5">
                          {selected.events.map((e) => (
                            <Link key={e.id} href={`/results/${e.anchorResultId}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors text-[10px]">
                              <span className="truncate flex-1">{e.topic}</span>
                              {e.isDecided ? <span className="text-status-success text-[9px] font-medium">Decided</span> : <span className="text-muted-foreground text-[9px]">Open</span>}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Next move footer */}
                <div className="flex items-center gap-3 pt-2 border-t border-border/50">
                  <p className={cn("text-[10px] font-semibold", NEXT_MOVE[selected.nextMove].color)}>
                    {NEXT_MOVE[selected.nextMove].label}
                  </p>
                  <p className="text-[9px] text-muted-foreground">{selected.nextMoveDetail}</p>
                  {selected.bestChangeId && (
                    <Link href={`/changes/${selected.bestChangeId}`} className="ml-auto text-[10px] text-accent-primary hover:underline font-medium">View change →</Link>
                  )}
                </div>

                  </div>{/* end details content */}
                </details>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-[12px] text-muted-foreground">
              Select a page to inspect
            </div>
          )}
        </div>
      </div>

      {/* Stale pages */}
      {staleRows.length > 0 && (
        <details className="mt-6">
          <summary className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 cursor-pointer hover:text-muted-foreground">
            Older / non-sitemap pages ({staleRows.length})
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
