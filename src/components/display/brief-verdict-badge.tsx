import { StatusDot } from "./status-dot";
import type { BriefVerdict } from "@/domains/attribution/types";

const verdictConfig: Record<
  BriefVerdict,
  { status: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  validated: { status: "success", label: "Positive trend" },
  partially_validated: { status: "warning", label: "Mixed signal" },
  not_validated: { status: "danger", label: "No signal yet" },
  mixed: { status: "warning", label: "Mixed" },
  pending: { status: "neutral", label: "Not rated" },
};

export function BriefVerdictBadge({ verdict }: { verdict: BriefVerdict }) {
  const cfg = verdictConfig[verdict];
  return <StatusDot status={cfg.status} label={cfg.label} />;
}
