import { cn } from "@/lib/utils";
import type { FreshnessLevel } from "@/domains/opportunities/freshness";

type FreshnessDotProps = {
  level: FreshnessLevel;
  daysSinceActivity: number;
  className?: string;
};

const dotColor: Record<FreshnessLevel, string> = {
  fresh: "bg-status-success",
  aging: "bg-status-warning",
  stale: "bg-status-danger",
  abandoned: "bg-status-danger",
};

const labelText: Record<FreshnessLevel, string> = {
  fresh: "Fresh",
  aging: "Aging",
  stale: "Stale",
  abandoned: "Abandoned",
};

export function FreshnessDot({ level, daysSinceActivity, className }: FreshnessDotProps) {
  if (level === "fresh") return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          dotColor[level],
          level === "abandoned" && "animate-pulse"
        )}
      />
      <span className="text-[12px] text-foreground-secondary">
        {labelText[level]}
        {daysSinceActivity > 0 && (
          <span className="text-muted-foreground ml-1">
            ({daysSinceActivity}d)
          </span>
        )}
      </span>
    </span>
  );
}
