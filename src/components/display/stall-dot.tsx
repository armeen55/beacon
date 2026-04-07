import { cn } from "@/lib/utils";
import type { StallLevel } from "@/domains/briefs/stall";

const stallColors: Record<StallLevel, string> = {
  none: "",
  warning: "bg-status-warning",
  stalled: "bg-status-danger",
  critical: "bg-status-danger animate-pulse",
};

export function StallDot({
  level,
  className,
}: {
  level: StallLevel;
  className?: string;
}) {
  if (level === "none") return null;

  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        stallColors[level],
        className
      )}
    />
  );
}
