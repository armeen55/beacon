import Link from "next/link";
import { cn } from "@/lib/utils";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import type { WinItem } from "@/domains/dashboard/triage";
import { METRIC_DIRECTION } from "@/lib/constants";

export function WinsList({ items }: { items: WinItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((win) => {
        const isInverted =
          METRIC_DIRECTION[win.result.metric_type] === "lower_is_better";
        return (
          <Link
            key={win.id}
            href={`/results/${win.result.id}`}
            className="block rounded-md border border-status-success/20 bg-status-success-bg p-3 hover:border-status-success/40 transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-status-success uppercase tracking-wider">
                Win
              </span>
              <DeltaIndicator
                value={win.result.delta_percentage}
                invertColor={isInverted}
              />
            </div>
            <p className="text-[13px] font-semibold">{win.headline}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {win.platform}
              {win.result.topic ? ` · ${win.result.topic}` : ""}
            </p>
            {win.change && (
              <p className="text-[12px] text-foreground-secondary mt-1.5 line-clamp-1">
                {win.explanation}
              </p>
            )}
            {win.confidence && (
              <div className="mt-1.5">
                <ConfidenceBadge confidence={win.confidence} />
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
