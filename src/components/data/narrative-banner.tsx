import { cn } from "@/lib/utils";

type NarrativeBannerProps = {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning";
  className?: string;
};

const bannerVariants: Record<NonNullable<NarrativeBannerProps["variant"]>, string> = {
  default: "bg-surface-inset border-border-subtle",
  success: "bg-status-success-bg border-status-success/20",
  warning: "bg-status-warning-bg border-status-warning/20",
};

export function NarrativeBanner({
  children,
  variant = "default",
  className,
}: NarrativeBannerProps) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3 text-[13px] leading-relaxed text-foreground-secondary",
        bannerVariants[variant],
        className
      )}
    >
      {children}
    </div>
  );
}
