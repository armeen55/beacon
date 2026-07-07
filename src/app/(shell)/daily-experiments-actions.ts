"use server";

/**
 * daily-experiments-actions (2026-06-30) - operator-gated server actions for the native
 * "Plan today's experiments → Accept" workflow. Tenant ALWAYS from trusted server context
 * (currentTenantId), never client input. Preview persists a plan (NO reservations). Accept calls the
 * ATOMIC Postgres RPC after a fresh re-validation (all-or-none). No proof rows, no Wix, no paid calls.
 */
import { revalidatePath } from "next/cache";
import { invalidateTodaySurface } from "./today-surface-store";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { deriveExperimentStates, GSC_LAG_DAYS } from "@/domains/experiments/experiment-eligibility";
import { buildTodayExperimentPreview } from "@/domains/experiments/build-today-preview";
import { validatePlanAcceptance, type AcceptanceContext } from "@/domains/experiments/validate-plan-acceptance";
import { reservationId, normalizePath, type DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";
import {
  createPreviewPlan, getPlan, expirePlans, abandonPreviewPlan, acceptPlanViaRpc, listActiveReservations,
  activateItemViaRpc, skipItemViaRpc, updateItemExecution, completePlan, listReservationsForPlan, type AcceptResult,
} from "@/domains/experiments/daily-experiment-plan-store";
import { recordShippedChange } from "@/domains/proof-gsc/run-measurement";
import { recordToRow, markRecrawlRequestedById } from "@/domains/proof-gsc/shipped-change-store";
import { verifyExperimentLive } from "@/domains/experiments/live-verification";
import { buildExecutionChecklist } from "@/domains/experiments/execution-checklist";
import {
  itemStatus, isActiveStatus, transitionReceipt, LEVER_TO_ACTION_TYPE, type LiveVerificationResult,
} from "@/domains/experiments/execution-state";

/** The proof engine's diff-in-diff floor (a control set below this can't be measured honestly). */
const PROOF_MIN_CONTROLS = 2;

const RESERVE_DAYS = 28 + GSC_LAG_DAYS;

export type PlanPreviewResult =
  | { ok: false; reason: string }
  | { ok: true; planId: string; inputHash: string; selected: number; backups: number; distribution: Record<string, number>; estimatedMinutes: number; expiresAt: string };

/** Build + persist today's PREVIEW plan. Creates ZERO reservations / proof rows. */
export async function planTodayExperimentsAction(): Promise<PlanPreviewResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const now = new Date();
    await expirePlans(tenantId, now).catch(() => 0); // best-effort hygiene
    const { record } = await buildTodayExperimentPreview(tenantId, now);
    // Cold-Today fix (2026-07-07): a stable reason CODE, not a prose sentence. A raw
    // sentence is unknown to operator-failure's copy map, so it fell through to the
    // scary "Something didn't go through" error even though nothing broke. The code
    // maps to a calm, honest "nothing queued yet" message.
    if (record.selected.length === 0) return { ok: false, reason: "no_eligible_today" };
    await createPreviewPlan(record); // fail-closed (throws if Supabase can't persist)
    revalidatePath("/changes");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    return {
      ok: true, planId: record.id, inputHash: record.inputHash, selected: record.selected.length, backups: record.backups.length,
      distribution: record.distribution.byLever, estimatedMinutes: record.estimatedMinutes, expiresAt: record.expiresAt,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : "planning failed" };
  }
}

/** Project the plan's controls into the reservation rows the atomic RPC inserts. */
function projectReservations(plan: DailyExperimentPlanRecord, reservedUntilIso: string) {
  const rows: Array<{ id: string; planned_experiment_id: string; treated_url: string; control_url: string; control_path: string; reserved_until: string; similarity: Record<string, unknown> }> = [];
  for (const e of plan.selected) {
    for (const c of e.controls) {
      rows.push({
        id: reservationId(plan.tenantId, plan.id, e.id, c.controlPath),
        planned_experiment_id: e.id, treated_url: e.url, control_url: c.controlUrl, control_path: c.controlPath,
        reserved_until: reservedUntilIso,
        similarity: { score: c.score, pageFamilyMatch: c.pageFamilyMatch, impressionsRatio: c.impressionsRatio, positionDifference: c.positionDifference },
      });
    }
  }
  return rows;
}

