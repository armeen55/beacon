import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import { dailyCapReason, shareFor } from "@/lib/cost/daily-cap";
import { log } from "@/lib/logger";
import type { CachedCallDeps } from "./cached-call";
import type { FunnelBoundaryDeps } from "./funnel-boundary";

/**
 * default-deps - the PRODUCTION wiring of every cached-call I/O seam onto
 * Supabase (claim / reserve / adjust RPCs + the evidence_cache table). Built
 * lazily and always overridable, so an injecting test never touches Supabase and
 * never spends. The algorithm lives in cached-call.ts; only the plumbing is here.
 */

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** Internal: a persistence failure that must NEVER be mistaken for "no row". */
class CachePersistenceError extends Error {}

/** Production defaults first, caller-injected seams last (injection always wins). */
export function resolveDeps(deps: FunnelBoundaryDeps): CachedCallDeps {
  return { ...buildDefaultDeps(process.env), ...(deps as unknown as Partial<CachedCallDeps>) };
}

function buildDefaultDeps(env: NodeJS.ProcessEnv): CachedCallDeps {
  const rpc = (fn: string, params: Record<string, unknown>) => getSupabaseAdmin().rpc(fn, params);
  return {
    env,
    now: () => new Date(),
    fetchImpl: fetch,
    claimEvidenceFetch: async (p) => {
      const { data, error } = await rpc("claim_evidence_fetch", {
        p_cache_key: p.cacheKey, p_endpoint: p.endpoint, p_endpoint_version: p.endpointVersion,
        p_input_hash: p.inputHash, p_input_summary: p.inputSummary, p_location_code: p.locationCode,
        p_language_code: p.languageCode, p_device: p.device, p_model_requested: p.modelRequested,
        p_claim_seconds: p.claimSeconds,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      return {
        outcome: ((row?.outcome as string) ?? "claimed") as Awaited<ReturnType<CachedCallDeps["claimEvidenceFetch"]>>["outcome"],
        payload: row?.payload ?? null,
        providerTaskId: (row?.provider_task_id as string) ?? null,
        modelServed: (row?.model_served as string) ?? null,
        readyAt: (row?.ready_at as string) ?? null,
        costUsd: Number(row?.cost_usd ?? 0),
      };
    },
    reserveProviderSpend: async (tenantId, platform, amount, monthlyCap, purpose) => {
      // THE OPERATOR'S DAILY CAP GATES SEARCH BUYS TOO: one day-total across every platform on the ledger,
      // asked before the monthly reservation, failing closed when today's spend cannot be read. Bulk buying
      // stops short of the fact-check reserve, so the day's one fact unit is reachable at the real cap.
      const daily = await dailyCapReason(tenantId, new Date(), shareFor("search", purpose), amount).catch(() => "Today's spend could not be read, so no more is spent today.");
      if (daily != null && amount > 0) { log.info("[dataforseo] the daily budget refused this call", { tenantId, platform, daily }); return false; }
      const { data, error } = await rpc("reserve_provider_spend", { p_tenant_id: tenantId, p_platform: platform, p_amount: amount, p_monthly_cap: monthlyCap });
      if (error) throw new Error(error.message);
      return data === true;
    },
    adjustProviderSpend: async (tenantId, platform, delta) => {
      const { data, error } = await rpc("adjust_provider_spend", { p_tenant_id: tenantId, p_platform: platform, p_delta: delta });
      return error ? false : data === true;
    },
    cacheRead: async (cacheKey) => {
      // FAIL CLOSED: a records outage must never look like a cache miss. Swallowing
      // this error is how a paused, possibly-paid attempt gets bought a second time.
      const { data, error } = await getSupabaseAdmin().from("evidence_cache").select("*").eq("cache_key", cacheKey).maybeSingle();
      if (error) throw new CachePersistenceError(`evidence_cache read failed: ${error.message}`);
      return (data as Awaited<ReturnType<CachedCallDeps["cacheRead"]>>) ?? null;
    },
    cacheWrite: async (cacheKey, patch) => {
      // Fail closed TWICE over: a swallowed error, OR an UPDATE that matched zero
      // rows, is how a paid result is lost or a task is silently reposted. Postgres
      // reports "no error" for an update that changed nothing, so chain a select
      // and treat an empty rowcount as a failed write.
      const { data, error } = await getSupabaseAdmin().from("evidence_cache").update({ ...patch, updated_at: new Date().toISOString() }).eq("cache_key", cacheKey).select("cache_key");
      if (error) throw new Error(`evidence_cache update failed: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) throw new Error(`evidence_cache update matched no row for ${cacheKey}`);
    },
    // EXEMPT from the zero-row check by construction: an upsert either inserts or
    // updates, so it always affects exactly one row; only the error can fail.
    cacheUpsert: async (cacheKey, row) => {
      const { error } = await getSupabaseAdmin().from("evidence_cache").upsert({ cache_key: cacheKey, ...row, updated_at: new Date().toISOString() }, { onConflict: "cache_key" });
      if (error) throw new Error(`evidence_cache upsert failed: ${error.message}`);
    },
    breaker: async (e, now, projected) => {
      if (underVitest()) return { tripped: false };
      return assertPaidCallAllowed({ projectedCostUsd: projected }, { env: e, now: () => now });
    },
  };
}
