import { DeltaIndicator } from "@/components/display/delta-indicator";

type StatCardProps = {
  label: string;
  value: string | number;
  delta?: number | null;
  deltaSuffix?: string;
  invertDelta?: boolean;
};

export function StatCard({
  label,
  value,
  delta,
  deltaSuffix,
  invertDelta,
}: StatCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-xs text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 flex items-end gap-2">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {delta !== undefined && delta !== null && (
          <DeltaIndicator
            value={delta}
            suffix={deltaSuffix}
            invertColor={invertDelta}
          />
        )}
      </div>
    </div>
  );
}
