"use client";

import { cn } from "@/lib/utils";

export function ConfidenceBadge({
  level,
  size = "default",
}: {
  level: "high" | "medium" | "low" | "grounded" | "inferred" | "insufficient" | "partial" | "sufficient";
  size?: "default" | "sm";
}) {
  const colorMap: Record<string, string> = {
    high: "text-status-success border-status-success/20 bg-status-success/5",
    medium: "text-foreground border-border/40 bg-muted/10",
    low: "text-status-warning border-status-warning/20 bg-status-warning/5",
    grounded: "text-status-success border-status-success/20 bg-status-success/5",
    inferred: "text-muted-foreground border-border/40 bg-muted/10",
    insufficient: "text-muted-foreground/50 border-border/20 bg-transparent",
    partial: "text-status-warning border-status-warning/20 bg-status-warning/5",
    sufficient: "text-status-success border-status-success/20 bg-status-success/5",
  };

  return (
    <span className={cn(
      "inline-flex items-center rounded border font-medium",
      size === "sm" ? "text-[8px] px-1 py-px" : "text-[9px] px-1.5 py-px",
      colorMap[level] ?? "text-muted-foreground border-border/40",
    )}>
      {level}
    </span>
  );
}
