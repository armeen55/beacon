import { cn } from "@/lib/utils";
import type { LoopHealth } from "@/domains/dashboard/triage";

export function LoopHealthBar({ health }: { health: LoopHealth }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="bg-surface-raised px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[12px] font-semibold">Loop Health</span>
        {health.bottleneck && (
          <span className="text-[11px] text-status-warning font-medium">
            Bottleneck: {health.bottleneck}
          </span>
        )}
      </div>
      <div className="grid grid-cols-5">
        {health.stages.map((stage, i) => (
          <div
            key={stage.label}
            className={cn(
              "text-center py-2.5 px-2",
              i < health.stages.length - 1 && "border-r border-border",
              stage.isBottleneck && "bg-status-warning/5"
            )}
          >
            <p
              className={cn(
                "text-[11px] font-medium",
                stage.isBottleneck
                  ? "text-status-warning"
                  : "text-muted-foreground"
              )}
            >
              {stage.label}
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums mt-0.5",
                stage.isBottleneck && "text-status-warning"
              )}
            >
              {stage.count}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
