import Link from "next/link";
import { cn } from "@/lib/utils";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import type { RiskItem } from "@/domains/dashboard/triage";

const entityLabels: Record<RiskItem["entityType"], string> = {
  result: "Result",
  change: "Change",
};

export function RiskList({ items }: { items: RiskItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="block rounded-md border border-border p-2.5 hover:border-status-danger/30 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {entityLabels[item.entityType]}
                </span>
              </div>
              <p className="text-[12px] font-medium truncate">{item.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {item.reason}
              </p>
            </div>
            {item.delta != null && (
              <DeltaIndicator value={item.delta} className="shrink-0" />
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