export type AcceptActionResult =
  | { ok: false; reason: string; failures?: Array<{ url: string; reason: string }>; refreshedPlanId?: string; refreshedCount?: number }
  | { ok: true; idempotent: boolean; planId: string; reservationCount: number };

/**
 * Accept a preview plan: fresh re-validation vs the CURRENT topology, then the ATOMIC RPC (all
 * reservations or none + plan→accepted). Idempotent. Tenant from server context; client supplies
 * only planId/inputHash/idempotencyKey. NO proof rows, NO Wix.
 */
export async function acceptDailyExperimentPlanAction(input: { planId: string; inputHash: string; idempotencyKey: string }): Promise<AcceptActionResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const now = new Date();
    const plan = await getPlan(tenantId, input.planId);
    if (!plan) return { ok: false, reason: "plan_not_found" };

    // Fresh topology (the contamination-critical re-check) + existing reservations held by others.
    const ledger = await loadProofLedger(tenantId).catch(() => []);
    const states = deriveExperimentStates(ledger, now);
    const activeTreatedPaths = new Set<string>();
    const activeControlPaths = new Set<string>();
    for (const [p, st] of states) {
      if (st.activeTreatments.length) activeTreatedPaths.add(normalizePath(p));
      if (st.activeControlAssignments.length) activeControlPaths.add(normalizePath(p));
    }
    const reservedControlPaths = new Map<string, string>();
    for (const r of await listActiveReservations(tenantId)) reservedControlPaths.set(normalizePath(r.controlPath), r.planId);

    const ctx: AcceptanceContext = { tenantId, now, expectedInputHash: input.inputHash, activeTreatedPaths, activeControlPaths, reservedControlPaths };
    const validation = validatePlanAcceptance(plan, ctx);
    if (!validation.ok) {
      // Stale-plan auto-recovery: a PURE expiry failure (no per-item failures) is not a dead-end -
      // rebuild today's preview (fresh controls + backups) so the operator just reviews + re-Accepts,
      // instead of seeing a raw "plan_expired". Never auto-accepts; the fresh plan stays preview.
      if (validation.planLevelReason === "plan_expired" && (validation.failures?.length ?? 0) === 0) {
        try {
          await expirePlans(tenantId, now).catch(() => 0);
          const { record } = await buildTodayExperimentPreview(tenantId, now);
          if (record.selected.length === 0) return { ok: false, reason: "plan_refreshed_empty" };
          await createPreviewPlan(record);
          revalidatePath("/changes");
          revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
          return { ok: false, reason: "plan_refreshed", refreshedPlanId: record.id, refreshedCount: record.selected.length };
        } catch {
          return { ok: false, reason: "refresh_failed" };
        }
      }
      return { ok: false, reason: validation.planLevelReason ?? "validation_failed", failures: validation.failures?.map((f) => ({ url: f.url, reason: f.reason })) };
    }

    const reservedUntil = new Date(now.getTime() + RESERVE_DAYS * 86_400_000).toISOString();
    const res: AcceptResult = await acceptPlanViaRpc({
      tenantId, planId: plan.id, inputHash: input.inputHash, idempotencyKey: input.idempotencyKey,
      reservations: projectReservations(plan, reservedUntil),
    });
    if (!res.ok) return { ok: false, reason: res.reason };
    revalidatePath("/changes");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    return { ok: true, idempotent: res.idempotent, planId: res.planId, reservationCount: res.reservationIds.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : "accept failed" };
  }
}

export type AbandonResult = { ok: boolean; reason?: string };

