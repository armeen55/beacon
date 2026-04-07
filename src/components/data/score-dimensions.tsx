import { cn } from "@/lib/utils";
import type { ScoreDimension } from "@/domains/opportunities/scoring";

type ScoreDimensionsProps = {
  dimensions: ScoreDimension[];
  className?: string;
};

function getBarColor(value: number): string {
  if (value >= 75) return "bg-status-success";
  if (value >= 50) return "bg-status-warning";
  if (value >= 25) return "bg-status-danger/60";
  return "bg-status-neutral";
}

export function ScoreDimensions({ dimensions, className }: ScoreDimensionsProps) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {dimensions.map((dim) => (
        <div key={dim.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] text-foreground-secondary">
              {dim.label}
            </span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {dim.value}
              <span className="text-[10px] ml-0.5">
                × {Math.round(dim.weight * 100)}%
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-inset overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getBarColor(dim.value))}
              style={{ width: `${dim.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
