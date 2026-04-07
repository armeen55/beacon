import { StatusDot } from "./status-dot";
import type { BriefVerdict } from "@/domains/attribution/types";

const verdictConfig: Record<
  BriefVerdict,
  { status: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  validated: { status: "success", label: "Validated" },
  partially_validated: { status: "warning", label: "Partially Validated" },
  not_validated: { status: "danger", label: "Not Validated" },
  mixed: { status: "warning", label: "Mixed" },
  pending: { status: "neutral", label: "Pending" },
};

export function BriefVerdictBadge({ verdict }: { verdict: BriefVerdict }) {
  const cfg = verdictConfig[verdict];
  return <StatusDot status={cfg.status} label={cfg.label} />;
}
