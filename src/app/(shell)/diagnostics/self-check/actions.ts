"use server";

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  parseBlindHoldoutReceipt,
  recordBlindHoldoutReceipt,
} from "@/domains/eval/blind-holdout-store";
import { validateBlindHoldout } from "@/domains/eval/blind-holdout-contract";

export type RegisterBlindHoldoutState = {
  ok: boolean;
  message: string;
};

/** Operator-only hosted seam for registering an independently produced receipt.
 * The receipt must name the exact build currently serving the form. */
export async function registerBlindHoldoutAction(
  _previous: RegisterBlindHoldoutState,
  formData: FormData,
): Promise<RegisterBlindHoldoutState> {
  if (!(isOperatorModeServer() || process.env.NODE_ENV === "test")) {
    return { ok: false, message: "Operator only." };
  }
  const currentSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  if (currentSha == null || !/^[0-9a-f]{40}$/i.test(currentSha)) {
    return { ok: false, message: "This build does not expose a full commit SHA, so I cannot bind a receipt to it." };
  }
  const raw = formData.get("receipt");
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, message: "Paste the complete blind receipt JSON." };
  }
  try {
    const receipt = parseBlindHoldoutReceipt(JSON.parse(raw) as unknown);
    if (receipt.candidateSha !== currentSha) {
      return {
        ok: false,
        message: `This receipt targets ${receipt.candidateSha.slice(0, 8) || "no SHA"}, not the live ${currentSha.slice(0, 8)} build.`,
      };
    }
    await recordBlindHoldoutReceipt(receipt);
    const validation = validateBlindHoldout(receipt);
    revalidatePath("/diagnostics/self-check");
    return validation.releaseEligible
      ? { ok: true, message: `Recorded: ${validation.countedCases} unseen cases passed for this exact release.` }
      : {
          ok: false,
          message: `Recorded honestly, but it does not certify this release: ${validation.reasons[0] ?? "acceptance failed"}`,
        };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The receipt could not be read.",
    };
  }
}
