import { cn } from "@/lib/utils";
import type { MatchStrength, Attribution } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";

type MatchFactorsProps = {
  matches: Attribution["matches"];
  evidenceTier?: EvidenceTier | null;
  className?: string;
};

const factorLabels: Record<keyof Attribution["matches"], string> = {
  platform: "Platform",
  topic: "Topic",
  url: "URL",
  geo: "Geo",
  temporal: "Timing",
  sourceCategory: "Type",
};

const strengthColors: Record<MatchStrength, string> = {
  strong: "bg-status-success",
  partial: "bg-status-warning",
  none: "bg-border",
  unknown: "bg-muted-foreground/30",
};

const STRENGTH_LABELS: Record<MatchStrength, string> = {
  strong: "lines up",
  partial: "close but not exact",
  none: "no overlap",
  unknown: "can't tell",
};

const TIER_LABELS: Record<EvidenceTier, string> = {
  exact: "Tight URL/topic match",
  probable: "Looser heuristic match",
  weak: "Weak signals",
  inferred: "Inferred only",
};

const TIER_COLORS: Record<EvidenceTier, string> = {
  exact: "text-muted-foreground",
  probable: "text-muted-foreground",
  weak: "text-status-warning",
  inferred: "text-status-warning",
};

export function MatchFactors({ matches, evidenceTier, className }: MatchFactorsProps) {
  return (
    <div className={cn("inline-flex items-center gap-2 flex-wrap", className)}>
      {(Object.entries(matches) as [keyof Attribution["matches"], MatchStrength][]).map(
        ([key, strength]) => (
          <span
            key={key}
            className="inline-flex items-center gap-1"
            title={`${factorLabels[key]}: ${STRENGTH_LABELS[strength]}`}
          >
            <span
              className={cn(
                "h-1 w-1 rounded-full",
                strengthColors[strength]
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {factorLabels[key]}
            </span>
          </span>
        )
      )}
      {evidenceTier && (
        <span
          className={cn("text-[10px] font-medium", TIER_COLORS[evidenceTier])}
          title={TIER_LABELS[evidenceTier]}
        >
          · {TIER_LABELS[evidenceTier]}
        </span>
      )}
    </div>
  );
}
