import { cn } from "@/lib/utils";
import type { GuidanceItem, GuidanceUrgency } from "@/domains/opportunities/guidance";

type GuidancePanelProps = {
  items: GuidanceItem[];
  className?: string;
};

const urgencyStyles: Record<GuidanceUrgency, { dot: string; border: string }> = {
  critical: {
    dot: "bg-status-danger",
    border: "border-status-danger/20",
  },
  high: {
    dot: "bg-status-warning",
    border: "border-status-warning/20",
  },
  medium: {
    dot: "bg-accent-primary",
    border: "border-border",
  },
  low: {
    dot: "bg-status-neutral",
    border: "border-border",
  },
};

export function GuidancePanel({ items, className }: GuidancePanelProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {items.map((item, i) => {
        const styles = urgencyStyles[item.urgency];
        return (
          <div
            key={i}
            className={cn(
              "rounded-md border p-3",
              styles.border,
              item.urgency === "critical" && "bg-status-danger/5"
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0 mt-1.5",
                  styles.dot
                )}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{item.action}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {item.reason}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
