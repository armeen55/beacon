import Link from "next/link";
import type { ExpectedOutcome } from "@/domains/briefs/types";
import { VerdictBadge } from "@/components/display/verdict-badge";
import { METRIC_TYPE_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { formatTarget } from "@/domains/briefs/utils";
import { getOutcomeSummary } from "@/domains/briefs/utils";

export function BriefOutcomes({
  outcomes,
}: {
  outcomes: ExpectedOutcome[];
}) {
  const summary = getOutcomeSummary(outcomes);

  if (outcomes.length === 0) return null;

  return (
    <div className="space-y-3">
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
              <VerdictBadge verdict={o.verdict} />
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