/** Abandon a PREVIEW plan (single atomic update; no reservations exist for a preview). */
export async function abandonPreviewPlanAction(input: { planId: string }): Promise<AbandonResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const plan = await getPlan(tenantId, input.planId);
    if (!plan) return { ok: false, reason: "plan_not_found" };
    if (plan.status !== "preview") return { ok: false, reason: `cannot abandon a ${plan.status} plan here (accepted-plan release needs the release RPC - deferred)` };
    await abandonPreviewPlan(tenantId, input.planId, new Date());
    revalidatePath("/changes");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : "abandon failed" };
  }
}

// ── Post-acceptance execution (apply → verify live → atomic activation → GSC) ──────────────────────

export type AppliedActionResult =
  | { ok: false; reason: string; verification?: LiveVerificationResult; detail?: string }
  | { ok: true; idempotent: boolean; status: "active"; proofId: string; reservationCount: number; verification?: LiveVerificationResult };

/**
 * Operator clicked "Applied in Wix" for ONE accepted item. Beacon: marks verification_pending →
 * DETERMINISTICALLY verifies the change is LIVE (lever-specific) → on success re-checks controls vs
 * the current topology, builds the proof record (GSC baseline + windows), and atomically activates
 * (proof row + reservations active + item status) via the RPC. No proof / no reservation activation
 * before live verification. Idempotent. Tenant from server context.
 */
