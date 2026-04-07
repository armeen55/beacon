import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TriageItem } from "@/domains/dashboard/triage";

const urgencyStyles: Record<
  TriageItem["urgency"],
  { dot: string; bg: string }
> = {
  critical: {
    dot: "bg-status-danger",
    bg: "border-status-danger/20",
  },
  high: {
    dot: "bg-status-warning",
    bg: "border-status-warning/20",
  },
  medium: {
    dot: "bg-status-neutral",
    bg: "border-border",
  },
};

const entityLabels: Record<TriageItem["entityType"], string> = {
  opportunity: "Opportunity",
  brief: "Brief",
};

export function TriageList({ items }: { items: TriageItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const styles = urgencyStyles[item.urgency];
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "block rounded-md border p-3 hover:bg-accent-primary-light transition-colors",
              styles.bg
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 rounded-full shrink-0",
                  styles.dot
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {entityLabels[item.entityType]}
                  </span>
                </div>
                <p className="text-[13px] font-medium truncate">{item.title}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {item.reason}
                </p>
                <p className="text-[12px] text-accent-primary font-medium mt-1">
                  {item.action}
                </p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
