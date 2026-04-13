"use client";

import { useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { judgeOutcome } from "@/domains/briefs/actions";
import { getOutcomeSummary } from "@/domains/briefs/utils";
import { formatTarget } from "@/domains/briefs/utils";
import { METRIC_TYPE_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import type { ExpectedOutcome } from "@/domains/briefs/types";
import type { OutcomeVerdict } from "@/lib/constants";

const VERDICT_OPTIONS: { value: OutcomeVerdict; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "hit", label: "Hit" },
  { value: "partial", label: "Partial" },
  { value: "missed", label: "Missed" },
];

const VERDICT_STYLES: Record<OutcomeVerdict, string> = {
  pending: "border-border text-muted-foreground",
  hit: "border-status-success/40 bg-status-success/10 text-status-success",
  partial: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  missed: "border-status-danger/40 bg-status-danger/10 text-status-danger",
};

function VerdictPills({
  current,
  onSelect,
  disabled,
}: {
  current: OutcomeVerdict;
  onSelect: (v: OutcomeVerdict) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-1">
      {VERDICT_OPTIONS.filter((v) => v.value !== "pending").map((v) => (
        <button
          key={v.value}
          onClick={() => onSelect(current === v.value ? "pending" : v.value)}
          disabled={disabled}
          className={cn(
            "text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors",
            current === v.value
              ? VERDICT_STYLES[v.value]
              : "border-border text-muted-foreground hover:border-accent-primary/30"
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function InteractiveOutcomes({
  briefId,
  outcomes,
}: {
  briefId: string;
  outcomes: ExpectedOutcome[];
}) {
  const [isPending, startTransition] = useTransition();
  const summary = getOutcomeSummary(outcomes);

  const handleJudge = (outcomeId: string, verdict: OutcomeVerdict) => {
    startTransition(async () => {
      await judgeOutcome(briefId, outcomeId, verdict);
    });
  };

  if (outcomes.length === 0) return null;

  return (
    <div className={cn("space-y-3", isPending && "opacity-70 pointer-events-none")}>
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">
          Expected Outcomes
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {summary.hit > 0 && (
            <span className="text-status-success">{summary.hit} hit</span>
          )}
          {summary.partial > 0 && (
            <span className="text-status-warning">
              {summary.partial} partial
            </span>
          )}
          {summary.missed > 0 && (
            <span className="text-status-danger">
              {summary.missed} missed
            </span>
          )}
          {summary.pending > 0 && <span>{summary.pending} pending</span>}
        </div>
      </div>

      <div className="space-y-2">
        {outcomes.map((o) => (
          <div
            key={o.id}
            className="rounded-md border border-border-subtle bg-surface-raised p-3 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] text-foreground-secondary leading-snug flex-1">
                {o.description}
              </p>
              <VerdictPills
                current={o.verdict}
                onSelect={(v) => handleJudge(o.id, v)}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{PLATFORM_LABELS[o.platform]}</span>
              <span>·</span>
              <span>{METRIC_TYPE_LABELS[o.metric_type]}</span>
              <span>·</span>
              <span>Target: {formatTarget(o.metric_type, o.target_value)}</span>
              {o.baseline_value !== null && (
                <>
                  <span>·</span>
                  <span>Baseline: {o.baseline_value}</span>
                </>
              )}
              <span>·</span>
              <span>{o.timeframe}</span>
            </div>

            {o.verdict !== "pending" && o.actual_value !== null && (
              <p className="text-[12px] text-foreground-secondary">
                Actual: <span className="font-medium">{o.actual_value}</span>
                {o.result_id && (
                  <Link
                    href={`/settings/history/${o.result_id}`}
                    className="ml-1.5 text-accent-primary hover:underline"
                  >
                    View result →
                  </Link>
                )}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
