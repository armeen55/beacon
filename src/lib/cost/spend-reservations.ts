import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { globalMonthlyCapUsd as configuredGlobalMonthlyCapUsd } from "@/lib/cost/cost-breaker";

type Platform = "perplexity" | "openai" | "adjudicator-openai" |
  "onboarding-openai" | "dataforseo-serp" | "other";
type ReserveInput = {
  tenantId: string;
  platform: Platform;
  purpose: string;
  logicalKey: string;
  proposalWorkKey?: string | null;
  /** Exact request digest. Legacy internal callers fall back to their already-exact logical key. */
  requestFingerprint?: string;
  estimatedUsd: number;
  globalMonthlyCapUsd?: number;
  monthlyCapUsd?: number | null;
  lifetimeCapUsd?: number | null;
  cohortMember?: boolean;
  recoveryKind?: "none" | "provider_task_listing" | "provider_exact_required";
  leaseSeconds?: number;
};
type Reservation = {
  outcome: "reserved" | "resumed" | "replayed" | "conflict" | "refused_daily" | "refused_monthly" |
    "refused_lifetime" | "refused_global" | "refused_cohort" | "refused_overrun" | "invalid";
  attemptId: string | null;
  attemptOrdinal: number | null;
  state: "reserved" | "transmitted" | "ambiguous" | "reconciled" | "released" | null;
  reportingDay: string;
  estimatedUsd: number;
  accountedUsd?: number | null;
  providerTaskId: string | null;
  accountingBasis?: "provider_reported" | "provider_advance" | "usage_estimate" | "reservation_estimate" | null;
  resultPayload?: unknown | null;
};

const finiteNonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const proposalWork = new AsyncLocalStorage<string | null>();
const researchRun = new AsyncLocalStorage<{ id: string; owner: string } | null>();
export const runWithProposalWorkKey = <T>(workKey: string | null | undefined, work: () => Promise<T>): Promise<T> => proposalWork.run(workKey?.trim() || null, work);
export const runWithResearchRun = <T>(runId: string | null | undefined, owner: string | null | undefined, work: () => Promise<T>): Promise<T> => {
  const id = runId?.trim(), heldBy = owner?.trim(); return researchRun.run(id && heldBy ? { id, owner: heldBy } : null, work); };
const one = (data: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return row != null && typeof row === "object" ? row as Record<string, unknown> : null;
};
const booleanRpc = async (name: string, args: Record<string, unknown>): Promise<boolean> => {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);
  return error == null && data === true;
};

