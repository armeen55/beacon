import "server-only";

/**
 * funnel/shared (Slice 6, Agent B) - the injected deps + the boundary plumbing
 * every executor reuses: constants, the cached-call spec builder, the honest
 * CachedCallResult interpreter, ledger tracking, and the local engine-model
 * fallback. No executor logic lives here.
 */

import { createHash } from "node:crypto";

import type { Account, BusinessProfile } from "@/domains/account";
import { getTenant, loadBusinessProfile } from "@/domains/account";
import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { loadCrawlFrontier, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { syncPromptAnswerObservations } from "@/lib/persistence/dual-write";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type { CachedCallResult, CachedCallSpec } from "@/domains/evidence/dataforseo/funnel-boundary";
import { cachedDataForSeoCall, collectDataForSeoTask } from "@/domains/evidence/dataforseo/funnel-boundary";
import { loadFunnelState, saveFunnelState, type FunnelState } from "./state";

export const LOC = 2840, LANG = "en";
const TTL = 14 * 24 * 3600 * 1000;
export const FRESH_MS = 7 * 24 * 3600 * 1000;

/** Conservative reservations (reserve-before-network), USD. AI observations are
 *  ~$0.03/call (engine-types.ts documented rate), so those reserve AT OR ABOVE
 *  actual; reconciliation refunds any overestimate, so erring high is free and
 *  the monthly cap genuinely bounds spend. */
export const EST = { labs: 0.012, overview: 0.02, serp: 0.0021, aiMode: 0.01, answer: 0.035, scraper: 0.035, perplexity: 0.035 };
export const EP = {
  forSite: "dataforseo_labs/google/keywords_for_site/live",
  ranked: "dataforseo_labs/google/ranked_keywords/live",
  related: "dataforseo_labs/google/related_keywords/live",
  suggest: "dataforseo_labs/google/keyword_suggestions/live",
  overview: "dataforseo_labs/google/keyword_overview/live",
  serp: "serp/google/organic/task_post",
  aiMode: "serp/google/ai_mode/task_post",
} as const;
export const AI_EP: Record<string, string> = {
  chatgpt: "ai_optimization/chat_gpt/llm_responses",
  gemini: "ai_optimization/gemini/llm_responses",
  claude: "ai_optimization/claude/llm_responses",
  perplexity: "ai_optimization/perplexity/llm_responses",
  scraper: "ai_optimization/chat_gpt/llm_scraper",
};
// The requested full model id per engine. The per-observation modelServed field
// is what guards against provider model drift (a served-model change is its own
// evidence boundary); a live models-endpoint refresh can refine this map later.
export const MODEL: Record<string, string> = { chatgpt: "gpt-4o", gemini: "gemini-1.5-pro", claude: "claude-3-5-sonnet-latest", perplexity: "sonar" };

export type FunnelDeps = {
  callProvider?: (spec: CachedCallSpec) => Promise<CachedCallResult>;
  collectTask?: (cacheKey: string) => Promise<CachedCallResult>;
  loadProfile?: (tenantId: string) => Promise<BusinessProfile>;
  loadCrawl?: (tenantId: string) => Promise<CrawlFrontierState | null>;
  getAccount?: (tenantId: string) => Promise<Account | null>;
  loadActivePrompts?: (tenantId: string) => Promise<{ id: string; text: string }[]>;
  syncHistory?: (rows: PromptAnswerObservation[], tenantId: string) => Promise<void>;
  fetchPage?: typeof fetchPageHtml;
  loadState?: (tenantId: string) => Promise<FunnelState>;
  saveState?: (tenantId: string, state: FunnelState) => Promise<void>;
  now?: () => number;
};

export type ResolvedDeps = ReturnType<typeof resolveDeps>;

export function resolveDeps(deps: FunnelDeps) {
  return {
    callProvider: deps.callProvider ?? ((s: CachedCallSpec) => cachedDataForSeoCall(s)),
    collectTask: deps.collectTask ?? ((k: string) => collectDataForSeoTask(k)),
    loadProfile: deps.loadProfile ?? loadBusinessProfile,
    loadCrawl: deps.loadCrawl ?? loadCrawlFrontier,
    getAccount: deps.getAccount ?? getTenant,
    loadActivePrompts: deps.loadActivePrompts ?? defaultActivePrompts,
    syncHistory: deps.syncHistory ?? syncPromptAnswerObservations,
    fetchPage: deps.fetchPage ?? fetchPageHtml,
    loadState: deps.loadState ?? loadFunnelState,
    saveState: deps.saveState ?? saveFunnelState,
    now: deps.now ?? Date.now,
  };
}

async function defaultActivePrompts(tenantId: string): Promise<{ id: string; text: string }[]> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const { data, error } = await getSupabaseAdmin()
      .from("tracked_prompts")
      .select("id,text")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .contains("tags", ["core_v1"])
      .limit(100);
    if (error) return [];
    return ((data ?? []) as { id: string; text: string }[]).filter((r) => r.id && r.text);
  } catch {
    return [];
  }
}

export const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const round = (n: number) => Math.round(n * 10000) / 10000;

export type Interp = { kind: "evidence" | "waiting" | "failed" | "soft"; hit: boolean; payload?: unknown; cacheKey: string | null; costUsd: number; modelServed: string | null; detail?: string };

/** Interpret a boundary result: hit/ok carry evidence; waiting is durable/resumable;
 *  capped/error are recoverable failures; not_configured/dry_run are "soft" (no
 *  evidence, but not a hard abort while cached evidence may already exist). */
export function interp(r: CachedCallResult): Interp {
  switch (r.state) {
    case "hit": return { kind: "evidence", hit: true, payload: r.payload, cacheKey: r.cacheKey, costUsd: 0, modelServed: r.modelServed };
    case "ok": return { kind: "evidence", hit: false, payload: r.payload, cacheKey: r.cacheKey, costUsd: r.costUsd, modelServed: r.modelServed };
    case "waiting": return { kind: "waiting", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, detail: r.detail };
    case "capped":
    case "error": return { kind: "failed", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, detail: r.detail };
    default: return { kind: "soft", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, detail: r.detail };
  }
}

export function track(state: FunnelState, r: Interp): void {
  state.ledger.spentUsd += r.costUsd;
  if (r.hit) state.ledger.cacheHits += 1;
}

export function buildSpec(tenantId: string, unitKey: string, endpoint: string, payload: unknown[], publicInput: Record<string, unknown>, mode: "live" | "task", estCostUsd: number, model?: string): CachedCallSpec {
  // AI observations cache no longer than the 7-day freshness window, so a due
  // re-observation re-fetches instead of re-stamping a stale cached answer.
  const ttlMs = endpoint.startsWith("ai_optimization/") ? FRESH_MS : TTL;
  return { endpoint, payload, publicInput, locationCode: LOC, languageCode: LANG, ttlMs, estCostUsd, mode, tenantId, unitKey, ...(model ? { modelRequested: model } : {}) };
}

export async function save(d: ResolvedDeps, tenantId: string, state: FunnelState): Promise<void> {
  state.updatedAt = new Date(d.now()).toISOString();
  await d.saveState(tenantId, state);
}
