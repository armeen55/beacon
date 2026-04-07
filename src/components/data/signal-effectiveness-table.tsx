import { cn } from "@/lib/utils";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";
import type { SignalEffectiveness } from "@/domains/attribution/types";

type SignalEffectivenessTableProps = {
  data: SignalEffectiveness[];
  className?: string;
};

function HitRateBar({ rate }: { rate: number }) {
  if (rate === 0) return <span className="text-[12px] text-muted-foreground">—</span>;
  const pct = Math.round(rate * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-surface-inset overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 75
              ? "bg-status-success"
              : pct >= 50
                ? "bg-status-warning"
                : "bg-status-danger"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[12px] tabular-nums font-medium">{pct}%</span>
    </div>
  );
}

export function SignalEffectivenessTable({
  data,
  className,
}: SignalEffectivenessTableProps) {
  if (data.length === 0) return null;

  return (
    <div className={cn("rounded-md border border-border overflow-hidden", className)}>
      <div className="bg-surface-raised px-3 py-2 border-b border-border">
        <h3 className="text-[12px] font-semibold">Signal Effectiveness</h3>
      </div>
      <div className="divide-y divide-border">
        {data.map((item) => (
          <div
            key={item.signal_type}
            className="px-3 py-2 flex items-center gap-4"
          >
            <span className="text-[12px] font-medium w-24 shrink-0">
              {SIGNAL_TYPE_LABELS[item.signal_type]}
            </span>
            <span className="text-[11px] text-muted-foreground w-16 shrink-0">
              {item.total_changes} change{item.total_changes !== 1 ? "s" : ""}
            </span>
            <div className="flex-1">
              <HitRateBar rate={item.hit_rate} />
            </div>
            <span className="text-[11px] text-muted-foreground w-16 text-right shrink-0">
              {item.average_days_to_impact != null
                ? `~${item.average_days_to_impact}d`
                : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
