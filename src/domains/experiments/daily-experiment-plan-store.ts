/**
 * daily-experiment-plan-store (2026-06-30) — server-only durable repository for daily experiment
 * plans + control reservations (Supabase). The `plan` jsonb column holds the full
 * DailyExperimentPlanRecord (the source of truth); top-level columns mirror it for querying.
 *
 * Discipline (mission HARD RULES):
 *  - reads FAIL-SOFT (return null/[] on error) so the dashboard never hard-crashes;
 *  - writes FAIL-CLOSED + LOUD (throw) — NO json/file fallback for plans/reservations, ever;
 *  - acceptance is the atomic RPC `accept_daily_experiment_plan` — never a client-side multi-write;
 *  - tenant always comes from the caller's trusted server context (never client input).
 */
import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import {
  type DailyExperimentPlanRecord, type ControlReservationRecord, type PlanAcceptanceFailureReason,
} from "./daily-plan-types";
import type { ItemExecutionRecord, PlanExecutionState } from "./execution-state";

const PLANS = "daily_experiment_plans";
const RESERVATIONS = "control_reservations";

function parsePlanRow(row: { plan: unknown } | null | undefined): DailyExperimentPlanRecord | null {
  const rec = row?.plan as DailyExperimentPlanRecord | undefined;
  if (!rec || typeof rec !== "object") return null;
  if (rec.version !== 1) { console.warn(`[daily-plan-store] unsupported plan version ${rec.version}`); return null; }
  return rec;
}

function planToRow(r: DailyExperimentPlanRecord) {
  return {
    id: r.id, tenant_id: r.tenantId, date: r.date, status: r.status,
    input_hash: r.inputHash, planner_version: r.plannerVersion,
    created_at: r.createdAt, expires_at: r.expiresAt,
    accepted_at: r.acceptedAt ?? null, abandoned_at: r.abandonedAt ?? null, completed_at: r.completedAt ?? null,
    acceptance_idempotency_key: r.acceptanceReceipt?.idempotencyKey ?? null,
    plan: r,
  };
}

/** Persist a PREVIEW plan (no reservations, no side effects). Fail-closed. */
export async function createPreviewPlan(record: DailyExperimentPlanRecord): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot persist plan (no file fallback).");
  if (record.status !== "preview") throw new Error(`createPreviewPlan: refusing non-preview status ${record.status}`);
  const { error } = await getSupabaseAdmin().from(PLANS).upsert(planToRow(record), { onConflict: "id" });
  if (error) throw new Error(`daily-plan-store: createPreviewPlan failed for ${record.id}: ${error.message}`);
}

export async function getPlan(tenantId: string, planId: string): Promise<DailyExperimentPlanRecord | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from(PLANS).select("plan").eq("tenant_id", tenantId).eq("id", planId).maybeSingle();
  if (error) { console.warn(`[daily-plan-store] getPlan ${planId}: ${error.message}`); return null; }
  return parsePlanRow(data);
}

export async function getLatestPreviewPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from(PLANS).select("plan").eq("tenant_id", tenantId).eq("status", "preview").order("created_at", { ascending: false }).limit(1);
  if (error) { console.warn(`[daily-plan-store] getLatestPreviewPlan: ${error.message}`); return null; }
  return parsePlanRow(data?.[0]);
}

export async function getAcceptedPlan(tenantId: string): Promise<DailyExperimentPlanRecord | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from(PLANS).select("plan").eq("tenant_id", tenantId).eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1);
  if (error) { console.warn(`[daily-plan-store] getAcceptedPlan: ${error.message}`); return null; }
  return parsePlanRow(data?.[0]);
}

export async function listPlans(tenantId: string, limit = 20): Promise<DailyExperimentPlanRecord[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin().from(PLANS).select("plan").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
  if (error) { console.warn(`[daily-plan-store] listPlans: ${error.message}`); return []; }
  return (data ?? []).map((r) => parsePlanRow(r)).filter((p): p is DailyExperimentPlanRecord => !!p);
}

