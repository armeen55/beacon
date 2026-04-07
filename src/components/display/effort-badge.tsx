import { cn } from "@/lib/utils";
import type { EffortLevel } from "@/lib/constants";
import { EFFORT_LEVEL_LABELS } from "@/lib/constants";

const effortStyles: Record<EffortLevel, string> = {
  trivial: "text-muted-foreground font-normal",
  small: "text-muted-foreground font-normal",
  medium: "text-foreground-secondary font-medium",
  large: "text-status-warning font-medium",
  epic: "text-status-danger font-semibold",
};

export function EffortBadge({ effort }: { effort: EffortLevel }) {
  return (
    <span className={cn("text-[12px]", effortStyles[effort])}>
      {EFFORT_LEVEL_LABELS[effort]}
    </span>
  );
}