export async function markDailyExperimentAppliedAction(input: { planId: string; experimentId: string; idempotencyKey: string; editedText?: string }): Promise<AppliedActionResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const now = new Date();
    const plan = await getPlan(tenantId, input.planId);
    if (!plan) return { ok: false, reason: "plan_not_found" };
    if (plan.status !== "accepted") return { ok: false, reason: `plan_${plan.status}` };
    const exp = plan.selected.find((e) => e.id === input.experimentId);
    if (!exp) return { ok: false, reason: "item_not_found" };

    // D-3: the operator can tweak the proposed text inline before applying. Verify + record what they
    // ACTUALLY shipped (the edited text), not the original proposal. Only for text levers (a link's
    // verification keys on anchor/destination, not proposedText). The edit is an apply-time override;
    // the frozen plan proposal is unchanged.
    const editedText = (input.editedText ?? "").trim();
    const effectiveExp =
      editedText && editedText !== exp.proposedText && exp.lever !== "internal_link"
        ? { ...exp, proposedText: editedText }
        : exp;
    const wasEdited = effectiveExp !== exp;

    const current = itemStatus(plan.execution, input.experimentId);
    if (isActiveStatus(current)) {
      return { ok: true, idempotent: true, status: "active", proofId: plan.execution?.items?.[input.experimentId]?.proofId ?? "", reservationCount: 0 };
    }
    if (current === "skipped") return { ok: false, reason: "item_skipped" };

    // Crash-recovery marker (the UI shows the spinner via useTransition). Never downgrade an item the
    // DB already shows as active (a stale RMW must not clobber a live activation).
    await updateItemExecution(tenantId, input.planId, input.experimentId, (prev) => {
      if (prev && isActiveStatus(prev.status)) return prev;
      return {
        experimentId: input.experimentId,
        status: "verification_pending",
        receipts: [...(prev?.receipts ?? []), transitionReceipt(prev?.status ?? "ready_to_apply", "verification_pending", now.toISOString(), "operator", { idempotencyKey: input.idempotencyKey })],
        proofId: prev?.proofId,
      };
    });

    // DETERMINISTIC live verification (no LLM).
    const verification = await verifyExperimentLive(exp);
    if (!verification.verified) {
      await markFailed(tenantId, input.planId, input.experimentId, verification, verification.reason);
      return { ok: false, reason: "verification_failed", verification };
    }

    // Re-check controls vs the CURRENT topology - FAIL-CLOSED on a ledger read error (a scientific
    // gate must not silently degrade to "no active experiments"). Exclude any control now treated /
    // controlled elsewhere, in the ledger OR in live reservations (treated pages of other experiments).
    let ledger;
    try {
      ledger = await loadProofLedger(tenantId);
    } catch {
      await markFailed(tenantId, input.planId, input.experimentId, verification, "topology_unavailable");
      return { ok: false, reason: "topology_unavailable", detail: "couldn't read the experiment ledger - retry", verification };
    }
    const states = deriveExperimentStates(ledger, now);
    const activeTreated = new Set<string>();
    const activeControl = new Set<string>();
    for (const [p, st] of states) {
      if (st.activeTreatments.length) activeTreated.add(normalizePath(p));
      if (st.activeControlAssignments.length) activeControl.add(normalizePath(p));
    }
    for (const r of await listActiveReservations(tenantId)) {
      activeTreated.add(normalizePath(r.treatedUrl)); // a treated page of any active experiment is never a clean control
    }
    const cleanControls = exp.controls
      .filter((c) => { const p = normalizePath(c.controlPath || c.controlUrl); return !activeTreated.has(p) && !activeControl.has(p); })
      .map((c) => c.controlUrl);
    if (cleanControls.length < PROOF_MIN_CONTROLS) {
      await markFailed(tenantId, input.planId, input.experimentId, verification, "insufficient_controls");
      return { ok: false, reason: "insufficient_controls", detail: `${cleanControls.length} clean control(s), need ${PROOF_MIN_CONTROLS}`, verification };
    }

    // Build the proof record (GSC baseline + windows). Does NOT persist - the RPC inserts it atomically.
    const measured = await recordShippedChange({
      tenantId,
      page: exp.canonicalUrl || exp.url,
      path: normalizePath(exp.url),
      actionType: LEVER_TO_ACTION_TYPE[exp.lever],
      before: exp.currentText || null,
      after: exp.proposedText || null,
      targetQueries: exp.targetQuery ? [exp.targetQuery] : [],
      controlPages: cleanControls,
      shippedAt: now.toISOString(),
      verifiedLive: true,
      liveSourceUrl: exp.canonicalUrl || exp.url,
      notes: `Daily experiment (${exp.lever}) - verified live: ${verification.receipt.method}`,
      now,
    });
    // Disambiguate the proof id per lever so a daily-experiment proof can NEVER collide with the
    // manual/auto recorders or another lever on the same page+day (id = `${path}::${date}::${lever}`).
    const record = { ...measured, id: `${measured.id}::${exp.lever}` };
    const proofRow = recordToRow(tenantId, record) as unknown as Record<string, unknown>;

    const res = await activateItemViaRpc({
      tenantId, planId: input.planId, experimentId: input.experimentId,
      verificationReceipt: verification.receipt as unknown as Record<string, unknown>,
      proofRow, idempotencyKey: input.idempotencyKey,
    });
    if (!res.ok) {
      await markFailed(tenantId, input.planId, input.experimentId, verification, res.reason);
      return { ok: false, reason: res.reason, verification };
    }
    revalidatePath("/changes");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    revalidatePath("/results");
    return { ok: true, idempotent: res.idempotent, status: "active", proofId: res.proofId, reservationCount: res.reservationIds.length, verification };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : "apply failed" };
  }
}

/** Persist a verification_failed marker (no proof, no reservation activation). */
async function markFailed(tenantId: string, planId: string, experimentId: string, verification: LiveVerificationResult, reason: string): Promise<void> {
  await updateItemExecution(tenantId, planId, experimentId, (prev) => {
    // NEVER downgrade an already-active/terminal item - a live, measuring proof must not be shown failed.
    if (prev && (isActiveStatus(prev.status) || prev.status === "skipped" || prev.status === "rolled_back")) return prev;
    return {
      experimentId,
      status: "verification_failed",
      receipts: [...(prev?.receipts ?? []), transitionReceipt(prev?.status ?? "verification_pending", "verification_failed", new Date().toISOString(), "beacon", { reason })],
      verification,
      proofId: prev?.proofId,
    };
  }).catch((e) => {
    // The failure reason is already returned to the operator; surface the marker-write failure so a
    // stranded verification_pending is observable rather than silent.
    console.error("[daily-experiments] markFailed marker write failed (item may be stuck verification_pending)", { planId, experimentId, reason, error: e instanceof Error ? e.message : String(e) });
  });
}

