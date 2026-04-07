import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { StallStatus } from "@/domains/briefs/stall";

const bannerStyles: Record<string, string> = {
  warning: "bg-status-warning-bg border-status-warning/20",
  stalled: "bg-status-danger/5 border-status-danger/20",
  critical: "bg-status-danger/10 border-status-danger/30",
};

const iconStyles: Record<string, string> = {
  warning: "text-status-warning",
  stalled: "text-status-danger",
  critical: "text-status-danger",
};

export function StallBanner({ stall }: { stall: StallStatus }) {
  if (stall.level === "none") return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3",
        bannerStyles[stall.level]
      )}
    >
      <AlertTriangle
        className={cn(
          "h-4 w-4 shrink-0 mt-0.5",
          iconStyles[stall.level],
          stall.level === "critical" && "animate-pulse"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">
          {stall.reason}
        </p>
        {stall.recommended_action && (
          <p className="mt-0.5 text-[12px] text-foreground-secondary">
            {stall.recommended_action}
          </p>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
        {stall.days_inactive}d
      </span>
    </div>
  );
}
