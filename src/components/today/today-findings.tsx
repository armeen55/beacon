"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  FINDING_TYPE_LABELS,
  FINDING_PRIORITY_LABELS,
  PROMOTION_STATUS_LABELS,
} from "@/domains/scanning/types";
import type { SerializedFinding } from "@/app/(shell)/today-shared-types";
import { isKeyboardTypingTarget } from "@/lib/keyboard-shortcut-scope";

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const PRIORITY_STYLE: Record<string, { badge: string; text: string }> = {
  critical: { badge: "bg-status-danger/10 text-status-danger border-status-danger/30", text: "text-status-danger" },
  important: { badge: "bg-status-warning/10 text-status-warning border-status-warning/30", text: "text-status-warning" },
  minor: { badge: "bg-muted/30 text-muted-foreground border-border/40", text: "text-muted-foreground" },
  informational: { badge: "bg-muted/20 text-muted-foreground/60 border-border/30", text: "text-muted-foreground/60" },
};

function FindingRow({
  finding,
  coverageState,
  onResolve,
  onPromote,
}: {
  finding: SerializedFinding;
  coverageState?: import("@/lib/coverage-state").CoverageState;
  onResolve?: (id: string, status: string, opts?: { resolutionNote?: string; suppressDays?: number }) => Promise<{ success: boolean; consequence?: string }>;
  onPromote?: (id: string, promotionStatus: string) => Promise<{ success: boolean }>;
}) {
  const [, startT] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const label = (FINDING_TYPE_LABELS as Record<string, string>)[finding.type] ?? finding.type;
  const ps = PRIORITY_STYLE[finding.priority] ?? PRIORITY_STYLE.minor;

  return (
    <div
      data-today-finding-row={finding.id}
      tabIndex={0}
      className="px-4 py-3 hover:bg-surface-inset/20 transition-colors outline-none focus-visible:bg-surface-inset/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary/45 rounded-none"
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const root = e.currentTarget;
        const firstBtn = root.querySelector<HTMLButtonElement>("button:not([disabled])");
        if (firstBtn) {
          e.preventDefault();
          firstBtn.click();
          return;
        }
        const firstLink = root.querySelector<HTMLAnchorElement>("a[href]");
        if (firstLink) {
          e.preventDefault();
          firstLink.click();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
          <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider leading-none", ps.badge)}>
            {(FINDING_PRIORITY_LABELS as Record<string, string>)[finding.priority] ?? "—"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium text-muted-foreground bg-surface-inset/60 rounded px-1.5 py-0.5">
              {label}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground truncate">{finding.pagePath}</span>
            {finding.citationCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60">{finding.citationCount} citations</span>
            )}
            {finding.isHomepage && (
              <span className="text-[9px] font-semibold text-accent-primary bg-accent-primary/10 rounded px-1.5 py-0.5">Homepage</span>
            )}
            {finding.contradictsChangelog && (
              <span className="text-[9px] font-semibold text-status-danger bg-status-danger/10 rounded px-1.5 py-0.5">Mismatch</span>
            )}
            {coverageState === "critical" && (
              <span className="text-[9px] text-status-danger/80">(no recent data)</span>
            )}
            {coverageState === "aging" && (
              <span className="text-[9px] text-muted-foreground/70">(data may be outdated)</span>
            )}
            <span className="text-[10px] text-muted-foreground/50 tabular-nums ml-auto shrink-0">
              {new Date(finding.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {" "}
              {new Date(finding.detectedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className="text-[12px] text-foreground mt-1 leading-snug">{finding.summary}</p>
          {finding.previousState && finding.currentState && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
              <span className="line-through truncate max-w-[40%]">{finding.previousState}</span>
              <span className="text-muted-foreground/40">→</span>
              <span className="font-medium text-foreground truncate max-w-[40%]">{finding.currentState}</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1">{finding.suggestedAction}</p>
          {!finding.provenanceSummary && !finding.scanRunId && (
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Observed in latest crawl · {relativeAge(finding.detectedAt)}
              {(coverageState === "stale" || coverageState === "critical" || coverageState === "aging") && (
                <span className="text-status-warning/70 ml-1">
                  {coverageState === "critical"
                    ? "(based on the last available crawl)"
                    : coverageState === "aging"
                      ? "(based on an earlier crawl)"
                      : "(based on an earlier crawl)"}
                </span>
              )}
            </p>
          )}
          {(finding.provenanceSummary || finding.scanRunId) && (
            <div className="mt-2 rounded border border-border/30 bg-surface-inset/25 px-2 py-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">Basis: </span>
              {finding.provenanceSummary ?? "Compared consecutive full-site crawls."}
              <span className="text-muted-foreground/60"> · Observed {relativeAge(finding.detectedAt)}</span>
              {finding.crawlProofHref ? (
                <>
                  {" "}
                  <Link href={finding.crawlProofHref} className="text-accent-primary hover:underline font-medium">
                    View observation →
                  </Link>
                </>
              ) : finding.scanRunId ? (
                <span className="block text-[9px] text-muted-foreground/65 mt-1 leading-snug">
                  No observation index entry for this batch yet (id below).
                </span>
              ) : null}
              {finding.scanRunId && (
                <span className="block font-mono text-[9px] text-muted-foreground/60 mt-0.5 truncate" title={finding.scanRunId}>
                  Batch: {finding.scanRunId}
                </span>
              )}
            </div>
          )}
          {feedback && (
            <p className="text-[10px] text-status-success mt-1.5 font-medium">{feedback}</p>
          )}
        </div>
      </div>

      {onResolve && finding.status === "pending" && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 ml-8">
          <button
            type="button"
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "accepted");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-status-success hover:text-status-success/80 transition-colors"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "expected", { suppressDays: 14 });
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground hover:text-muted-foreground/80 transition-colors"
          >
            Expected
          </button>
          <button
            type="button"
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "ignored");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Ignore
          </button>
          <button
            type="button"
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "rejected");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            Not real
          </button>
        </div>
      )}

      {finding.status === "accepted" && onPromote && finding.promotionStatus === "none" && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 ml-8">
          <span className="text-[10px] text-muted-foreground/60 mr-1">Promote:</span>
          <button
            type="button"
            onClick={() => startT(async () => {
              await onPromote(finding.id, "changelog");
              setFeedback("Promoted to changelog.");
            })}
            className="text-[11px] font-medium text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            Changelog
          </button>
          <button
            type="button"
            onClick={() => startT(async () => {
              await onPromote(finding.id, "secondary_note");
              setFeedback("Logged as secondary note.");
            })}
            className="text-[11px] font-medium text-muted-foreground hover:text-muted-foreground/80 transition-colors"
          >
            Secondary note
          </button>
          <button
            type="button"
            onClick={() => startT(async () => {
              await onPromote(finding.id, "history_only");
              setFeedback("Kept in history only.");
            })}
            className="text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            History only
          </button>
        </div>
      )}
      {finding.promotionStatus !== "none" && (
        <div className="flex items-center gap-2 mt-1.5 ml-8 text-[10px] text-muted-foreground/50">
          <span className="h-1 w-1 rounded-full bg-status-success/40" />
          {(PROMOTION_STATUS_LABELS as Record<string, string>)[finding.promotionStatus]}
        </div>
      )}
    </div>
  );
}

export type TodayFindingsProps = {
  pendingFindings: SerializedFinding[];
  resolvedFindingsCount: number;
  scanCompletedAt: string | null;
  crawlAgeDays: number | null;
  coverageState?: import("@/lib/coverage-state").CoverageState;
  /** Tier 1.1i — surfaced above the queue when critical/stale, or aging only if no higher-priority work. */
  coverageFindingsAttention?: import("@/lib/coverage-state").CoverageState | null;
  onResolveFinding?: (findingId: string, status: string, opts?: { resolutionNote?: string; suppressDays?: number }) => Promise<{ success: boolean; consequence?: string }>;
  onPromoteFinding?: (findingId: string, promotionStatus: string) => Promise<{ success: boolean }>;
  acceptedAwaitingPromotionCount: number;
  /** When true, do not show an “All clear” product label — diff queue is empty but data truth is still limited. */
  truthDataCompromised?: boolean;
  /** When visibility/coverage gate is on, empty-queue card reads clearly subordinate to stale truth. */
  staleTruthDominant?: boolean;
};

type FindingGroup = {
  key: string;
  label: string;
  findings: SerializedFinding[];
  accent: string;
  dot: string;
};

/** "Since last scan" — grouped findings with low-priority collapsed (Track 1.2). */
export function TodayFindings({
  pendingFindings,
  resolvedFindingsCount,
  scanCompletedAt,
  crawlAgeDays,
  coverageState,
  coverageFindingsAttention = null,
  onResolveFinding,
  onPromoteFinding,
  acceptedAwaitingPromotionCount,
  truthDataCompromised = false,
  staleTruthDominant = false,
}: TodayFindingsProps) {
  const [showLowPriority, setShowLowPriority] = useState(false);

  const { actionable, lowPriority, lowCount, hasCritical, headerText } = useMemo(() => {
    const critical = pendingFindings.filter((f) => f.priority === "critical");
    const important = pendingFindings.filter((f) => f.priority === "important");
    const minor = pendingFindings.filter((f) => f.priority === "minor");
    const info = pendingFindings.filter((f) => f.priority === "informational");

    const actionableGroups: FindingGroup[] = [
      { key: "critical", label: "Critical", findings: critical, accent: "text-status-danger", dot: "bg-status-danger" },
      { key: "important", label: "Important", findings: important, accent: "text-status-warning", dot: "bg-status-warning" },
    ].filter((g) => g.findings.length > 0);

    const lowGroups: FindingGroup[] = [
      { key: "minor", label: "Minor", findings: minor, accent: "text-muted-foreground", dot: "bg-muted-foreground/50" },
      { key: "informational", label: "FYI", findings: info, accent: "text-muted-foreground/60", dot: "bg-muted-foreground/30" },
    ].filter((g) => g.findings.length > 0);

    const _lowCount = minor.length + info.length;
    const _hasCritical = critical.length > 0;
    const actionableCount = critical.length + important.length;
    const _headerText = _hasCritical
      ? `${critical.length} critical issue${critical.length !== 1 ? "s" : ""} need attention`
      : important.length > 0
        ? `${actionableCount} finding${actionableCount !== 1 ? "s" : ""} need review`
        : `${pendingFindings.length} finding${pendingFindings.length !== 1 ? "s" : ""} since last scan`;

    return {
      actionable: actionableGroups,
      lowPriority: lowGroups,
      lowCount: _lowCount,
      hasCritical: _hasCritical,
      headerText: _headerText,
    };
  }, [pendingFindings]);

    const onlyLowPriority = actionable.length === 0 && lowCount > 0;

  const navigableRows = useMemo(() => {
    const out: SerializedFinding[] = [];
    for (const g of actionable) for (const f of g.findings) out.push(f);
    if (showLowPriority || onlyLowPriority) {
      for (const g of lowPriority) for (const f of g.findings) out.push(f);
    }
    return out;
  }, [actionable, lowPriority, showLowPriority, onlyLowPriority]);

  useEffect(() => {
    const ids = navigableRows.map((f) => f.id);
    if (ids.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isKeyboardTypingTarget(e.target)) return;
      const k = e.key;
      if (k !== "j" && k !== "J" && k !== "k" && k !== "K") return;

      const active = document.activeElement;
      const rowEl =
        active instanceof HTMLElement
          ? active.closest("[data-today-finding-row]")
          : null;
      const rowAttr =
        rowEl instanceof HTMLElement ? rowEl.getAttribute("data-today-finding-row") : null;
      let idx = rowAttr ? ids.indexOf(rowAttr) : -1;

      e.preventDefault();
      if (k === "j" || k === "J") {
        idx = idx < 0 ? 0 : Math.min(idx + 1, ids.length - 1);
      } else {
        idx = idx < 0 ? ids.length - 1 : Math.max(idx - 1, 0);
      }

      const id = ids[idx];
      const next = document.querySelector<HTMLElement>(
        `[data-today-finding-row="${CSS.escape(id)}"]`,
      );
      if (!next) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigableRows]);

  return (
    <>
      {pendingFindings.length === 0 && (
        <div
          className={cn(
            "rounded-lg overflow-hidden",
            staleTruthDominant
              ? "border-2 border-status-warning/40 bg-status-warning/[0.04]"
              : "border border-border/60",
          )}
        >
          <div
            className={cn(
              "px-4 py-3 flex items-center justify-between gap-3",
              staleTruthDominant ? "bg-status-warning/[0.06]" : "bg-surface-inset/20",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  truthDataCompromised || staleTruthDominant
                    ? staleTruthDominant
                      ? "bg-status-warning/70"
                      : "bg-muted-foreground/45"
                    : "bg-status-success",
                )}
              />
              <p className="text-[13px] font-semibold text-foreground">Since last scan</p>
              {truthDataCompromised || staleTruthDominant ? (
                <span className="text-[11px] text-muted-foreground font-medium">No pending diffs</span>
              ) : (
                <span className="text-[11px] text-status-success font-medium">All clear</span>
              )}
            </div>
            {scanCompletedAt && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {new Date(scanCompletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                {new Date(scanCompletedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                {crawlAgeDays !== null && crawlAgeDays > 0 && (
                  <span className="text-muted-foreground/60"> ({crawlAgeDays}d ago)</span>
                )}
              </span>
            )}
          </div>
          <div className="px-4 py-2.5 text-[12px] text-muted-foreground">
            Nothing changed since the last scan. All pages match their previous state.
            {resolvedFindingsCount > 0 && (
              <span className="ml-1 text-foreground font-medium">{resolvedFindingsCount} previously resolved.</span>
            )}
            {truthDataCompromised || staleTruthDominant ? (
              <span className="block mt-2 text-[11px] text-muted-foreground/85 leading-relaxed">
                {staleTruthDominant
                  ? "Visibility sample is still behind — refresh import before trusting recommendations. That is separate from “no diffs.” See coverage below."
                  : "Crawl or coverage is still limiting freshness — that is separate from “no diffs.” See coverage below."}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {pendingFindings.length > 0 && (
        <div
          id="today-findings"
          className={cn(
            "rounded-lg border-2 overflow-hidden",
            hasCritical ? "border-status-danger/40" : "border-border/70",
          )}
        >
          {coverageFindingsAttention && (
            <div
              className={cn(
                "px-4 py-2 border-b border-border/40 text-[11px] leading-relaxed",
                coverageFindingsAttention === "critical"
                  ? "bg-status-danger/[0.08] text-status-danger"
                  : coverageFindingsAttention === "stale"
                    ? "bg-status-warning/[0.06] text-status-warning"
                    : "bg-surface-inset/40 text-muted-foreground",
              )}
            >
              {coverageFindingsAttention === "critical" && "Findings reflect the last available crawl. Refresh to update."}
              {coverageFindingsAttention === "stale" && "Findings reflect an earlier crawl. Refresh to update."}
              {coverageFindingsAttention === "aging" && "Findings are nearing the freshness threshold. Refresh recommended."}
            </div>
          )}
          <div className={cn(
            "px-4 py-3 border-b border-border/40 flex items-center justify-between gap-3",
            hasCritical ? "bg-status-danger/[0.06]" : "bg-surface-inset/30",
          )}>
            <div className="flex items-center gap-2">
              <span className={cn(
                "h-2.5 w-2.5 rounded-full animate-pulse",
                hasCritical ? "bg-status-danger" : "bg-accent-primary",
              )} />
              <p className={cn(
                "text-[13px] font-bold",
                hasCritical ? "text-status-danger" : "text-foreground",
              )}>
                {headerText}
              </p>
            </div>
            {resolvedFindingsCount > 0 && (
              <span className="text-[10px] text-muted-foreground">{resolvedFindingsCount} resolved</span>
            )}
          </div>

          {/* Actionable findings (critical + important) — always expanded */}
          {actionable.map((g) => (
            <div key={g.key}>
              <div className="px-4 py-1.5 bg-surface-inset/10 border-b border-border/30 flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5 rounded-full", g.dot)} />
                <span className={cn("text-[10px] font-semibold uppercase tracking-wider", g.accent)}>
                  {g.label} · {g.findings.length}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {g.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} coverageState={coverageState} onResolve={onResolveFinding} onPromote={onPromoteFinding} />
                ))}
              </div>
            </div>
          ))}

          {/* Low-priority findings — collapsed unless they're the only findings */}
          {lowCount > 0 && !onlyLowPriority && !showLowPriority && (
            <button
              type="button"
              onClick={() => setShowLowPriority(true)}
              className="w-full px-4 py-2.5 text-[11px] text-muted-foreground hover:bg-surface-inset/20 transition-colors text-left border-t border-border/30"
            >
              <span className="tabular-nums font-medium text-foreground">{lowCount}</span>{" "}
              lower-priority item{lowCount !== 1 ? "s" : ""}{" "}
              <span className="text-accent-primary font-medium">→ Show</span>
            </button>
          )}
          {(showLowPriority || onlyLowPriority) && lowPriority.map((g) => (
            <div key={g.key}>
              <div className="px-4 py-1.5 bg-surface-inset/10 border-b border-border/30 flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5 rounded-full", g.dot)} />
                <span className={cn("text-[10px] font-semibold uppercase tracking-wider", g.accent)}>
                  {g.label} · {g.findings.length}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {g.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} coverageState={coverageState} onResolve={onResolveFinding} onPromote={onPromoteFinding} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {acceptedAwaitingPromotionCount > 0 && (
        <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
          <span className="tabular-nums font-medium text-foreground">
            {acceptedAwaitingPromotionCount}
          </span>{" "}
          accepted finding{acceptedAwaitingPromotionCount !== 1 ? "s" : ""} awaiting promotion —{" "}
          <Link href="/pages" className="text-accent-primary font-medium hover:underline">
            continue on Pages
          </Link>
          .
        </p>
      )}
    </>
  );
}
