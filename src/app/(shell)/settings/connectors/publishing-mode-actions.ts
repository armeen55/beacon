"use server";

/**
 * Armed publishing — settings server actions (2026-06-16).
 *
 * The operator arms/disarms one-click live publishing for the current site.
 * Arming is REFUSED unless every precondition is met (live Wix target +
 * connector connected + collection mappings + a passing dry-run of the real
 * push path + an explicit safety-rails confirmation). Disarming always
 * succeeds (return to the safe two-click default).
 *
 * The dry-run precondition runs the ACTUAL push path with `dryRun: true`
 * (executePush exercises every guard + Wix resolution and stops BEFORE any
 * write — no snapshot, no ledger, no live change) against a representative
 * pushable edit. When there's nothing pushable to test yet, the precondition
 * passes — the per-edit gate + executePush still protect the first real push.
 */

import { revalidatePath } from "next/cache";

import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import {
  getPublishingMode,
  setPublishingMode,
  type PublishingModeState,
} from "@/domains/push/publishing-mode-store";
import {
  evaluateArmingPreconditions,
  type ArmingEvaluation,
  type ArmingPreconditionInput,
} from "@/domains/push/publishing-mode";

export type PublishingModeReadiness = {
  state: PublishingModeState;
  canPublish: boolean;
  evaluation: ArmingEvaluation;
  /** Raw precondition inputs (so arm() re-evaluates with the live confirmation). */
  inputs: ArmingPreconditionInput;
};

/** A writable Wix field-edit action type (the dry-run picks one of these). */
const WRITABLE_ACTION_TYPES = new Set([
  "edit_title",
  "edit_meta",
  "edit_h1",
  "change_h1",
  "edit_h2",
  "add_schema",
  "improve_copy",
]);

async function gatherReadiness(): Promise<PublishingModeReadiness> {
  const tenantId = await currentTenantId();

  const [state, canPublish] = await Promise.all([
    getPublishingMode(),
    canPublishForCurrentTenant(),
  ]);

  // Connector connected? (a usable, non-disconnected Wix token exists)
  let connectorConnected = false;
  let publishTarget:
    | import("@/domains/tenants/types").PublishTargetKind
    | null = null;
  try {
    const { getWixConnectorToken } = await import("@/lib/connector-store");
    const token = await getWixConnectorToken(tenantId);
    connectorConnected =
      token != null &&
      !(
        "disconnected_at" in token &&
        token.disconnected_at != null &&
        token.disconnected_at !== ""
      );
  } catch {
    connectorConnected = false;
  }
  try {
    const { getTenant } = await import("@/domains/tenants/store");
    publishTarget = (await getTenant(tenantId))?.publish_target ?? null;
  } catch {
    publishTarget = null;
  }

  // Mappings exist? (operator-configured collection field-roles + url map)
  let mappingCount = 0;
  try {
    const { getWixCollectionConfig, getWixUrlMap } = await import(
      "@/lib/connectors/wix/mappings-store"
    );
    const [configs, urlMap] = await Promise.all([
      getWixCollectionConfig(),
      getWixUrlMap(),
    ]);
    mappingCount =
      configs.filter((c) => c.contentFieldRoles != null).length +
      urlMap.length;
  } catch {
    mappingCount = 0;
  }

  // Dry-run the real push path on a representative pushable edit (read-only).
  const dryRunPassed = await runRepresentativeDryRun(tenantId);

  const inputs: ArmingPreconditionInput = {
    publishTarget,
    connectorConnected,
    mappingCount,
    dryRunPassed,
    // safetyRailsConfirmed is supplied at arm() time; the readiness PREVIEW
    // reports it met only for an already-armed site (it WAS confirmed to arm).
    safetyRailsConfirmed: state.mode === "armed",
  };
  const evaluation = evaluateArmingPreconditions(inputs);

  return { state, canPublish, evaluation, inputs };
}

/** Returns true when a dry-run passed OR there is nothing pushable to test. */
async function runRepresentativeDryRun(tenantId: string): Promise<boolean> {
  try {
    const { getRepository } = await import("@/lib/persistence/repositories");
    const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
    const candidate = edits.find(
      (e) =>
        WRITABLE_ACTION_TYPES.has(e.action_type) &&
        (e.implementation_status ?? "recommended") !== "dismissed" &&
        (e.proposed_text ?? "").trim().length > 0,
    );
    if (candidate == null) return true; // nothing to test yet — allow arming
    const { executePush } = await import("@/domains/push/push-service");
    const res = await executePush({ tenantId, edit: candidate, dryRun: true });
    // dry_run = the full guard path passed; dev_note = advise-mode (still safe
    // to arm — the per-edit gate routes it). refused = a real misconfiguration.
    return res.kind === "dry_run" || res.kind === "dev_note";
  } catch {
    return false; // any error → treat the path as unproven (fail-safe)
  }
}

export async function loadPublishingModeReadiness(): Promise<PublishingModeReadiness> {
  return await gatherReadiness();
}

export async function armPublishing(args: {
  safetyRailsConfirmed: boolean;
}): Promise<
  | { ok: true; state: PublishingModeState }
  | { ok: false; reason: string; evaluation?: ArmingEvaluation }
> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  if (args.safetyRailsConfirmed !== true) {
    return { ok: false, reason: "Confirm the safety rails before arming one-click publishing." };
  }

  const readiness = await gatherReadiness();
  // Re-evaluate with the explicit confirmation from THIS call (the readiness
  // preview can't know the operator confirmed until now).
  const evaluation = evaluateArmingPreconditions({
    ...readiness.inputs,
    safetyRailsConfirmed: true,
  });
  if (!evaluation.canArm) {
    return {
      ok: false,
      reason:
        "Your site isn't ready for one-click publishing yet. Connect Wix, map your collections, and pass a test run first.",
      evaluation,
    };
  }

  const state = await setPublishingMode({ mode: "armed" });
  revalidatePath("/settings/connectors");
  revalidatePath("/recommendations");
  return { ok: true, state };
}

export async function disarmPublishing(): Promise<
  { ok: true; state: PublishingModeState } | { ok: false; reason: string }
> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  const state = await setPublishingMode({ mode: "staged" });
  revalidatePath("/settings/connectors");
  revalidatePath("/recommendations");
  return { ok: true, state };
}
