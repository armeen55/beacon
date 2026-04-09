import { StatusDot } from "./status-dot";
import type { ChangeVerdict } from "@/domains/attribution/types";

/** Plain-language labels for marketers; underlying enum stays technical for data. */
export const CHANGE_VERDICT_DISPLAY: Record<
  ChangeVerdict,
  { status: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  validated: { status: "success", label: "Strong signal" },
  partial: { status: "warning", label: "Mixed signal" },
  inconclusive: { status: "neutral", label: "Unclear" },
  no_impact: { status: "danger", label: "No lift in data" },
  negative: { status: "danger", label: "Decline detected" },
  too_early: { status: "neutral", label: "Too soon to tell" },
  pending: { status: "neutral", label: "Not rated" },
};

export function changeVerdictLabel(v: ChangeVerdict): string {
  return CHANGE_VERDICT_DISPLAY[v]?.label ?? String(v);
}

export function ChangeVerdictBadge({ verdict }: { verdict: ChangeVerdict }) {
  const cfg = CHANGE_VERDICT_DISPLAY[verdict];
  return <StatusDot status={cfg.status} label={cfg.label} />;
}
