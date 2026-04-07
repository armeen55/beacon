"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
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

  if (candidates.length === 0) return null;

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

  return (
    <div className="border-t border-border pt-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold">Candidate Causes</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Automated suggestions — confirm or reject to build attribution truth.
        </p>
      </div>

      <div
        className={cn(
          "space-y-2 transition-opacity",
          isPending && "opacity-60 pointer-events-none"
        )}
      >
        {candidates.map(({ change, attribution, score }) => (
          <div
            key={change.id}
            className="rounded-md border border-dashed border-border p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Link
                  href={`/changes/${change.id}`}
                  className="text-[13px] font-medium hover:text-accent-primary transition-colors"
                >
                  {change.asset_name}
                </Link>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  <span>{SIGNAL_TYPE_LABELS[change.signal_type]}</span>
                  <span className="text-border">·</span>
                  <span>
                    {new Date(change.timestamp).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="text-border">·</span>
                  <span className="font-mono text-[10px]">
                    score {Math.round(score)}
                  </span>
                </div>
                {change.change_description && (
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                    {change.change_description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleConfirm(change.id)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border border-status-success/30 text-status-success hover:bg-status-success/10 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Confirm
                </button>
                <button
                  onClick={() => handleReject(change.id)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border border-status-error/30 text-status-error hover:bg-status-error/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Reject
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ConfidenceBadge
                  confidence={attribution.confidence}
                  explanation={attribution.explanation}
                />
                <MatchFactors matches={attribution.matches} />
              </div>
              <TruthLabeler
                resultId={resultId}
                changeId={change.id}
                currentLabel={truthLabelMap[change.id]}
              />
            </div>
          </div>
        ))}
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
