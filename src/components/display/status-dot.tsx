import { cn } from "@/lib/utils";

type StatusDotProps = {
  status: "success" | "warning" | "danger" | "neutral" | "info";
  label: string;
  className?: string;
};

const dotColors: Record<StatusDotProps["status"], string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-status-neutral",
  info: "bg-accent-primary",
};

export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[status])} />
      <span className="text-[12px] text-foreground-secondary">{label}</span>
    </span>
  );
}
