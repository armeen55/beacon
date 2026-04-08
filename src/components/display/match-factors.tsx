import { cn } from "@/lib/utils";
import type { MatchStrength, Attribution } from "@/domains/attribution/types";

type MatchFactorsProps = {
  matches: Attribution["matches"];
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

export function MatchFactors({ matches, className }: MatchFactorsProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
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
    </div>
  );
}
