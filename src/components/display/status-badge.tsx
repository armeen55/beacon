import { cn } from "@/lib/utils";
import type { OpportunityStatus, BriefStatus } from "@/lib/constants";
import {
  OPPORTUNITY_STATUS_LABELS,
  BRIEF_STATUS_LABELS,
} from "@/lib/constants";

type DotVariant = "success" | "warning" | "danger" | "neutral" | "info";

const dotColors: Record<DotVariant, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-status-neutral",
  info: "bg-accent-primary",
};

const opportunityStatusVariants: Record<OpportunityStatus, DotVariant> = {
  new: "info",
  queued: "neutral",
  executing: "warning",
  validating: "warning",
  partially_captured: "success",
  captured: "success",
  regressed: "danger",
  monitoring: "neutral",
  deferred: "neutral",
  closed: "neutral",
};

const briefStatusVariants: Record<BriefStatus, DotVariant> = {
  draft: "neutral",
  approved: "info",
  in_progress: "warning",
  completed: "success",
  blocked: "danger",
};

function DotBadge({ variant, label }: { variant: DotVariant; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[variant])} />
      <span className="text-[12px] text-foreground-secondary">{label}</span>
    </span>
  );
}

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  return (
    <DotBadge
      variant={opportunityStatusVariants[status]}
      label={OPPORTUNITY_STATUS_LABELS[status]}
    />
  );
}

export function BriefStatusBadge({ status }: { status: BriefStatus }) {
  return (
    <DotBadge
      variant={briefStatusVariants[status]}
      label={BRIEF_STATUS_LABELS[status]}
    />
  );
}
