import Link from "next/link";
import { ProgressBar } from "@/components/display/progress-bar";
import type { InMotionItem, WaitingItem } from "@/domains/dashboard/triage";

const entityLabels: Record<InMotionItem["entityType"], string> = {
  brief: "Brief",
  opportunity: "Opportunity",
};

const waitingEntityLabels: Record<WaitingItem["entityType"], string> = {
  change: "Change",
  brief: "Brief",
  opportunity: "Opportunity",
};

export function InMotionList({ items }: { items: InMotionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="block rounded-md border border-border p-3 hover:border-accent-primary/30 transition-colors"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {entityLabels[item.entityType]}
            </span>
            <span className="text-border">·</span>
            <span className="text-[11px] text-muted-foreground capitalize">
              {item.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-[13px] font-medium truncate">{item.title}</p>
          <div className="flex items-center gap-3 mt-1.5">
            {item.progress && (
              <>
                <ProgressBar
                  value={item.progress.percentage}
                  size="sm"
                  variant={
                    item.progress.percentage >= 75
                      ? "success"
                      : item.progress.percentage >= 40
                        ? "warning"
                        : "default"
                  }
                  className="flex-1"
                />
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {item.progress.done}/{item.progress.total}
                </span>
              </>
            )}
            <span className="text-[11px] text-muted-foreground shrink-0">
              {item.daysActive}d active
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function WaitingList({ items }: { items: WaitingItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="block rounded-md border border-border p-3 hover:border-accent-primary/30 transition-colors"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {waitingEntityLabels[item.entityType]}
            </span>
          </div>
          <p className="text-[13px] font-medium truncate">{item.title}</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {item.detail}
          </p>
        </Link>
      ))}
    </div>
  );
}
