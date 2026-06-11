import "server-only";

/**
 * 2026-06-10 — the factory gets a product surface (P0 wall 4).
 *
 * `generateClusterCards` existed with ZERO callers. This module is the
 * missing orchestration between the operator surface and the factory:
 *
 *   parse/validate plan → per-tenant daily budget gate → generate →
 *   persist drafts as `recommended_edits` rows (status "recommended",
 *   create_page cards in the SAME approve queue as everything else) →
 *   record the LLM spend in the ledger.
 *
 * Invariants preserved:
 *   • Generated pages NEVER ship from here — they land in the queue;
 *     pushing walks the capped push path after the operator's approve.
 *   • Banned-term violations were HARD-REJECTED inside the factory
 *     (audit #47); rejected counts surface in the result.
 *   • Budget: refuses when the tenant has already spent ≥ its
 *     daily_budget_usd today (same semantics as the poll cap, #31).
 */

import { createHash } from "node:crypto";

import { getTenant } from "@/domains/tenants/store";
import {
  generateClusterCards,
  type ClusterDeps,
  type ClusterFactoryResult,
  type ClusterPlan,
} from "@/domains/push/cluster-factory";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import {
  getTenantSpentTodayUsd,
  recordSpendDualWrite,
} from "@/lib/cost/budget-ledger-supabase";

const GLOBAL_DEFAULT_DAILY_BUDGET_USD = 10;

export type ParsePlanResult =
  | { ok: true; plan: ClusterPlan }
  | { ok: false; error: string };

/** Validate an operator-pasted cluster plan. Pure. */
export function parseClusterPlan(raw: string): ParsePlanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "plan must be a JSON object" };
  }
  const p = parsed as Record<string, unknown>;
  const str = (k: string) => typeof p[k] === "string" && (p[k] as string).trim() !== "";
  for (const k of ["name", "dataCollectionId", "slugField", "urlPrefix", "siteBaseUrl"]) {
    if (!str(k)) return { ok: false, error: `missing required string field "${k}"` };
  }
  if (!Array.isArray(p.fields) || p.fields.length === 0) {
    return { ok: false, error: "fields must be a non-empty array of {field, instruction}" };
  }
  for (const f of p.fields as Array<Record<string, unknown>>) {
    if (typeof f?.field !== "string" || typeof f?.instruction !== "string") {
      return { ok: false, error: "every fields[] entry needs string field + instruction" };
    }
  }
  if (!Array.isArray(p.items) || p.items.length === 0) {
    return { ok: false, error: "items must be a non-empty array of {slug, title, brief}" };
  }
  for (const i of p.items as Array<Record<string, unknown>>) {
    if (typeof i?.slug !== "string" || typeof i?.title !== "string" || typeof i?.brief !== "string") {
      return { ok: false, error: "every items[] entry needs string slug + title + brief" };
    }
  }
  const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : []);
  const plan: ClusterPlan = {
    name: p.name as string,
    dataCollectionId: p.dataCollectionId as string,
    slugField: p.slugField as string,
    urlPrefix: p.urlPrefix as string,
    siteBaseUrl: p.siteBaseUrl as string,
    fields: p.fields as ClusterPlan["fields"],
    items: p.items as ClusterPlan["items"],
    contentRules: arr("contentRules").filter((x): x is string => typeof x === "string"),
    flaggedTerms: arr("flaggedTerms").filter((x): x is string => typeof x === "string"),
  };
  return { ok: true, plan };
}

/** Deterministic queue rows from factory drafts. Pure. Re-running the
 *  same plan upserts the same row ids (no duplicates). */
