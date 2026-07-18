"use server";

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  recordBlindHoldoutReceipt,
} from "@/domains/eval/blind-holdout-store";
import { validateBlindHoldout } from "@/domains/eval/blind-holdout-contract";
import {
  buildBlindHoldoutReceiptFromEvents,
  digestBlindArtifact,
  listBlindHoldoutCaseEvents,
  preregisterBlindHoldoutCase,
  revealBlindHoldoutLabel,
  sealBlindHoldoutPrediction,
} from "@/domains/eval/blind-holdout-session-store";
import type { HoldoutArchetype } from "@/domains/eval/blind-holdout-contract";

export type RegisterBlindHoldoutState = {
  ok: boolean;
  message: string;
};

type SubmittedEvent =
  | { phase: "preregister"; caseId: string; archetype: HoldoutArchetype; input: string }
  | { phase: "prediction"; caseId: string; prediction: string }
  | { phase: "reveal"; caseId: string; expertLabel: string; passed: boolean };

function parseSubmittedEvent(value: unknown): SubmittedEvent {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The event must be a JSON object.");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.phase !== "string" || typeof row.caseId !== "string" || !row.caseId.trim()) {
    throw new Error("Every event needs phase and caseId.");
  }
  if (row.phase === "preregister") {
    if (typeof row.archetype !== "string" || typeof row.input !== "string" || !row.input.trim()) {
      throw new Error("Preregistration needs archetype and the complete unseen input artifact.");
    }
    return { phase: row.phase, caseId: row.caseId, archetype: row.archetype as HoldoutArchetype, input: row.input };
  }
  if (row.phase === "prediction") {
    if (typeof row.prediction !== "string" || !row.prediction.trim()) {
      throw new Error("Prediction sealing needs the complete frozen prediction artifact.");
    }
    return { phase: row.phase, caseId: row.caseId, prediction: row.prediction };
  }
  if (row.phase === "reveal") {
    if (typeof row.expertLabel !== "string" || !row.expertLabel.trim() || typeof row.passed !== "boolean") {
      throw new Error("Label reveal needs the expert label artifact and passed=true or false.");
    }
    return { phase: row.phase, caseId: row.caseId, expertLabel: row.expertLabel, passed: row.passed };
  }
  throw new Error("phase must be preregister, prediction, or reveal.");
}

/** Operator-only hosted seam for a server-sealed blind lifecycle. The action
 * accepts artifacts, never timestamps or a claimed SHA; Beacon hashes the
 * artifacts and stamps the live build/order itself. */
export async function recordBlindHoldoutEventAction(
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
  const raw = formData.get("event");
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, message: "Paste one complete blind event JSON object." };
  }
  try {
    const event = parseSubmittedEvent(JSON.parse(raw) as unknown);
    if (event.phase === "preregister") {
      await preregisterBlindHoldoutCase({
        currentSha,
        caseId: event.caseId,
        archetype: event.archetype,
        inputDigest: digestBlindArtifact(event.input),
      });
      revalidatePath("/diagnostics/self-check");
      return { ok: true, message: `Preregistered ${event.caseId} against live ${currentSha.slice(0, 8)}.` };
    }
    if (event.phase === "prediction") {
      await sealBlindHoldoutPrediction({
        currentSha,
        caseId: event.caseId,
        predictionDigest: digestBlindArtifact(event.prediction),
      });
      revalidatePath("/diagnostics/self-check");
      return { ok: true, message: `Prediction sealed for ${event.caseId}. The expert label may now be revealed.` };
    }
    const revealed = await revealBlindHoldoutLabel({
      currentSha,
      caseId: event.caseId,
      expertLabelDigest: digestBlindArtifact(event.expertLabel),
      passed: event.passed,
    });
    const receipt = buildBlindHoldoutReceiptFromEvents(
      await listBlindHoldoutCaseEvents(),
      revealed.candidateSha,
    );
    await recordBlindHoldoutReceipt(receipt, revealed.recordedAt);
    const validation = validateBlindHoldout(receipt);
    revalidatePath("/diagnostics/self-check");
    return validation.releaseEligible
      ? { ok: true, message: `Sealed: ${validation.countedCases} unseen cases passed for this exact release.` }
      : {
          ok: true,
          message: `Label sealed honestly. The release is not certified yet: ${validation.reasons[0] ?? "acceptance incomplete"}`,
        };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The receipt could not be read.",
    };
  }
}
