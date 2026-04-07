import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

type DeltaIndicatorProps = {
  value: number | null;
  suffix?: string;
  invertColor?: boolean;
  className?: string;
};

export function DeltaIndicator({
  value,
  suffix = "%",
  invertColor = false,
  className,
}: DeltaIndicatorProps) {
  if (value === null || value === 0) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs text-muted-foreground", className)}>
        <Minus className="h-3 w-3" />0{suffix}
      </span>
    );
  }

  const isPositive = value > 0;
  const isGood = invertColor ? !isPositive : isPositive;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        isGood ? "text-status-success" : "text-status-danger",
        className
      )}
    >
      {isPositive ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}
