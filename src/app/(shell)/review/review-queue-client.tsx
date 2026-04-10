"use client";

import { useState, useTransition, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Lock, ArrowRight, Zap, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { MatchFactors } from "@/components/display/match-factors";
import { lockDecision } from "@/domains/attribution/candidate-actions";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";
import type { Attribution, TruthRelation, CauseType, OperatorConfidence } from "@/domains/attribution/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { JudgmentSummary } from "@/domains/attribution/judgment";

export type Decisionability = "easy_call" | "good_candidate" | "ambiguous";

type CandidateItem = {
  change: {
    id: string;
    asset_name: string;
    signal_type: ChangelogEntry["signal_type"];
    timestamp: string;
    topic_targeted: string;
    change_description: string;
  };
  attribution: Attribution;
  score: number;
  triage?: "primary" | "contributing" | "needs_review" | "suppressed";
  triageReason?: string;
};

export type ReviewQueueItem = {
  eventId: string;
  anchorResultId: string;
  eventType: string;
  eventTypeLabel: string;
  eventTypeColor: string;
  platform: string;
  topic: string;
  triggerDate: string;
  description: string;
  reviewCount: number;
  totalCandidates: number;
  hasPrimary: boolean;
  candidates: CandidateItem[];
  truthLabelMap: Record<string, TruthRelation>;
  metricLabel: string;
  metricValue: number;
  delta: number | null;
  judgment: JudgmentSummary;
  decisionability: Decisionability;
  decisionabilityReason: string;
  scoreGap: number;
};

export type ResolvedItem = {
  eventId: string;
  anchorResultId: string;
  eventTypeLabel: string;
  eventTypeColor: string;
  topic: string;
  status: string;
  changeName: string | null;
  causeType: CauseType | null;
  operatorConfidence: OperatorConfidence | null;
};

const D_CONFIG: Record<Decisionability, { label: string; color: string; bg: string }> = {
  easy_call: { label: "Likely clear", color: "text-muted-foreground", bg: "bg-status-success/70" },
  good_candidate: { label: "Needs your read", color: "text-muted-foreground", bg: "bg-muted-foreground/45" },
  ambiguous: { label: "Tight race", color: "text-muted-foreground", bg: "bg-status-warning/60" },
};

export function InlineReviewQueue({
  items,
  resolvedItems,
  stats,
}: {
  items: ReviewQueueItem[];
  resolvedItems: ResolvedItem[];
  stats: {
    pending: number;
    noCandidates: number;
    confirmed: number;
    autoResolved: number;
    decided: number;
    easyCalls: number;
  };
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [decidedThisSession, setDecidedThisSession] = useState(0);
  const [showKeys, setShowKeys] = useState(false);

  const current = items[selectedIdx] ?? null;

  const advance = useCallback(() => {
    if (selectedIdx < items.length - 1) {
      setSelectedIdx((i) => i + 1);
    }
  }, [selectedIdx, items.length]);

  function handleDecided() {
    setDecidedThisSession((n) => n + 1);
    advance();
  }

  // Keyboard: ↑/↓ to navigate queue
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "?") {
        setShowKeys((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <ProgressBar decided={stats.decided} pending={0} sessionCount={decidedThisSession} easyCalls={0} />
        <div className="rounded-md border border-status-success/20 bg-status-success/5 p-8 text-center">
          <p className="text-[14px] font-medium text-status-success">You are caught up</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Every event has a decision locked. {decidedThisSession > 0 && `${decidedThisSession} decided this session.`}
          </p>
        </div>
        {resolvedItems.length > 0 && <ResolvedSection items={resolvedItems} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProgressBar
        decided={stats.decided + decidedThisSession}
        pending={stats.pending - decidedThisSession}
        sessionCount={decidedThisSession}
        easyCalls={stats.easyCalls}
      />

      {showKeys && <KeyboardHelp onClose={() => setShowKeys(false)} />}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Left: Queue */}
        <div className="rounded-lg border border-border/70 overflow-hidden bg-background">
          <div className="bg-surface-inset/30 px-3 py-2 border-b border-border/60 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Open items ({items.length})
            </p>
            <button
              onClick={() => setShowKeys((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-3 w-3" />
            </button>
          </div>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border/60">
            {items.map((item, idx) => {
              const dc = D_CONFIG[item.decisionability];
              return (
                <button
                  key={item.eventId}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors",
                    idx === selectedIdx
                      ? "bg-accent-primary/[0.07] border-l-[3px] border-l-accent-primary"
                      : "hover:bg-surface-inset/50 border-l-[3px] border-l-transparent"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dc.bg}`} />
                    <span className={`text-[9px] font-medium ${dc.color}`}>
                      {dc.label}
                    </span>
                  </div>
                  <p className="text-[12px] font-medium text-foreground truncate leading-snug">{item.topic}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-medium ${item.eventTypeColor}`}>
                      {item.eventTypeLabel}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{item.platform}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Sprint Decision Card */}
        {current && (
          <SprintDecisionCard
            key={current.eventId}
            item={current}
            position={selectedIdx + 1}
            total={items.length}
            onDecided={handleDecided}
            onSkip={advance}
          />
        )}
      </div>

      {resolvedItems.length > 0 && <ResolvedSection items={resolvedItems} />}
    </div>
  );
}

// ── Progress Bar ──

function ProgressBar({
  decided,
  pending,
  sessionCount,
  easyCalls,
}: {
  decided: number;
  pending: number;
  sessionCount: number;
  easyCalls: number;
}) {
  const total = decided + pending;
  const pct = total > 0 ? Math.round((decided / total) * 100) : 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            <span className="text-status-success font-semibold">{decided}</span> decided
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
            <span className="text-status-warning font-semibold">{pending}</span> remaining
          </span>
          {easyCalls > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Zap className="h-3 w-3 text-status-success/80" />
              <span className="font-medium text-foreground">{easyCalls} quick-clear</span>
            </span>
          )}
        </div>
        {sessionCount > 0 && (
          <span className="text-status-success font-semibold">
            +{sessionCount} this session
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-surface-inset overflow-hidden">
        <div
          className="h-full rounded-full bg-status-success transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Keyboard Help ──

function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3 text-[11px] text-muted-foreground">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-foreground text-[12px]">Keyboard Shortcuts</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <span><kbd className="kbd">1</kbd>–<kbd className="kbd">5</kbd> Select candidate</span>
        <span><kbd className="kbd">c</kbd> Competitor action</span>
        <span><kbd className="kbd">a</kbd> Platform / model</span>
        <span><kbd className="kbd">u</kbd> Can&apos;t tell yet</span>
        <span><kbd className="kbd">Enter</kbd> Save decision</span>
        <span><kbd className="kbd">→</kbd> Skip to next</span>
        <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> Navigate queue</span>
        <span><kbd className="kbd">?</kbd> Toggle this help</span>
      </div>
    </div>
  );
}

// ── Sprint Decision Card ──

function sortedActionableCandidates(item: ReviewQueueItem) {
  return item.candidates
    .filter(
      (c) =>
        c.triage === "primary" ||
        c.triage === "needs_review" ||
        c.triage === "contributing"
    )
    .sort((a, b) => b.score - a.score);
}

function SprintDecisionCard({
  item,
  position,
  total,
  onDecided,
  onSkip,
}: {
  item: ReviewQueueItem;
  position: number;
  total: number;
  onDecided: () => void;
  onSkip: () => void;
}) {
  const actionableCandidates = useMemo(
    () => sortedActionableCandidates(item),
    [item]
  );

  const [isPending, startTransition] = useTransition();
  const [selectedCause, setSelectedCause] = useState<CauseType | null>(() =>
    item.decisionability === "easy_call" ? "change" : null
  );
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(() => {
    if (item.decisionability !== "easy_call") return null;
    const ac = sortedActionableCandidates(item);
    return ac[0]?.change.id ?? null;
  });
  const [confidence, setConfidence] = useState<OperatorConfidence>("medium");
  const cardRef = useRef<HTMLDivElement>(null);

  const j = item.judgment;
  const dc = D_CONFIG[item.decisionability];

  const canLock = selectedCause !== null && (selectedCause !== "change" || selectedChangeId !== null);

  const handleLock = useCallback(() => {
    if (!canLock) return;
    startTransition(async () => {
      await lockDecision(
        item.eventId,
        item.anchorResultId,
        selectedCause!,
        selectedCause === "change" ? selectedChangeId : null,
        confidence,
        null,
        item.candidates.map((c) => c.change.id)
      );
      setSelectedCause(null);
      setSelectedChangeId(null);
      setConfidence("medium");
      onDecided();
    });
  }, [canLock, item, selectedCause, selectedChangeId, confidence, onDecided, startTransition]);

  // Keyboard: number keys for candidates, c/a/u for non-change, Enter to lock, → to skip
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (isPending) return;

      const numKey = parseInt(e.key);
      if (numKey >= 1 && numKey <= actionableCandidates.length) {
        e.preventDefault();
        setSelectedCause("change");
        setSelectedChangeId(actionableCandidates[numKey - 1].change.id);
        return;
      }

      switch (e.key) {
        case "c":
          e.preventDefault();
          setSelectedCause("competitor");
          setSelectedChangeId(null);
          break;
        case "a":
          e.preventDefault();
          setSelectedCause("algorithm");
          setSelectedChangeId(null);
          break;
        case "u":
          e.preventDefault();
          setSelectedCause("unknown");
          setSelectedChangeId(null);
          break;
        case "Enter":
          e.preventDefault();
          if (canLock) handleLock();
          break;
        case "ArrowRight":
          e.preventDefault();
          onSkip();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actionableCandidates, canLock, handleLock, onSkip, isPending]);

  const topScore = actionableCandidates.length > 0 ? actionableCandidates[0].score : 0;

  return (
    <div ref={cardRef} className={cn("space-y-3 transition-opacity", isPending && "opacity-40 pointer-events-none")}>
      {/* Header: judgment context */}
      <div className="rounded-lg border border-border/70 bg-surface-raised/30 p-4">
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Judgment</p>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-foreground leading-snug">{j.whatHappened}</p>
            {j.bestExplanation && (
              <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">{j.bestExplanation}</p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className={`inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-0.5 text-[10px] font-medium ${dc.color}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dc.bg}`} />
              {dc.label}
            </span>
          </div>
        </div>
        <details className="group/why mt-3 border-t border-border/40 pt-2">
          <summary className="cursor-pointer list-none text-[10px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <span className="text-[8px] text-muted-foreground/50 transition-transform group-open/why:rotate-90">▶</span>
            Why Beacon ordered it here
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">{item.decisionabilityReason}</p>
          {item.scoreGap > 0 && (
            <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
              Separation between top heuristic scores: ~{item.scoreGap} points (not a confidence score).
            </p>
          )}
        </details>
      </div>

      {/* Candidate comparison + quick select */}
      <div className="rounded-lg border border-accent-primary/25 bg-accent-primary/[0.04] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">What do you attribute this to?</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Pick the change that best explains the shift, or choose a non-change cause. Match scores rank heuristics only.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 font-medium">{position} / {total}</span>
        </div>

        {/* Change candidates with comparison */}
        <div className="space-y-1.5">
          {actionableCandidates.map((c, idx) => {
            const isSelected = selectedCause === "change" && selectedChangeId === c.change.id;
            const isTop = idx === 0;
            const scorePct = topScore > 0 ? Math.round((c.score / topScore) * 100) : 0;
            const tier = c.attribution.evidence_tier;
            const tierLabel =
              tier === "exact"
                ? "Tight match"
                : tier === "probable"
                  ? "Heuristic"
                  : tier === "weak"
                    ? "Low signal"
                    : "";

            return (
              <div
                key={c.change.id}
                className={cn(
                  "rounded-lg border transition-colors overflow-hidden",
                  isSelected
                    ? "border-accent-primary/50 bg-accent-primary/[0.06]"
                    : "border-border/70 hover:border-border"
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCause("change");
                    setSelectedChangeId(c.change.id);
                  }}
                  className="w-full text-left p-2.5 transition-colors hover:bg-surface-inset/40"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "shrink-0 w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center",
                        isSelected ? "bg-accent-primary text-background" : "bg-surface-inset text-muted-foreground"
                      )}
                    >
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-medium truncate">{c.change.asset_name}</p>
                        {isTop && actionableCandidates.length > 1 && (
                          <span className="shrink-0 text-[8px] font-medium text-muted-foreground bg-surface-inset/80 border border-border/60 px-1 py-0.5 rounded">
                            Leading match
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{c.change.change_description}</p>

                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold tabular-nums w-6 text-right">{Math.round(c.score)}</span>
                          <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                isTop ? "bg-accent-primary/70" : "bg-muted-foreground/40"
                              )}
                              style={{ width: `${scorePct}%` }}
                            />
                          </div>
                        </div>
                        {tierLabel && (
                          <span className="text-[9px] text-muted-foreground shrink-0">{tierLabel}</span>
                        )}
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          {SIGNAL_TYPE_LABELS[c.change.signal_type]}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                <details
                  className="group/mf border-t border-border/50 bg-surface-inset/20"
                  onClick={(e) => e.stopPropagation()}
                >
                  <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                    <span className="text-[8px] text-muted-foreground/50 transition-transform group-open/mf:rotate-90">▶</span>
                    Match factors
                  </summary>
                  <div className="px-2.5 pb-2">
                    <MatchFactors matches={c.attribution.matches} evidenceTier={c.attribution.evidence_tier} />
                  </div>
                </details>
              </div>
            );
          })}
        </div>

        {/* Quick non-change actions */}
        <div className="flex items-center gap-1.5 pt-1">
          <QuickCauseButton
            label="Competitor"
            hotkey="c"
            selected={selectedCause === "competitor"}
            onClick={() => { setSelectedCause("competitor"); setSelectedChangeId(null); }}
          />
          <QuickCauseButton
            label="Platform"
            hotkey="a"
            selected={selectedCause === "algorithm"}
            onClick={() => { setSelectedCause("algorithm"); setSelectedChangeId(null); }}
          />
          <QuickCauseButton
            label={"Can't tell"}
            hotkey="u"
            selected={selectedCause === "unknown"}
            onClick={() => { setSelectedCause("unknown"); setSelectedChangeId(null); }}
          />
          <div className="flex-1" />
          {/* Confidence quick toggle */}
          {selectedCause && (
            <div className="flex items-center gap-1">
                  {(["high", "medium", "low"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setConfidence(level)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                    confidence === level
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-inset"
                  )}
                >
                  {level === "high" ? "Confident" : level === "medium" ? "Balanced" : "Tentative"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lock + Skip row */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleLock}
            disabled={!canLock}
            className={cn(
              "flex-1 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold transition-colors justify-center",
              canLock
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Lock className="h-3.5 w-3.5" />
            Save decision
            {canLock && <span className="text-[10px] opacity-60 font-normal ml-1">↵</span>}
          </button>
          {position < total && (
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-surface-inset transition-colors"
            >
              Skip <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-start text-[11px] text-muted-foreground">
        <Link href={`/results/${item.anchorResultId}`} className="text-accent-primary font-medium hover:underline">
          Open full result →
        </Link>
      </div>
    </div>
  );
}

// ── Quick Cause Button ──

function QuickCauseButton({
  label,
  hotkey,
  selected,
  onClick,
}: {
  label: string;
  hotkey: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border px-2 py-1 text-[10px] font-medium transition-colors inline-flex items-center gap-1",
        selected
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-surface-inset"
      )}
    >
      {label}
      <kbd className="text-[8px] opacity-50">{hotkey}</kbd>
    </button>
  );
}

// ── Resolved Section ──

function ResolvedSection({ items }: { items: ResolvedItem[] }) {
  const CAUSE_LABELS: Record<CauseType, string> = {
    change: "Change",
    competitor: "Competitor",
    algorithm: "Algorithm",
    unknown: "Unknown",
  };
  const CONFIDENCE_LABELS: Record<OperatorConfidence, string> = {
    high: "high confidence",
    medium: "balanced",
    low: "tentative",
  };

  const operatorDecided = items.filter((r) => r.causeType !== null);
  const autoResolved = items.filter((r) => r.causeType === null && r.status === "auto_resolved");

  return (
    <div className="space-y-3">
      {operatorDecided.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            Locked in Review ({operatorDecided.length})
          </p>
          <div className="rounded-lg border border-status-success/25 bg-status-success/[0.04] overflow-hidden divide-y divide-status-success/15">
            {operatorDecided.map((r) => (
              <div key={r.eventId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold ${r.eventTypeColor}`}>
                      {r.eventTypeLabel}
                    </span>
                    <span className="text-[11px] font-medium truncate">{r.topic}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                    {r.causeType ? CAUSE_LABELS[r.causeType] : "Decided"}
                    {r.changeName ? `: ${r.changeName}` : ""}
                    {r.operatorConfidence && (
                      <span className="text-muted-foreground/60"> · {CONFIDENCE_LABELS[r.operatorConfidence]}</span>
                    )}
                  </p>
                </div>
                <Link href={`/results/${r.anchorResultId}`} className="text-[11px] text-muted-foreground hover:text-accent-primary shrink-0">
                  View
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {autoResolved.length > 0 && (
        <details className="group/auto">
          <summary className="text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-2 list-none mb-2 [&::-webkit-details-marker]:hidden">
            <span className="text-[8px] text-muted-foreground/50 transition-transform group-open/auto:rotate-90">▶</span>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-primary shrink-0" />
            Auto-cleared ({autoResolved.length})
          </summary>
          <div className="rounded-lg border border-border/70 overflow-hidden divide-y divide-border/60">
            {autoResolved.map((r) => (
              <div key={r.eventId} className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold ${r.eventTypeColor}`}>
                      {r.eventTypeLabel}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">{r.topic}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                    Auto-cleared: {r.changeName ?? "—"}
                  </p>
                </div>
                <Link href={`/results/${r.anchorResultId}`} className="text-[11px] text-muted-foreground hover:text-accent-primary shrink-0">
                  View
                </Link>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
