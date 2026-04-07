"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X, ChevronDown, Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import { MatchFactors } from "@/components/display/match-factors";
import {
  confirmCandidate,
  rejectCandidate,
  addTruthLabel,
} from "@/domains/attribution/candidate-actions";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";
import type { Attribution, TruthRelation } from "@/domains/attribution/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { TriageCategory } from "@/domains/attribution/triage";

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
  triage?: TriageCategory;
  triageReason?: string;
};

export function CandidateReview({
  resultId,
  candidates,
  truthLabelMap = {},
}: {
  resultId: string;
  candidates: CandidateItem[];
  truthLabelMap?: Record<string, TruthRelation>;
}) {
  const [isPending, startTransition] = useTransition();
  const [showSuppressed, setShowSuppressed] = useState(false);

  if (candidates.length === 0) return null;

  const primary = candidates.filter((c) => c.triage === "primary");
  const contributing = candidates.filter((c) => c.triage === "contributing");
  const needsReview = candidates.filter((c) => c.triage === "needs_review");
  const suppressed = candidates.filter((c) => c.triage === "suppressed");
  const untriaged = candidates.filter((c) => !c.triage);

  const hasTriageData = primary.length > 0 || suppressed.length > 0 || needsReview.length > 0;

  function handleConfirm(changeId: string) {
    startTransition(async () => {
      await confirmCandidate(resultId, changeId);
    });
  }

  function handleReject(changeId: string) {
    startTransition(async () => {
      await rejectCandidate(resultId, changeId);
    });
  }

  if (!hasTriageData) {
    return (
      <div className="border-t border-border pt-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-semibold">Candidate Causes</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Confirm or reject to build attribution truth.
          </p>
        </div>
        <div className={cn("space-y-2 transition-opacity", isPending && "opacity-60 pointer-events-none")}>
          {untriaged.map((c) => (
            <CandidateCard key={c.change.id} item={c} resultId={resultId} truthLabel={truthLabelMap[c.change.id]} onConfirm={handleConfirm} onReject={handleReject} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-5 space-y-5">
      <div>
        <h3 className="text-[13px] font-semibold">Candidate Causes</h3>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
          {primary.length > 0 && <span className="text-status-success font-medium">1 primary</span>}
          {contributing.length > 0 && <span>{contributing.length} contributing</span>}
          {needsReview.length > 0 && <span className="text-status-warning font-medium">{needsReview.length} needs review</span>}
          {suppressed.length > 0 && <span>{suppressed.length} suppressed</span>}
        </div>
      </div>

      <div className={cn("space-y-4 transition-opacity", isPending && "opacity-60 pointer-events-none")}>
        {primary.map((c) => (
          <div key={c.change.id}>
            <p className="text-[10px] font-semibold text-status-success uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Zap className="h-3 w-3" /> Primary Cause
            </p>
            <div className="rounded-md border-2 border-status-success/20 bg-status-success/5 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <Link href={`/changes/${c.change.id}`} className="text-[13px] font-semibold hover:text-accent-primary transition-colors">
                    {c.change.asset_name}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <span>{SIGNAL_TYPE_LABELS[c.change.signal_type]}</span>
                    <span className="text-border">·</span>
                    <span>{new Date(c.change.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span className="text-border">·</span>
                    <span className="font-mono text-[10px]">score {Math.round(c.score)}</span>
                  </div>
                  {c.triageReason && (
                    <p className="text-[11px] text-status-success/80 mt-1">{c.triageReason}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-status-success/10 px-2.5 py-0.5 text-[10px] font-semibold text-status-success uppercase tracking-wider">
                  Auto-selected
                </span>
              </div>
              <div className="flex items-center gap-3">
                <ConfidenceBadge confidence={c.attribution.confidence} explanation={c.attribution.explanation} />
                <MatchFactors matches={c.attribution.matches} />
              </div>
            </div>
          </div>
        ))}

        {contributing.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Contributing
            </p>
            <div className="space-y-1.5">
              {contributing.map((c) => (
                <div key={c.change.id} className="rounded-md border border-border bg-surface-inset p-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/changes/${c.change.id}`} className="text-[12px] font-medium hover:text-accent-primary transition-colors">
                        {c.change.asset_name}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{SIGNAL_TYPE_LABELS[c.change.signal_type]}</span>
                        <span className="text-border">·</span>
                        <span>{new Date(c.change.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        <span className="text-border">·</span>
                        <span className="font-mono text-[10px]">score {Math.round(c.score)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ConfidenceBadge confidence={c.attribution.confidence} explanation={c.attribution.explanation} />
                    <MatchFactors matches={c.attribution.matches} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {needsReview.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-status-warning uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Shield className="h-3 w-3" /> Needs Review
            </p>
            <div className="space-y-2">
              {needsReview.map((c) => (
                <CandidateCard key={c.change.id} item={c} resultId={resultId} truthLabel={truthLabelMap[c.change.id]} onConfirm={handleConfirm} onReject={handleReject} showReason />
              ))}
            </div>
          </div>
        )}

        {suppressed.length > 0 && (
          <div>
            <button
              onClick={() => setShowSuppressed(!showSuppressed)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showSuppressed && "rotate-180")} />
              {showSuppressed ? "Hide" : "Show"} {suppressed.length} suppressed candidate{suppressed.length !== 1 ? "s" : ""}
            </button>
            {showSuppressed && (
              <div className="mt-2 space-y-1 pl-4 border-l-2 border-border">
                {suppressed.map((c) => (
                  <div key={c.change.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link href={`/changes/${c.change.id}`} className="text-[11px] text-muted-foreground hover:text-foreground truncate">
                        {c.change.asset_name}
                      </Link>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {Math.round(c.score)}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {c.triageReason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateCard({
  item,
  resultId,
  truthLabel,
  onConfirm,
  onReject,
  showReason,
}: {
  item: CandidateItem;
  resultId: string;
  truthLabel?: TruthRelation;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  showReason?: boolean;
}) {
  const { change, attribution, score } = item;
  return (
    <div className="rounded-md border border-dashed border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Link href={`/changes/${change.id}`} className="text-[13px] font-medium hover:text-accent-primary transition-colors">
            {change.asset_name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
            <span>{SIGNAL_TYPE_LABELS[change.signal_type]}</span>
            <span className="text-border">·</span>
            <span>{new Date(change.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <span className="text-border">·</span>
            <span className="font-mono text-[10px]">score {Math.round(score)}</span>
          </div>
          {showReason && item.triageReason && (
            <p className="text-[10px] text-status-warning mt-0.5">{item.triageReason}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onConfirm(change.id)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border border-status-success/30 text-status-success hover:bg-status-success/10 transition-colors"
          >
            <Check className="h-3 w-3" />
            Confirm
          </button>
          <button
            onClick={() => onReject(change.id)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border border-status-error/30 text-status-error hover:bg-status-error/10 transition-colors"
          >
            <X className="h-3 w-3" />
            Reject
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ConfidenceBadge confidence={attribution.confidence} explanation={attribution.explanation} />
          <MatchFactors matches={attribution.matches} />
        </div>
        <TruthLabeler resultId={resultId} changeId={change.id} currentLabel={truthLabel} />
      </div>
    </div>
  );
}

export function TruthLabeler({
  resultId,
  changeId,
  currentLabel,
}: {
  resultId: string;
  changeId: string;
  currentLabel?: TruthRelation;
}) {
  const [isPending, startTransition] = useTransition();

  const labels: { value: TruthRelation; label: string }[] = [
    { value: "causal", label: "Causal" },
    { value: "contributing", label: "Contributing" },
    { value: "unrelated", label: "Unrelated" },
    { value: "unknown", label: "Unknown" },
  ];

  function handleLabel(relation: TruthRelation) {
    startTransition(async () => {
      await addTruthLabel(resultId, changeId, relation);
    });
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1",
        isPending && "opacity-60 pointer-events-none"
      )}
    >
      <span className="text-[10px] text-muted-foreground mr-1">Truth:</span>
      {labels.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => handleLabel(value)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            currentLabel === value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-raised"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
