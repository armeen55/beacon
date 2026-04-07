import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/constants";
import { PRIORITY_LABELS } from "@/lib/constants";

const priorityStyles: Record<Priority, string> = {
  critical: "text-status-danger font-semibold",
  high: "text-status-warning font-medium",
  medium: "text-foreground-secondary font-medium",
  low: "text-muted-foreground font-normal",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={cn("text-[12px]", priorityStyles[priority])}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
