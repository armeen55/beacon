import Link from "next/link";
import { cn } from "@/lib/utils";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import { MatchFactors } from "@/components/display/match-factors";
import type { Attribution } from "@/domains/attribution/types";
import {
  METRIC_TYPE_LABELS,
  PLATFORM_LABELS,
  SIGNAL_TYPE_LABELS,
  METRIC_DIRECTION,
} from "@/lib/constants";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

type AttributionCardProps = {
  attribution: Attribution;
  change: ChangelogEntry;
  result: Result;
  className?: string;
};

export function AttributionCard({
  attribution,
  change,
  result,
  className,
}: AttributionCardProps) {
  const isInverted = METRIC_DIRECTION[result.metric_type] === "lower_is_better";

  return (
    <div
      className={cn(
        "rounded-md border border-border p-3 space-y-2",
        attribution.role === "primary" && "border-accent-primary/20",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/results/${result.id}`}
            className="text-[13px] font-medium hover:text-accent-primary transition-colors"
          >
            {METRIC_TYPE_LABELS[result.metric_type]}
          </Link>
          <span className="text-[12px] text-muted-foreground ml-2">
            {PLATFORM_LABELS[result.platform]}
          </span>
        </div>
        {result.delta_percentage != null && (
          <DeltaIndicator
            value={result.delta_percentage}
            invertColor={isInverted}
          />
        )}
      </div>

      <ConfidenceBadge
        confidence={attribution.confidence}
        explanation={attribution.explanation}
      />

      <MatchFactors matches={attribution.matches} evidenceTier={attribution.evidence_tier} />

      {attribution.role !== "primary" && (
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {attribution.role}
        </span>
      )}
    </div>
  );
}
