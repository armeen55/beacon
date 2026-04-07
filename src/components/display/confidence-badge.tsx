import { cn } from "@/lib/utils";
import type { AttributionConfidence } from "@/domains/attribution/types";

type ConfidenceBadgeProps = {
  confidence: AttributionConfidence;
  explanation?: string;
  className?: string;
};

const styles: Record<
  AttributionConfidence,
  { dot: string; label: string; text: string }
> = {
  high: {
    dot: "bg-status-success",
    label: "Likely caused by",
    text: "text-status-success",
  },
  medium: {
    dot: "bg-status-warning",
    label: "Possibly related to",
    text: "text-status-warning",
  },
  low: {
    dot: "bg-status-neutral",
    label: "Weak connection",
    text: "text-muted-foreground",
  },
  uncertain: {
    dot: "bg-muted-foreground/50",
    label: "Unclear link",
    text: "text-muted-foreground",
  },
};

export function ConfidenceBadge({
  confidence,
  explanation,
  className,
}: ConfidenceBadgeProps) {
  const s = styles[confidence];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dot)} />
      <span className={cn("text-[11px] font-medium", s.text)}>{s.label}</span>
      {explanation && (
        <span className="text-[11px] text-muted-foreground">
          · {explanation}
        </span>
      )}
    </span>
  );
}
