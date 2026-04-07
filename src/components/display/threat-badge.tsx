import { cn } from "@/lib/utils";
import { THREAT_LEVEL_LABELS } from "@/lib/constants";
import type { ThreatLevel } from "@/lib/constants";

type ThreatBadgeProps = {
  level: ThreatLevel;
  className?: string;
};

const badgeStyles: Record<ThreatLevel, string> = {
  none: "bg-surface-inset text-muted-foreground",
  low: "bg-surface-inset text-foreground-secondary",
  medium: "bg-status-warning/10 text-status-warning",
  high: "bg-status-danger/10 text-status-danger",
  critical: "bg-status-danger/20 text-status-danger font-semibold",
};

export function ThreatBadge({ level, className }: ThreatBadgeProps) {
  if (level === "none") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium",
        badgeStyles[level],
        className
      )}
    >
      {THREAT_LEVEL_LABELS[level]} Threat
    </span>
  );
}
