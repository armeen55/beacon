import type { OutcomeVerdict } from "@/lib/constants";
import { OUTCOME_VERDICT_LABELS } from "@/lib/constants";
import { StatusDot } from "./status-dot";

const verdictStatus: Record<
  OutcomeVerdict,
  "success" | "warning" | "danger" | "neutral"
> = {
  hit: "success",
  partial: "warning",
  missed: "danger",
  pending: "neutral",
};

export function VerdictBadge({ verdict }: { verdict: OutcomeVerdict }) {
  return (
    <StatusDot
      status={verdictStatus[verdict]}
      label={OUTCOME_VERDICT_LABELS[verdict]}
    />
  );
}