export function draftsToRows(
  drafts: Extract<ClusterFactoryResult, { ok: true }>["drafts"],
  tenantId: string,
  now: Date,
): RecommendedEditRow[] {
  const nowIso = now.toISOString();
  return drafts.map((d) => {
    const recId = `factory-${createHash("sha1").update(`${tenantId}::${d.target_url}`).digest("hex").slice(0, 16)}`;
    return {
      id: `${recId}__${d.action_type}__${d.target_element_key ?? "null"}`,
      tenant_id: tenantId,
      rec_id: recId,
      action_type: d.action_type,
      target_url: d.target_url,
      target_element_key: d.target_element_key,
      display_label: d.display_label,
      current_text: d.current_text,
      proposed_text: d.proposed_text,
      why: d.why,
      evidence: [{ type: "owned_page", url: d.target_url }],
      expected_impact: d.expected_impact,
      difficulty: d.difficulty,
      confidence: d.confidence,
      measurement_plan: d.measurement_plan,
      risks: d.risks,
      source: "openai",
      provider_name: "cluster-factory",
      evidence_hash: null,
      model: d.model,
      cost_usd: d.cost_usd,
      created_at: nowIso,
      updated_at: nowIso,
      implementation_status: "recommended",
      live_at: null,
      live_snapshot_id: null,
      live_match_confidence: null,
      live_match_kind: null,
      live_element_key: null,
      not_found_reason: null,
    } as RecommendedEditRow;
  });
}

export type FactoryRunResult =
  | {
      ok: true;
      persisted: number;
      flagged: number;
      rejected: number;
      rejectedReasons: string[];
      totalCostUsd: number;
      syncWarning: string | null;
    }
  | {
      ok: false;
      reason:
        | "budget_exhausted"
        | "llm_disabled"
        | "too_many_items"
        | "api_error";
      detail?: string;
    };

export type FactoryRunDeps = {
  generate?: (plan: ClusterPlan, deps?: ClusterDeps) => Promise<ClusterFactoryResult>;
  getSpentTodayUsd?: (tenantId: string) => Promise<number | null>;
  persistLocal?: (rows: RecommendedEditRow[]) => Promise<void>;
  syncRows?: (rows: RecommendedEditRow[], tenantId: string) => Promise<void>;
  recordSpend?: typeof recordSpendDualWrite;
  now?: Date;
};

/** Orchestrate one factory run for a tenant. The CALLER (server action)
 *  enforces publish authorization; this enforces budget + persistence. */
export async function runClusterFactoryForTenant(
  tenantId: string,
  plan: ClusterPlan,
  deps: FactoryRunDeps = {},
): Promise<FactoryRunResult> {
  const now = deps.now ?? new Date();

  // Per-tenant daily spend ceiling (same fail-open semantics as the
  // poll cap — unknown spend never blocks; a known breach refuses).
  const getSpent = deps.getSpentTodayUsd ?? getTenantSpentTodayUsd;
  const spent = await getSpent(tenantId);
  const tenant = await getTenant(tenantId);
  const capUsd =
    typeof tenant?.daily_budget_usd === "number" && tenant.daily_budget_usd > 0
      ? tenant.daily_budget_usd
      : GLOBAL_DEFAULT_DAILY_BUDGET_USD;
  if (spent != null && spent >= capUsd) {
    return {
      ok: false,
      reason: "budget_exhausted",
      detail: `spent $${spent.toFixed(2)} of $${capUsd.toFixed(2)} today`,
    };
  }

  const generate = deps.generate ?? generateClusterCards;
  const result = await generate(plan);
  if (!result.ok) {
    return { ok: false, reason: result.reason, detail: result.detail };
  }

  const rows = draftsToRows(result.drafts, tenantId, now);
  let syncWarning: string | null = null;
  if (rows.length > 0) {
    const { persistRecommendedEditsLocal } = await import(
      "@/domains/recommendations/recommended-edits-persistence"
    );
    const { syncRecommendedEdits } = await import("@/lib/persistence/dual-write");
    await (deps.persistLocal ?? persistRecommendedEditsLocal)(rows);
    try {
      await (deps.syncRows ?? syncRecommendedEdits)(rows, tenantId);
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : String(err);
    }
  }

  if (result.totalCostUsd > 0) {
    await (deps.recordSpend ?? recordSpendDualWrite)({
      tenantId,
      platform: "openai",
      costUsd: result.totalCostUsd,
      metadata: { source: "cluster-factory", cluster: plan.name, items: plan.items.length },
    });
  }

  return {
    ok: true,
    persisted: rows.length,
    flagged: result.flagged,
    rejected: result.rejected,
    rejectedReasons: result.rejectedReasons,
    totalCostUsd: result.totalCostUsd,
    syncWarning,
  };
}
