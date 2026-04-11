"use client";

import { cn } from "@/lib/utils";

export function ThreatMeter({
  level,
  label,
  detail,
  compact = false,
}: {
  level: "high" | "moderate" | "low";
  label?: string;
  detail?: string;
  compact?: boolean;
}) {
  const segments = 5;
  const filled = level === "high" ? 4 : level === "moderate" ? 2 : 1;

  return (
    <div className={cn("flex items-center gap-2", compact && "gap-1")}>
      <div className="flex gap-0.5">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-sm transition-colors",
              compact ? "w-1.5 h-3" : "w-2 h-4",
              i < filled
                ? level === "high"
                  ? "bg-status-danger"
                  : level === "moderate"
                    ? "bg-status-warning"
                    : "bg-status-success"
                : "bg-border/20",
            )}
          />
        ))}
      </div>
      {label && (
        <span className={cn(
          "font-medium",
          compact ? "text-[9px]" : "text-[10px]",
          level === "high" ? "text-status-danger" : level === "moderate" ? "text-status-warning" : "text-status-success",
        )}>
          {label}
        </span>
      )}
      {detail && <span className="text-[9px] text-muted-foreground/60">{detail}</span>}
    </div>
  );
}
