"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TodaySummary } from "@/lib/today-summary";
import type { ChangeVerdict, ImpactConfidence, ImpactDirection } from "@/domains/attribution/types";

export type TodayImpactItem = {
  changeId: string;
  assetName: string;
  verdict: ChangeVerdict;
  confidence: ImpactConfidence;
  direction: ImpactDirection;
  nextAction: string;
  topScore: number | null;
  totalEvents: number;
  platforms: string[];
  href: string;
};

export type TodayQueueItem = {
  id: string;
  group: "fix" | "ship" | "frontier" | "verify" | "review" | "waiting" | "wins";
  plainGroup?: "fix_this" | "in_progress" | "wins";
  label: string;
  meta: string;
  href: string;
  dot: string;
  detail: string;
  issueId?: string;
  issueStatus?: string;
  pageUrl?: string;
  pagePath?: string;
  observationRunId?: string | null;
  observationRunHref?: string | null;
};

const GROUP_CONFIG: Record<string, { label: string; order: number }> = {
  fix_this: { label: "Queue", order: 0 },
  in_progress: { label: "In progress", order: 1 },
  wins: { label: "FYI", order: 2 },
};

function formatScanTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TodayClient({
  summary,
  items,
  impactSignals = [],
  onUpdateIssue,
  onVerifyIssue,
}: {
  summary: TodaySummary;
  items: TodayQueueItem[];
  impactSignals?: TodayImpactItem[];
  onUpdateIssue?: (
    issueId: string,
    status: string,
    meta?: { pageUrl?: string; pagePath?: string }
  ) => Promise<{ success: boolean }>;
  onVerifyIssue?: (
    issueId: string,
    pageUrl: string
  ) => Promise<{
    success: boolean;
    cleared: boolean;
    remaining: string[];
    summary: string;
    error?: string;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const groups = Object.entries(GROUP_CONFIG)
    .map(([key, cfg]) => ({
      key,
      label: cfg.label,
      order: cfg.order,
      items: items.filter((i) => (i.plainGroup ?? "fix_this") === key),
    }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.order - b.order);

  const flatItems = groups.flatMap((g) => g.items);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = flatItems[selectedIdx] ?? null;
  const queueWork = items.filter(
    (i) => i.plainGroup !== "wins" && i.group !== "waiting"
  ).length;

  const flatItemsRef = useRef(flatItems);
  const selectedIdxRef = useRef(selectedIdx);
  useEffect(() => {
    flatItemsRef.current = flatItems;
    selectedIdxRef.current = selectedIdx;
  }, [flatItems, selectedIdx]);

  useEffect(() => {
    const url = selectedIdx > 0 ? `/?i=${selectedIdx}` : "/";
    window.history.replaceState(null, "", url);
  }, [selectedIdx]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      const len = flatItemsRef.current.length;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, len - 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const sel = flatItemsRef.current[selectedIdxRef.current];
        if (sel) {
          e.preventDefault();
          router.push(sel.href);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  useEffect(() => {
    const el = document.querySelector(`[data-today-idx="${selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const crawl = summary.crawl;
  const vis = summary.visibility;
  const run = crawl.activeObservationRun;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">Today</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Two observation systems: website crawl (HTML truth) and visibility sample (imported citation / mention rollup). Review queue is separate.
        </p>
      </div>

      {/* Crawl observation */}
      <div className="rounded-lg border border-border bg-surface-raised/40 p-4 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Website crawl (operational)
        </p>
        {crawl.hasObservationFile && run ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
            <div>
              <p className="text-muted-foreground">Last completed</p>
              <p className="font-medium tabular-nums">
                {formatScanTime(run.completed_at)}
              </p>
              {crawl.activeObservationHref && (
                <Link
                  href={crawl.activeObservationHref}
                  className="text-[10px] text-accent-primary hover:underline font-medium mt-1 inline-block"
                >
                  Open crawl run →
                </Link>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Pages scanned</p>
              <p className="font-medium tabular-nums">{run.pages_scanned}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Changed vs prior crawl</p>
              <p className="font-medium tabular-nums">
                {crawl.deltaVsPrior
                  ? `${run.pages_changed} (Δ ${crawl.deltaVsPrior.pagesChanged >= 0 ? "+" : ""}${crawl.deltaVsPrior.pagesChanged})`
                  : String(run.pages_changed)}
              </p>
              {crawl.priorCompletedAt && (
                <p className="text-[9px] text-muted-foreground/80 mt-0.5">
                  Prior crawl: {formatScanTime(crawl.priorCompletedAt)}
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Errors / guardrails</p>
              <p className="font-medium tabular-nums">
                {run.pages_with_errors} err · {run.guardrail_alerts} alerts
                {crawl.deltaVsPrior
                  ? ` (alerts Δ ${crawl.deltaVsPrior.guardrailAlerts >= 0 ? "+" : ""}${crawl.deltaVsPrior.guardrailAlerts})`
                  : ""}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Not observed yet — no website crawl ObservationRun on file. Run a scan from Your Website.
          </p>
        )}
      </div>

      {/* Visibility observation */}
      <div className="rounded-lg border border-border bg-surface-raised/40 p-4 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Visibility sample (import / rollup)
        </p>
        {vis.hasObservationFile && vis.activeObservationRun ? (
          <div className="space-y-2 text-[11px]">
            <p className="text-muted-foreground leading-relaxed">
              {vis.activeObservationRun.scope_label}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-muted-foreground">
              <span>Topics: {vis.activeObservationRun.counts.topic_buckets}</span>
              <span>Rollup rows: {vis.activeObservationRun.counts.page_topic_rollup_rows}</span>
              <span>Citations counted: {vis.activeObservationRun.counts.total_citations_accounted}</span>
              <span>Ext. domains (sample): {vis.activeObservationRun.counts.distinct_external_domains_sampled}</span>
            </div>
            {vis.activeObservationRun.is_synthetic_wrapper && (
              <p className="text-[10px] text-muted-foreground/90">
                Wrapper synthesized from citation-evidence-index — not a separate nightly prompt job unless you add `visibility-observation-runs.json`.
              </p>
            )}
            {vis.staleVsCrawl && vis.staleNote && (
              <p className="text-[10px] text-status-warning font-medium">{vis.staleNote}</p>
            )}
            {vis.activeObservationHref && (
              <Link
                href={vis.activeObservationHref}
                className="text-[10px] text-accent-primary hover:underline font-medium inline-block"
              >
                Open visibility ObservationRun →
              </Link>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No visibility ObservationRun — citation-evidence-index not loaded. Gap ledger competitor lines are weaker.
          </p>
        )}
        {summary.competitorLine && (
          <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-2">
            {summary.competitorLine}
          </p>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
        <span className="font-semibold text-foreground">Review / attribution: </span>
        {summary.reviewHeuristicLine}
      </p>

      {/* Verified */}
      {summary.verifiedFixes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Recently verified (ship checks)
          </p>
          <ul className="space-y-1">
            {summary.verifiedFixes.map((v) => (
              <li key={v.issueId}>
                <Link
                  href={v.href}
                  className="text-[11px] text-accent-primary hover:underline"
                >
                  {v.pagePath}
                </Link>
                <span className="text-[10px] text-muted-foreground ml-2">
                  {v.summary.slice(0, 120)}
                  {v.summary.length > 120 ? "…" : ""}
                </span>
                {v.verificationBindingLegacy && (
                  <span className="text-[10px] text-muted-foreground/80 ml-2">
                    · legacy verify (exact fetch run not recorded)
                  </span>
                )}
                {v.verificationObservationRunId && (
                  <span className="text-[10px] text-muted-foreground/80 ml-2 block sm:inline sm:ml-2 mt-0.5 sm:mt-0">
                    · verify fetch{" "}
                    <Link
                      href={`/observations/${encodeURIComponent(v.verificationObservationRunId)}`}
                      className="text-accent-primary hover:underline"
                    >
                      ObservationRun
                    </Link>
                  </span>
                )}
                {v.verificationBaselineObservationRunId && (
                  <span className="text-[10px] text-muted-foreground/80 ml-2 block sm:inline sm:ml-2">
                    · prior crawl{" "}
                    <Link
                      href={`/observations/${encodeURIComponent(v.verificationBaselineObservationRunId)}`}
                      className="text-accent-primary hover:underline"
                    >
                      baseline
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next best move */}
      <div className="rounded-lg border border-accent-primary/25 bg-accent-primary/5 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Next best move
        </p>
        <p className="text-[14px] font-semibold">{summary.nextMove.title}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-2">
          Evidence scope: {summary.nextMove.evidenceScope.replace(/_/g, " ")}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          {summary.nextMove.evidence}
        </p>
        {summary.nextMove.observationRunId &&
          (summary.nextMove.evidenceScope === "crawl" ||
            summary.nextMove.evidenceScope === "mixed") && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Related crawl context:{" "}
            <Link
              href={`/observations/${encodeURIComponent(summary.nextMove.observationRunId)}`}
              className="text-accent-primary hover:underline font-medium"
            >
              ObservationRun
            </Link>
          </p>
        )}
        <Link
          href={summary.nextMove.href}
          className="inline-flex mt-3 items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[11px] font-semibold text-background hover:opacity-90"
        >
          Go
          <span className="opacity-60">→</span>
        </Link>
      </div>

      {/* Impact signals from Change Impact Engine */}
      {impactSignals.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Change impact signals ({impactSignals.length})
          </p>
          <div className="space-y-2">
            {impactSignals.map((s) => (
              <Link
                key={s.changeId}
                href={s.href}
                className={cn(
                  "block rounded-lg border px-4 py-3 hover:bg-surface-inset/50 transition-colors",
                  s.verdict === "validated"
                    ? "border-status-success/30 bg-status-success/5"
                    : s.verdict === "negative"
                      ? "border-status-danger/30 bg-status-danger/5"
                      : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        s.verdict === "validated" ? "bg-status-success"
                          : s.verdict === "negative" ? "bg-status-danger"
                          : s.verdict === "partial" ? "bg-status-warning"
                          : "bg-muted-foreground",
                      )} />
                      <span className="text-[12px] font-medium truncate">
                        {s.assetName}
                      </span>
                      <span className={cn(
                        "text-[9px] font-semibold uppercase tracking-wider shrink-0",
                        s.confidence === "high" ? "text-status-success"
                          : s.confidence === "medium" ? "text-status-warning"
                          : "text-muted-foreground",
                      )}>
                        {s.confidence}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {s.nextAction}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.topScore != null && (
                      <span className="text-[14px] font-semibold tabular-nums">
                        {Math.round(s.topScore)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {s.totalEvents} event{s.totalEvents !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-2 text-right">
            <Link
              href="/changes"
              className="text-[10px] text-accent-primary hover:underline font-medium"
            >
              All changes →
            </Link>
          </div>
        </div>
      )}

      {/* Work queue */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Work queue {queueWork > 0 ? `(${queueWork})` : ""}
        </p>
        {flatItems.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
            <div className="rounded-lg border border-border overflow-hidden bg-background">
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.key}>
                    <div className="px-3 py-1.5 border-b border-border/60">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        {group.label}
                      </p>
                    </div>
                    {group.items.map((item) => {
                      const idx = flatItems.indexOf(item);
                      return (
                        <button
                          key={item.id}
                          data-today-idx={idx}
                          onClick={() => {
                            setSelectedIdx(idx);
                            setActionMsg(null);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-b-0",
                            idx === selectedIdx
                              ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary"
                              : "hover:bg-surface-inset/60 border-l-[3px] border-l-transparent"
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "h-[6px] w-[6px] rounded-full shrink-0",
                                item.dot
                              )}
                            />
                            <p className="text-[11px] font-semibold truncate">
                              {item.label}
                            </p>
                          </div>
                          <p className="text-[9px] text-muted-foreground/70 truncate mt-0.5 ml-[18px]">
                            {item.meta}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden bg-background">
              {selected ? (
                <div className="overflow-y-auto max-h-[calc(100vh-320px)]">
                  <div className="px-6 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          selected.dot
                        )}
                      />
                      <h3 className="text-[15px] font-semibold tracking-tight">
                        {selected.label}
                      </h3>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70">
                      {selected.meta}
                    </p>
                  </div>
                  <div className="px-6 py-5 space-y-5">
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {selected.detail}
                    </p>
                    {selected.observationRunHref && (
                      <p className="text-[10px] text-muted-foreground">
                        Evidence run:{" "}
                        <Link
                          href={selected.observationRunHref}
                          className="text-accent-primary hover:underline font-medium"
                        >
                          Open ObservationRun
                        </Link>
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={selected.href}
                        className="inline-flex items-center gap-2 rounded-md bg-accent-primary px-4 py-2 text-[11px] font-semibold text-white hover:bg-accent-primary/90 transition-colors"
                      >
                        {(selected.plainGroup ?? "fix_this") === "fix_this"
                          ? "Open"
                          : selected.plainGroup === "in_progress"
                            ? "Check status"
                            : "View"}
                        <span className="text-white/60">→</span>
                      </Link>
                      {selected.issueId &&
                        selected.issueStatus === "new" &&
                        onUpdateIssue && (
                          <button
                            onClick={() =>
                              startTransition(async () => {
                                await onUpdateIssue(
                                  selected.issueId!,
                                  "dismissed",
                                  {
                                    pageUrl: selected.pageUrl,
                                    pagePath: selected.pagePath,
                                  }
                                );
                                setActionMsg("Dismissed");
                              })
                            }
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors"
                          >
                            Dismiss
                          </button>
                        )}
                      {selected.issueId &&
                        (selected.issueStatus === "handed_off" ||
                          selected.issueStatus === "in_progress") &&
                        onUpdateIssue && (
                          <button
                            onClick={() =>
                              startTransition(async () => {
                                await onUpdateIssue(
                                  selected.issueId!,
                                  "shipped",
                                  {
                                    pageUrl: selected.pageUrl,
                                    pagePath: selected.pagePath,
                                  }
                                );
                                setActionMsg("Updated");
                              })
                            }
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-accent-primary/30 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/10 transition-colors"
                          >
                            Mark shipped
                          </button>
                        )}
                      {selected.issueId &&
                        (selected.issueStatus === "shipped" ||
                          selected.issueStatus === "not_fixed") &&
                        selected.pageUrl &&
                        onVerifyIssue && (
                          <button
                            onClick={() =>
                              startTransition(async () => {
                                const r = await onVerifyIssue(
                                  selected.issueId!,
                                  selected.pageUrl!
                                );
                                setActionMsg(
                                  r.success
                                    ? r.cleared
                                      ? "Working ✓"
                                      : r.summary
                                    : `Issue: ${r.error?.slice(0, 60)}`
                                );
                              })
                            }
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-status-success/30 text-[10px] font-semibold text-status-success hover:bg-status-success/10 transition-colors"
                          >
                            {pending ? "Checking…" : "Run ship verification"}
                          </button>
                        )}
                      {selected.issueId &&
                        (selected.issueStatus === "verified" ||
                          selected.issueStatus === "dismissed") &&
                        onUpdateIssue && (
                          <button
                            onClick={() =>
                              startTransition(async () => {
                                await onUpdateIssue(selected.issueId!, "new", {
                                  pageUrl: selected.pageUrl,
                                  pagePath: selected.pagePath,
                                });
                                setActionMsg("Re-opened");
                              })
                            }
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors"
                          >
                            Re-open
                          </button>
                        )}
                    </div>
                    {actionMsg && (
                      <p className="text-[10px] text-muted-foreground">
                        {actionMsg}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-[12px] text-muted-foreground/50">
                  Select an item ·{" "}
                  <span className="font-mono text-[10px] ml-1">j/k</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border p-8 text-center text-[12px] text-muted-foreground">
            Queue is empty. Use{" "}
            <Link href="/pages" className="text-accent-primary hover:underline">
              Website
            </Link>{" "}
            or{" "}
            <Link href="/topics" className="text-accent-primary hover:underline">
              Gap ledger
            </Link>
            .
          </div>
        )}
      </div>
    </div>
  );
}
