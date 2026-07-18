import type { GscProofVerdict, ProofWindowDay, ProofWindowResult } from "./measure";
import { applyDemoteOnly56, windowRole, type WindowRole } from "./window-role";

export const CONFIRMATION_COMPUTATION_VERSION = "proof-gsc-observational-v1";

export type ConfirmationDecision = {
  role: WindowRole;
  readVerdict: GscProofVerdict;
  verdictAfterRead: GscProofVerdict;
  demoted: boolean;
  provisional: boolean;
};

/** Apply one predeclared repeated look without ever upgrading the primary call. */
export function decideConfirmationRead(args: {
  day: ProofWindowDay;
  primaryVerdict: GscProofVerdict;
  readVerdict: GscProofVerdict;
  placeboHistorySupports56?: boolean;
}): ConfirmationDecision {
  const role = windowRole(args.day);
  if (role !== "demote_only") {
    return {
      role,
      readVerdict: args.readVerdict,
      verdictAfterRead: args.primaryVerdict,
      demoted: false,
      provisional: false,
    };
  }

  const result = applyDemoteOnly56({
    primaryVerdict: args.primaryVerdict,
    heldAt56: args.readVerdict === "won",
    placeboHistorySupports56: args.placeboHistorySupports56,
  });
  return {
    role,
    readVerdict: args.readVerdict,
    verdictAfterRead: result.verdict,
    demoted: result.demoted,
    provisional: result.provisional,
  };
}

export function confirmationResultPayload(args: {
  window: ProofWindowResult;
  decision: ConfirmationDecision;
  primaryVerdict: GscProofVerdict;
  metric: string;
}): Record<string, unknown> {
  return {
    role: args.decision.role,
    metric: args.metric,
    primaryVerdict: args.primaryVerdict,
    readVerdict: args.decision.readVerdict,
    verdictAfterRead: args.decision.verdictAfterRead,
    demoted: args.decision.demoted,
    provisional: args.decision.provisional,
    window: { ...args.window },
  };
}