const reserve = async (input: ReserveInput): Promise<Reservation> => {
  const leaseSeconds = input.leaseSeconds ?? 900;
  const globalCapUsd = input.globalMonthlyCapUsd ?? configuredGlobalMonthlyCapUsd();
  const requestFingerprint = (input.requestFingerprint ?? input.logicalKey).trim();
  const proposalWorkKey = input.proposalWorkKey?.trim() || proposalWork.getStore() || null;
  if (!input.tenantId.trim() || !input.purpose.trim() || !input.logicalKey.trim() || !requestFingerprint
    || !finiteNonnegative(input.estimatedUsd)
    || !Number.isFinite(globalCapUsd) || globalCapUsd <= 0
    || (input.monthlyCapUsd != null && !finiteNonnegative(input.monthlyCapUsd))
    || (input.lifetimeCapUsd != null && !finiteNonnegative(input.lifetimeCapUsd))
    || !Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error("Invalid spend reservation");
  }
  const run = researchRun.getStore(); const { data, error } = await getSupabaseAdmin().rpc("reserve_spend", {
    p_tenant_id: input.tenantId,
    p_platform: input.platform,
    p_purpose: input.purpose,
    p_logical_key: input.logicalKey,
    p_request_fingerprint: requestFingerprint,
    p_estimated_usd: input.estimatedUsd,
    p_global_monthly_cap_usd: globalCapUsd,
    p_monthly_cap_usd: input.monthlyCapUsd ?? null,
    p_lifetime_cap_usd: input.lifetimeCapUsd ?? null,
    p_cohort_member: input.cohortMember ?? false,
    p_recovery_kind: input.recoveryKind ?? "none",
    p_proposal_work_key: proposalWorkKey,
    p_research_run_id: run?.id ?? null,
    p_research_run_owner: run?.owner ?? null,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Spend reservation failed: ${error.message}`);
  const row = one(data);
  if (row == null || typeof row.outcome !== "string" || typeof row.reporting_day !== "string")
    throw new Error("Spend reservation returned no receipt");
  return {
    outcome: row.outcome as Reservation["outcome"],
    attemptId: typeof row.attempt_id === "string" ? row.attempt_id : null,
    attemptOrdinal: Number.isInteger(Number(row.attempt_ordinal)) ? Number(row.attempt_ordinal) : null,
    state: typeof row.reservation_state === "string" ? row.reservation_state as Reservation["state"] : null,
    reportingDay: row.reporting_day,
    estimatedUsd: Number(row.estimated_usd ?? input.estimatedUsd),
    accountedUsd: row.accounted_usd == null ? null : Number(row.accounted_usd),
    providerTaskId: typeof row.provider_task_id === "string" ? row.provider_task_id : null,
    accountingBasis: typeof row.accounting_basis === "string" ? row.accounting_basis as Reservation["accountingBasis"] : null,
    resultPayload: row.result_payload ?? null,
  };
};

/** Exact conservative cost owned by one research run. Reconciled attempts use the provider/usage charge; a
 * transmitted or ambiguous request keeps its reserved upper bound until reconciliation proves the exact amount. */
export const researchRunSpendUsd = async (runId: string): Promise<number | null> => {
  if (!runId.trim()) return null;
  const { data, error } = await getSupabaseAdmin().from("spend_reservations")
    .select("state,estimated_usd,accounted_usd").eq("research_run_id", runId)
    .in("state", ["transmitted", "ambiguous", "reconciled"]);
  if (error || data == null) return null;
  return Math.round(data.reduce((sum, row) => sum + Number(row.state === "reconciled" ? row.accounted_usd ?? 0 : row.estimated_usd ?? 0), 0) * 1e6) / 1e6;
};

const spendReservations = {
  reserve,
  read: async (attemptId: string): Promise<{ state: string; providerTaskId: string | null;
    estimatedUsd?: number | null; accountedUsd?: number | null; accountingBasis?: string | null; resultPayload?: unknown | null } | null> => {
    if (!attemptId.trim()) return null;
    const { data, error } = await getSupabaseAdmin().from("spend_reservations").select("state,provider_task_id,estimated_usd,accounted_usd,accounting_basis,result_payload").eq("attempt_id", attemptId).maybeSingle();
    if (error || data == null) return null;
    return { state: String(data.state), providerTaskId: typeof data.provider_task_id === "string" ? data.provider_task_id : null,
      estimatedUsd: data.estimated_usd == null ? null : Number(data.estimated_usd),
      accountedUsd: data.accounted_usd == null ? null : Number(data.accounted_usd),
      accountingBasis: typeof data.accounting_basis === "string" ? data.accounting_basis : null,
      resultPayload: data.result_payload ?? null };
  },
  setCohortHold: (tenantId: string, holdUsd: number) => {
    if (!tenantId.trim() || !finiteNonnegative(holdUsd)) return Promise.resolve(false);
    return booleanRpc("set_cohort_spend_hold", { p_tenant_id: tenantId, p_hold_usd: holdUsd });
  },
  releaseUnusedCohortHold: (tenantId: string) => !tenantId.trim()
    ? Promise.resolve(false)
    : booleanRpc("release_unused_cohort_spend_hold", { p_tenant_id: tenantId }),
  claimTransmission: async (attemptId: string) => {
    if (!attemptId.trim()) return "unavailable" as const;
    const { data, error } = await getSupabaseAdmin().rpc("claim_spend_transmission", { p_attempt_id: attemptId });
    return error == null && (data === "claimed" || data === "already_started" || data === "cap_refused" || data === "work_retired" || data === "stale_day" || data === "run_inactive") ? data : "unavailable" as const;
  },
  markAmbiguous: (attemptId: string, providerTaskId?: string | null, resultPayload?: unknown) => !attemptId.trim()
    ? Promise.resolve(false)
    : booleanRpc("mark_spend_ambiguous", { p_attempt_id: attemptId, p_provider_task_id: providerTaskId ?? null, p_result_payload: resultPayload ?? null }),
  release: (attemptId: string, zeroCostProven = false) => !attemptId.trim()
    ? Promise.resolve(false)
    : booleanRpc("release_spend", {
      p_attempt_id: attemptId, p_zero_cost_proven: zeroCostProven,
    }),
  reconcile: (attemptId: string, accountedUsd: number, providerTaskId?: string | null,
    accountingBasis: "provider_reported" | "provider_advance" | "usage_estimate" | "reservation_estimate" = "provider_reported", resultPayload?: unknown) => {
    if (!attemptId.trim() || !finiteNonnegative(accountedUsd)) return Promise.resolve(false);
    return booleanRpc("reconcile_spend", {
      p_attempt_id: attemptId,
      p_accounted_usd: accountedUsd,
      p_provider_task_id: providerTaskId ?? null,
      p_accounting_basis: accountingBasis,
      p_result_payload: resultPayload ?? null,
    });
  },
};

export default spendReservations;
