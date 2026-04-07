import { StatusDot } from "./status-dot";
import type { ChangeVerdict } from "@/domains/attribution/types";

const verdictConfig: Record<
  ChangeVerdict,
  { status: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  validated: { status: "success", label: "Validated" },
  partial: { status: "warning", label: "Partial" },
  inconclusive: { status: "neutral", label: "Inconclusive" },
  no_impact: { status: "danger", label: "No Impact" },
  pending: { status: "neutral", label: "Pending" },
};

export function ChangeVerdictBadge({ verdict }: { verdict: ChangeVerdict }) {
  const cfg = verdictConfig[verdict];
  return <StatusDot status={cfg.status} label={cfg.label} />;
}