/** Mark expired any preview plan past its TTL (single atomic UPDATE). */
export async function expirePlans(tenantId: string, now: Date): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { data, error } = await getSupabaseAdmin().from(PLANS)
    .update({ status: "expired" }).eq("tenant_id", tenantId).eq("status", "preview").lt("expires_at", now.toISOString()).select("id");
  if (error) throw new Error(`daily-plan-store: expirePlans failed: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Close an ACCEPTED plan (operator finished applying today's batch) so the next day's plan surface
 * frees up. Guarded accepted→completed; proof rows keep measuring independently. Single atomic UPDATE.
 */
export async function completePlan(tenantId: string, planId: string, now: Date): Promise<boolean> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot complete plan.");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(PLANS).select("plan").eq("tenant_id", tenantId).eq("id", planId).maybeSingle();
  if (error) throw new Error(`daily-plan-store: completePlan read failed for ${planId}: ${error.message}`);
  const plan = parsePlanRow(data);
  if (!plan || plan.status !== "accepted") return false;
  const completedAt = now.toISOString();
  const updated: DailyExperimentPlanRecord = { ...plan, status: "completed", completedAt };
  const { data: rows, error: wErr } = await admin.from(PLANS)
    .update({ status: "completed", completed_at: completedAt, plan: updated })
    .eq("tenant_id", tenantId).eq("id", planId).eq("status", "accepted").select("id");
  if (wErr) throw new Error(`daily-plan-store: completePlan failed for ${planId}: ${wErr.message}`);
  return (rows?.length ?? 0) > 0;
}

/** Abandon a PREVIEW plan (single atomic UPDATE; no reservations exist for a preview). */
export async function abandonPreviewPlan(tenantId: string, planId: string, now: Date): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured.");
  const { error } = await getSupabaseAdmin().from(PLANS)
    .update({ status: "abandoned", abandoned_at: now.toISOString() })
    .eq("tenant_id", tenantId).eq("id", planId).eq("status", "preview");
  if (error) throw new Error(`daily-plan-store: abandonPreviewPlan failed for ${planId}: ${error.message}`);
}

export type AcceptResult =
  | { ok: true; idempotent: boolean; planId: string; reservationIds: string[] }
  | { ok: false; reason: PlanAcceptanceFailureReason | string };

/**
 * ATOMIC acceptance via the Postgres RPC — all reservations insert + the plan flips to accepted, or
 * nothing does. Fail-closed (throws on transport error; returns {ok:false} on a business-rule
 * rejection). The `reservations` are the projected rows the RPC inserts.
 */
export async function acceptPlanViaRpc(input: {
  tenantId: string; planId: string; inputHash: string; idempotencyKey: string;
  reservations: Array<{ id: string; planned_experiment_id: string; treated_url: string; control_url: string; control_path: string; reserved_until: string; similarity: Record<string, unknown> }>;
}): Promise<AcceptResult> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot accept plan (no file fallback).");
  const { data, error } = await getSupabaseAdmin().rpc("accept_daily_experiment_plan", {
    p_tenant: input.tenantId, p_plan_id: input.planId, p_input_hash: input.inputHash,
    p_idempotency_key: input.idempotencyKey, p_reservations: input.reservations,
  });
  if (error) throw new Error(`daily-plan-store: accept RPC transport error for ${input.planId}: ${error.message}`);
  const res = data as { ok: boolean; idempotent?: boolean; plan_id?: string; reservation_ids?: string[]; reason?: string } | null;
  if (!res || res.ok !== true) return { ok: false, reason: res?.reason ?? "unknown" };
  return { ok: true, idempotent: !!res.idempotent, planId: res.plan_id ?? input.planId, reservationIds: res.reservation_ids ?? [] };
}

function parseReservationRow(row: Record<string, unknown>): ControlReservationRecord {
  return {
    version: 1, id: row.id as string, tenantId: row.tenant_id as string, planId: row.plan_id as string,
    plannedExperimentId: row.planned_experiment_id as string, treatedUrl: row.treated_url as string,
    controlUrl: row.control_url as string, controlPath: row.control_path as string, status: row.status as ControlReservationRecord["status"],
    reservedAt: row.reserved_at as string, reservedUntil: row.reserved_until as string,
    activatedAt: (row.activated_at as string) ?? undefined, activatedProofId: (row.activated_proof_id as string) ?? undefined,
    releasedAt: (row.released_at as string) ?? undefined, releaseReason: (row.release_reason as string) ?? undefined,
    invalidatedAt: (row.invalidated_at as string) ?? undefined, invalidationReason: (row.invalidation_reason as string) ?? undefined,
    similarity: (row.similarity as ControlReservationRecord["similarity"]) ?? { score: 0, pageFamilyMatch: false },
  };
}

/** Active (reserved|active) reservations for a tenant, optionally scoped to one plan. Fail-soft. */
export async function listActiveReservations(tenantId: string, planId?: string): Promise<ControlReservationRecord[]> {
  if (!isSupabaseConfigured()) return [];
  let q = getSupabaseAdmin().from(RESERVATIONS).select("*").eq("tenant_id", tenantId).in("status", ["reserved", "active"]);
  if (planId) q = q.eq("plan_id", planId);
  const { data, error } = await q;
  if (error) { console.warn(`[daily-plan-store] listActiveReservations: ${error.message}`); return []; }
  return (data ?? []).map((r) => parseReservationRow(r as Record<string, unknown>));
}

/** ALL reservations (any status) for one plan — for the execution read model. Fail-soft. */
export async function listReservationsForPlan(tenantId: string, planId: string): Promise<ControlReservationRecord[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin().from(RESERVATIONS).select("*").eq("tenant_id", tenantId).eq("plan_id", planId);
  if (error) { console.warn(`[daily-plan-store] listReservationsForPlan: ${error.message}`); return []; }
  return (data ?? []).map((r) => parseReservationRow(r as Record<string, unknown>));
}

export type ActivateResult =
  | { ok: true; idempotent: boolean; proofId: string; reservationIds: string[] }
  | { ok: false; reason: string };

/**
 * ATOMIC item activation via the Postgres RPC — creates the proof row, flips THIS item's reservations
 * reserved→active, and marks the plan item active, all-or-none. Idempotent. Fail-closed (throws on
 * transport error; returns {ok:false} on a business-rule rejection). The proof row is built in-app
 * (recordShippedChange reads GSC + measures) and passed as a row-shaped jsonb (snake_case columns).
 */
export async function activateItemViaRpc(input: {
  tenantId: string; planId: string; experimentId: string;
  verificationReceipt: Record<string, unknown>; proofRow: Record<string, unknown>; idempotencyKey: string;
}): Promise<ActivateResult> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot activate (no file fallback).");
  const { data, error } = await getSupabaseAdmin().rpc("activate_daily_experiment_item", {
    p_tenant: input.tenantId, p_plan_id: input.planId, p_experiment_id: input.experimentId,
    p_verification_receipt: input.verificationReceipt, p_proof_row: input.proofRow, p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error(`daily-plan-store: activate RPC transport error for ${input.experimentId}: ${error.message}`);
  const res = data as { ok: boolean; idempotent?: boolean; proof_id?: string; reservation_ids?: string[]; reason?: string } | null;
  if (!res || res.ok !== true) return { ok: false, reason: res?.reason ?? "unknown" };
  return { ok: true, idempotent: !!res.idempotent, proofId: res.proof_id ?? (input.proofRow.id as string), reservationIds: res.reservation_ids ?? [] };
}

export type SkipItemResult = { ok: true; idempotent: boolean; releasedIds: string[] } | { ok: false; reason: string };

/** ATOMIC item skip via the Postgres RPC — releases THIS item's reserved controls + marks it skipped. */
export async function skipItemViaRpc(input: {
  tenantId: string; planId: string; experimentId: string; reason: string; idempotencyKey: string;
}): Promise<SkipItemResult> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot skip item (no file fallback).");
  const { data, error } = await getSupabaseAdmin().rpc("skip_daily_experiment_item", {
    p_tenant: input.tenantId, p_plan_id: input.planId, p_experiment_id: input.experimentId,
    p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error(`daily-plan-store: skip RPC transport error for ${input.experimentId}: ${error.message}`);
  const res = data as { ok: boolean; idempotent?: boolean; released_ids?: string[]; reason?: string } | null;
  if (!res || res.ok !== true) return { ok: false, reason: res?.reason ?? "unknown" };
  return { ok: true, idempotent: !!res.idempotent, releasedIds: res.released_ids ?? [] };
}

/**
 * Write a NON-CRITICAL item execution marker (verification_pending / verification_failed /
 * gsc_submission). These have NO proof/reservation side effects, so a read-modify-write of the plan
 * jsonb is acceptable (single operator). The CRITICAL active/skipped transitions go through the atomic
 * RPCs above, never here. Fail-closed (throws). Returns the updated plan.
 */
export async function updateItemExecution(
  tenantId: string,
  planId: string,
  experimentId: string,
  mutate: (prev: ItemExecutionRecord | undefined) => ItemExecutionRecord,
): Promise<DailyExperimentPlanRecord> {
  if (!isSupabaseConfigured()) throw new Error("daily-plan-store: Supabase not configured — cannot update execution.");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(PLANS).select("plan").eq("tenant_id", tenantId).eq("id", planId).maybeSingle();
  if (error) throw new Error(`daily-plan-store: updateItemExecution read failed for ${planId}: ${error.message}`);
  const plan = parsePlanRow(data);
  if (!plan) throw new Error(`daily-plan-store: updateItemExecution: plan ${planId} not found`);
  const nowIso = new Date().toISOString();
  const execution: PlanExecutionState = plan.execution ?? { items: {}, updatedAt: nowIso };
  const next = mutate(execution.items[experimentId]);
  const updated: DailyExperimentPlanRecord = {
    ...plan,
    execution: { items: { ...execution.items, [experimentId]: next }, updatedAt: nowIso },
  };
  const { error: wErr } = await admin.from(PLANS).update({ plan: updated }).eq("tenant_id", tenantId).eq("id", planId);
  if (wErr) throw new Error(`daily-plan-store: updateItemExecution write failed for ${planId}: ${wErr.message}`);
  return updated;
}
