"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { MatchFactors } from "@/components/display/match-factors";
import { lockDecision } from "@/domains/attribution/candidate-actions";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";
import type { Attribution, TruthRelation, CauseType, OperatorConfidence } from "@/domains/attribution/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { JudgmentSummary } from "@/domains/attribution/judgment";

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
  };
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const current = items[selectedIdx] ?? null;

  function advance() {
    if (selectedIdx < items.length - 1) {
      setSelectedIdx(selectedIdx + 1);
    }
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <StatsBar stats={stats} />
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">You're caught up</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Every event has a decision locked.
          </p>
        </div>
        {resolvedItems.length > 0 && <ResolvedSection items={resolvedItems} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatsBar stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        {/* Left: Queue */}
        <div className="rounded-md border border-border overflow-hidden">
          <div className="bg-surface-raised px-3 py-2 border-b border-border">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Undecided ({items.length})
            </p>
          </div>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
            {items.map((item, idx) => (
              <button
                key={item.eventId}
                onClick={() => setSelectedIdx(idx)}
                className={cn(
                  "w-full text-left px-3 py-2.5 transition-colors",
                  idx === selectedIdx
                    ? "bg-accent-primary/10 border-l-2 border-l-accent-primary"
                    : "hover:bg-surface-inset border-l-2 border-l-transparent"
                )}
              >
                <p className="text-[12px] font-medium truncate">{item.topic}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${item.eventTypeColor}`}>
                    {item.eventTypeLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{item.platform}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Decision Card */}
        {current && (
          <DecisionCard
            item={current}
            position={selectedIdx + 1}
            total={items.length}
            onDecided={advance}
          />
        )}
      </div>

      {resolvedItems.length > 0 && <ResolvedSection items={resolvedItems} />}
    </div>
  );
}

function StatsBar({ stats }: { stats: { pending: number; confirmed: number; autoResolved: number; decided: number; noCandidates: number } }) {
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-wrap">
      {stats.pending > 0 && (
        <span className="text-status-warning font-medium">{stats.pending} undecided</span>
      )}
      {stats.decided > 0 && (
        <>
          {stats.pending > 0 && <span>·</span>}
          <span>{stats.decided} decided</span>
        </>
      )}
      {stats.autoResolved > 0 && (
        <>
          <span>·</span>
          <span>{stats.autoResolved} auto-cleared</span>
        </>
      )}
      {stats.noCandidates > 0 && (
        <>
          <span>·</span>
          <span>{stats.noCandidates} no candidates</span>
        </>
      )}
    </div>
  );
}

function DecisionCard({
  item,
  position,
  total,
  onDecided,
}: {
  item: ReviewQueueItem;
  position: number;
  total: number;
  onDecided: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedCause, setSelectedCause] = useState<CauseType | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<OperatorConfidence>("medium");
  const [note, setNote] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const j = item.judgment;
  const actionableCandidates = item.candidates.filter(
    (c) => c.triage === "primary" || c.triage === "needs_review" || c.triage === "contributing"
  );

  const canLock = selectedCause !== null && (selectedCause !== "change" || selectedChangeId !== null);

  function handleLock() {
    if (!canLock) return;
    startTransition(async () => {
      await lockDecision(
        item.eventId,
        item.anchorResultId,
        selectedCause!,
        selectedCause === "change" ? selectedChangeId : null,
        confidence,
        note || null,
        item.candidates.map((c) => c.change.id)
      );
      setSelectedCause(null);
      setSelectedChangeId(null);
      setConfidence("medium");
      setNote("");
      setShowDetails(false);
      onDecided();
    });
  }

  return (
    <div className={cn("space-y-4 transition-opacity", isPending && "opacity-60 pointer-events-none")}>
      {/* What happened */}
      <div className="rounded-md border border-border p-4">
        <p className="text-[14px] font-medium leading-snug">{j.whatHappened}</p>
        {j.bestExplanation && (
          <p className="text-[12px] text-muted-foreground mt-1">{j.bestExplanation}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 italic">{j.confidenceLine}</p>
      </div>

      {/* THE DECISION: forced choice */}
      <div className="rounded-md border-2 border-accent-primary/30 bg-accent-primary/5 p-4 space-y-4">
        <p className="text-[13px] font-semibold">What caused this?</p>

        <div className="space-y-2">
          {/* Change candidates */}
          {actionableCandidates.map((c) => (
            <label
              key={c.change.id}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                selectedCause === "change" && selectedChangeId === c.change.id
                  ? "border-accent-primary bg-accent-primary/10"
                  : "border-border hover:bg-surface-inset"
              )}
            >
              <input
                type="radio"
                name="cause"
                className="mt-0.5 shrink-0"
                checked={selectedCause === "change" && selectedChangeId === c.change.id}
                onChange={() => { setSelectedCause("change"); setSelectedChangeId(c.change.id); }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium">{c.change.asset_name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{c.change.change_description}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <span>{SIGNAL_TYPE_LABELS[c.change.signal_type]}</span>
                  <span>·</span>
                  <span>{new Date(c.change.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              </div>
            </label>
          ))}

          {/* Non-change causes */}
          <label
            className={cn(
              "flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors",
              selectedCause === "competitor"
                ? "border-accent-primary bg-accent-primary/10"
                : "border-border hover:bg-surface-inset"
            )}
          >
            <input
              type="radio"
              name="cause"
              className="shrink-0"
              checked={selectedCause === "competitor"}
              onChange={() => { setSelectedCause("competitor"); setSelectedChangeId(null); }}
            />
            <span className="text-[12px]">Competitor action</span>
          </label>

          <label
            className={cn(
              "flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors",
              selectedCause === "algorithm"
                ? "border-accent-primary bg-accent-primary/10"
                : "border-border hover:bg-surface-inset"
            )}
          >
            <input
              type="radio"
              name="cause"
              className="shrink-0"
              checked={selectedCause === "algorithm"}
              onChange={() => { setSelectedCause("algorithm"); setSelectedChangeId(null); }}
            />
            <span className="text-[12px]">Algorithm / system shift</span>
          </label>

          <label
            className={cn(
              "flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors",
              selectedCause === "unknown"
                ? "border-accent-primary bg-accent-primary/10"
                : "border-border hover:bg-surface-inset"
            )}
          >
            <input
              type="radio"
              name="cause"
              className="shrink-0"
              checked={selectedCause === "unknown"}
              onChange={() => { setSelectedCause("unknown"); setSelectedChangeId(null); }}
            />
            <span className="text-[12px]">Can't tell</span>
          </label>
        </div>

        {/* Operator confidence */}
        {selectedCause && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              How sure are you?
            </p>
            <div className="flex items-center gap-2">
              {(["high", "medium", "low"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setConfidence(level)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                    confidence === level
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground hover:bg-surface-inset"
                  )}
                >
                  {level === "high" ? "Pretty sure" : level === "medium" ? "Best guess" : "Not sure"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Optional note */}
        {selectedCause && (
          <div>
            <label className="text-[11px] text-muted-foreground" htmlFor="decision-note">
              Note (optional)
            </label>
            <input
              id="decision-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this one?"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>
        )}

        {/* Lock button */}
        <button
          onClick={handleLock}
          disabled={!canLock}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold transition-colors w-full justify-center",
            canLock
              ? "bg-foreground text-background hover:opacity-90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <Lock className="h-3.5 w-3.5" /> Lock Decision
        </button>
      </div>

      {/* Expandable details */}
      {item.candidates.length > 0 && (
        <details
          className="group"
          open={showDetails}
          onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}
        >
          <summary className="text-[12px] text-muted-foreground cursor-pointer hover:text-foreground">
            Match details ({item.candidates.length} candidates) ▸
          </summary>
          <div className="mt-3 space-y-2">
            {item.candidates
              .filter((c) => c.triage !== "suppressed")
              .map((c) => (
                <div key={c.change.id} className="rounded-md border border-border p-2.5">
                  <p className="text-[12px] font-medium">{c.change.asset_name}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{SIGNAL_TYPE_LABELS[c.change.signal_type]}</span>
                    <span>·</span>
                    <span>{new Date(c.change.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  <div className="mt-1.5">
                    <MatchFactors matches={c.attribution.matches} evidenceTier={c.attribution.evidence_tier} />
                  </div>
                </div>
              ))}
          </div>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <Link href={`/results/${item.anchorResultId}`} className="hover:text-accent-primary">
          Full result →
        </Link>
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{position} / {total}</span>
          {position < total && (
            <button
              onClick={onDecided}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Skip <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResolvedSection({ items }: { items: ResolvedItem[] }) {
  const CAUSE_LABELS: Record<CauseType, string> = {
    change: "Change",
    competitor: "Competitor",
    algorithm: "Algorithm",
    unknown: "Unknown",
  };
  const CONFIDENCE_LABELS: Record<OperatorConfidence, string> = {
    high: "sure",
    medium: "best guess",
    low: "unsure",
  };

  return (
    <details className="group">
      <summary className="text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground">
        Decided ({items.length}) ▸
      </summary>
      <div className="mt-2 rounded-md border border-border overflow-hidden divide-y divide-border">
        {items.map((r) => (
          <div key={r.eventId} className="px-4 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${r.eventTypeColor}`}>
                  {r.eventTypeLabel}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">{r.topic}</span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                {r.causeType
                  ? `${CAUSE_LABELS[r.causeType]}: ${r.changeName ?? "—"}`
                  : r.status === "auto_resolved"
                    ? `Auto-cleared: ${r.changeName ?? "—"}`
                    : `Confirmed: ${r.changeName ?? "—"}`
                }
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
    </details>
  );
}
