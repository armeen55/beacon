import Link from "next/link";
import { cn } from "@/lib/utils";

type EntityType =
  | "opportunity"
  | "brief"
  | "change"
  | "result"
  | "competitor";

const ENTITY_LABELS: Record<EntityType, string> = {
  opportunity: "Opportunity",
  brief: "Brief",
  change: "Change",
  result: "Result",
  competitor: "Competitor",
};

const ENTITY_COLORS: Record<EntityType, string> = {
  opportunity: "text-accent-primary",
  brief: "text-status-warning",
  change: "text-foreground-secondary",
  result: "text-status-success",
  competitor: "text-status-danger",
};

type EntityLinkCardProps = {
  type: EntityType;
  href: string;
  title: string;
  subtitle?: string;
  meta?: string;
  className?: string;
};

export function EntityLinkCard({
  type,
  href,
  title,
  subtitle,
  meta,
  className,
}: EntityLinkCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-md border border-border p-3 hover:border-accent-primary/30 hover:bg-accent-primary-light transition-colors",
        className
      )}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={cn(
            "text-[11px] font-medium uppercase tracking-wider",
            ENTITY_COLORS[type]
          )}
        >
          {ENTITY_LABELS[type]}
        </span>
        {meta && (
          <>
            <span className="text-border">·</span>
            <span className="text-[11px] text-muted-foreground">{meta}</span>
          </>
        )}
      </div>
      <p className="text-[13px] font-medium">{title}</p>
      {subtitle && (
        <p className="text-[12px] text-muted-foreground mt-1 line-clamp-1">
          {subtitle}
        </p>
      )}
    </Link>
  );
}
