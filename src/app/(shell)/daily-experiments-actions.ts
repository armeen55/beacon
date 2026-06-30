"use server";

/**
 * daily-experiments-actions (2026-06-30) — operator-gated server actions for the native
 * "Plan today's experiments → Accept" workflow. Tenant ALWAYS from trusted server context
 * (currentTenantId), never client input. Preview persists a plan (NO reservations). Accept calls the
 * ATOMIC Postgres RPC after a fresh re-validation (all-or-none). No proof rows, no Wix, no paid calls.
 */
import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { deriveExperimentStates, GSC_LAG_DAYS } from "@/domains/experiments/experiment-eligibility";
import { buildTodayExperimentPreview } from "@/domains/experiments/build-today-preview";
import { validatePlanAcceptance, type AcceptanceContext } from "@/domains/experiments/validate-plan-acceptance";
import { reservationId, normalizePath, type DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";
import {
  createPreviewPlan, getPlan, expirePlans, abandonPreviewPlan, acceptPlanViaRpc, listActiveReservations, type AcceptResult,
} from "@/domains/experiments/daily-experiment-plan-store";

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
    if (record.selected.length === 0) return { ok: false, reason: "No eligible experiments today (nothing materially better that's scientifically clean)." };
    await createPreviewPlan(record); // fail-closed (throws if Supabase can't persist)
    revalidatePath("/worklist");
    revalidatePath("/");
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
  | { ok: false; reason: string; failures?: Array<{ url: string; reason: string }> }
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
      return { ok: false, reason: validation.planLevelReason ?? "validation_failed", failures: validation.failures?.map((f) => ({ url: f.url, reason: f.reason })) };
    }

    const reservedUntil = new Date(now.getTime() + RESERVE_DAYS * 86_400_000).toISOString();
    const res: AcceptResult = await acceptPlanViaRpc({
      tenantId, planId: plan.id, inputHash: input.inputHash, idempotencyKey: input.idempotencyKey,
      reservations: projectReservations(plan, reservedUntil),
    });
    if (!res.ok) return { ok: false, reason: res.reason };
    revalidatePath("/worklist");
    revalidatePath("/");
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
    if (plan.status !== "preview") return { ok: false, reason: `cannot abandon a ${plan.status} plan here (accepted-plan release needs the release RPC — deferred)` };
    await abandonPreviewPlan(tenantId, input.planId, new Date());
    revalidatePath("/worklist");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : "abandon failed" };
  }
}