/** Auto-close an accepted plan once every non-skipped item is submitted to Google (or all skipped). */
async function maybeCompletePlan(tenantId: string, planId: string): Promise<void> {
  try {
    const plan = await getPlan(tenantId, planId);
    if (!plan || plan.status !== "accepted") return;
    const reservations = await listReservationsForPlan(tenantId, planId).catch(() => []);
    const { summary } = buildExecutionChecklist(plan, reservations);
    const actionable = summary.accepted - summary.skipped;
    if (summary.left === 0 && (actionable === 0 || summary.submitted >= actionable)) {
      await completePlan(tenantId, planId, new Date());
    }
  } catch {
    /* completion is best-effort; it must never block or fail the primary action */
  }
}

export type GscSubmitResult = { ok: boolean; reason?: string };

/**
 * Operator confirms they submitted the URL in Google Search Console. Stamps the canonical
 * recrawl-requested marker on the proof row + advances the item to gsc_submitted. No automatic GSC
 * call is claimed - this records operator-confirmed submission only. Item must be active.
 */
export async function confirmGscSubmissionAction(input: { planId: string; experimentId: string; submittedAt?: string }): Promise<GscSubmitResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const plan = await getPlan(tenantId, input.planId);
    if (!plan) return { ok: false, reason: "plan_not_found" };
    const item = plan.execution?.items?.[input.experimentId];
    if (!item || !isActiveStatus(item.status)) return { ok: false, reason: "item_not_active" };
    const submittedAt = input.submittedAt ?? new Date().toISOString();

    // Canonical recrawl-requested marker on the proof row, targeted + tenant-explicit (no Google call).
    if (item.proofId) await markRecrawlRequestedById(tenantId, item.proofId, submittedAt);
    await updateItemExecution(tenantId, input.planId, input.experimentId, (prev) => {
      if (!prev || !isActiveStatus(prev.status)) return prev ?? { experimentId: input.experimentId, status: "active", receipts: [] };
      return {
        ...prev,
        experimentId: input.experimentId,
        status: "gsc_submitted",
        receipts: [...(prev.receipts ?? []), transitionReceipt(prev.status, "gsc_submitted", submittedAt, "operator")],
        gscSubmittedAt: submittedAt,
      };
    });
    await maybeCompletePlan(tenantId, input.planId);
    revalidatePath("/changes");
    revalidatePath("/results");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : "gsc submit failed" };
  }
}

export type SkipItemActionResult = { ok: boolean; reason?: string; releasedCount?: number };

/** Operator skips ONE accepted item before applying it - atomically releases only its controls. */
export async function skipDailyExperimentItemAction(input: { planId: string; experimentId: string; reason?: string; idempotencyKey: string }): Promise<SkipItemActionResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const plan = await getPlan(tenantId, input.planId);
    if (!plan) return { ok: false, reason: "plan_not_found" };
    if (plan.status !== "accepted") return { ok: false, reason: `plan_${plan.status}` };
    const res = await skipItemViaRpc({ tenantId, planId: input.planId, experimentId: input.experimentId, reason: input.reason ?? "operator_skip", idempotencyKey: input.idempotencyKey });
    if (!res.ok) return { ok: false, reason: res.reason };
    await maybeCompletePlan(tenantId, input.planId);
    revalidatePath("/changes");
    revalidatePath("/results");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    return { ok: true, releasedCount: res.releasedIds.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : "skip failed" };
  }
}

export type CompletePlanResult = { ok: boolean; reason?: string };

/** Operator explicitly closes today's accepted batch (frees tomorrow's plan surface). */
export async function completeDailyPlanAction(input: { planId: string }): Promise<CompletePlanResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const done = await completePlan(tenantId, input.planId, new Date());
    revalidatePath("/changes");
    revalidatePath("/");
    await invalidateTodaySurface().catch(() => {});
    return done ? { ok: true } : { ok: false, reason: "not_accepted_or_not_found" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : "complete failed" };
  }
}
