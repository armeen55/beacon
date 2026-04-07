import { cn } from "@/lib/utils";

type ProgressBarProps = {
  value: number;
  max?: number;
  size?: "sm" | "md";
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
};

const barVariants: Record<NonNullable<ProgressBarProps["variant"]>, string> = {
  default: "bg-foreground",
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
};

export function ProgressBar({
  value,
  max = 100,
  size = "sm",
  variant = "default",
  className,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      className={cn(
        "w-full rounded-full bg-surface-inset overflow-hidden",
        size === "sm" ? "h-1.5" : "h-2",
        className
      )}
    >
      <div
        className={cn("h-full rounded-full transition-all duration-300", barVariants[variant])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
