"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { STATUS_CONFIG, NEXT_MOVE } from "@/components/pages/page-row-card";
import type { PageRow } from "@/app/(shell)/pages/pages-client";

const STATUS_BADGE: Record<string, { label: string; dot: string }> = {
  new: { label: "Open", dot: "bg-status-danger" },
  handed_off: { label: "With dev", dot: "bg-status-warning" },
  in_progress: { label: "In progress", dot: "bg-accent-primary" },
  shipped: { label: "Live", dot: "bg-accent-primary" },
  verified: { label: "Checked", dot: "bg-status-success" },
  not_fixed: { label: "Still open", dot: "bg-status-danger" },
  dismissed: { label: "Dismissed", dot: "bg-muted-foreground/40" },
};

export type PagesSelectedDetailProps = {
  selected: PageRow;
  issuePending: boolean;
  startIssueTransition: (cb: () => void) => void;
  copiedId: string | null;
  setCopiedId: (id: string | null) => void;
  verifyMsg: string | null;
  setVerifyMsg: (msg: string | null) => void;
  onUpdateIssue?: (issueId: string, status: string, meta?: { pageUrl?: string; pagePath?: string; category?: string }) => Promise<{ success: boolean }>;
  onVerifyIssue?: (issueId: string, pageUrl: string) => Promise<{ success: boolean; cleared: boolean; remaining: string[]; summary: string; error?: string }>;
  onGenerateHandoff?: (issueId: string, brief: { issueSummary: string; pageUrl: string; pagePath: string; severity: string; citationCount: number; expectedState: string[]; observedState: string[]; likelyCauses: string[]; verificationChecklist: string[]; bestNextMove: string; intentConflict: boolean; intentDetail: string | null }) => Promise<{ success: boolean; text: string }>;
  onConvertBrief?: (briefId: string, briefTitle: string, briefType: "fix" | "growth", pageUrl: string, pagePath: string, sourcePatternId: string, copyHandoff?: boolean, spec?: { schemaPackage: string[]; faqCountTarget: number; wordCountTarget: number | null; internalLinkTarget: number | null; requiredElements: string[] }, gapTrigger?: string, recommendations?: string[], verificationChecklist?: string[]) => Promise<{ success: boolean; issueId: string; handoffText?: string }>;
  onRefreshOutcome?: (issueId: string, pageUrl: string) => Promise<{ success: boolean; summary: string }>;
  onHandOffWave?: (waveId: string) => Promise<{ success: boolean; handoffText: string }>;
  onDismissWave?: (waveId: string) => Promise<{ success: boolean }>;
};

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

export function PagesSelectedDetail({
  selected,
  issuePending,
  startIssueTransition,
  copiedId,
  setCopiedId,
  verifyMsg,
  setVerifyMsg,
  onUpdateIssue,
  onVerifyIssue,
  onGenerateHandoff,
  onConvertBrief,
  onRefreshOutcome,
  onHandOffWave,
  onDismissWave,
}: PagesSelectedDetailProps) {
  return (
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
                            <p className="text-[10px] font-medium text-muted-foreground mb-1">Likely correlates</p>
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
                            <Link key={e.id} href={`/settings/history/${e.anchorResultId}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-inset/50 transition-colors text-xs">
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

  );
}
