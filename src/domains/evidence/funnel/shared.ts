import "server-only";

/**
 * funnel/shared (integrity closure, Agent B) - the injected deps + boundary
 * plumbing every executor reuses. The registry owns provider paths, costs and
 * models now, so this file carries NO endpoint/cost/model maps: executors name a
 * CAPABILITY and hand the boundary a public input, then parse the returned typed
 * envelope. State reads/writes are basis-scoped with optimistic row_version.
 */

import { createHash } from "node:crypto";

import type { Account, BusinessProfile } from "@/domains/account";
import { getTenant, loadBusinessProfile } from "@/domains/account";
import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { loadCrawlFrontier, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { syncPromptAnswerObservations } from "@/lib/persistence/dual-write";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import type {
  CachedCallResult,
  CapabilityInputByKey,
  CapabilityKey,
  FailureDisposition,
} from "@/domains/evidence/dataforseo/funnel-boundary";
import type { ResearchWinningAppearance } from "./research-evidence";
import {
  providerCall,
  collectCapability,
  parseCapability,
  readPublicPageExtract,
  writePublicPageExtract,
} from "@/domains/evidence/dataforseo/funnel-boundary";
import { loadFunnelState, saveFunnelState, type FunnelState, type LoadedFunnelState } from "./state";
// ONE tag vocabulary: the set Settings writes is byte-for-byte the set I check.
import { PROMPT_TAGS } from "@/domains/runtime/prompt-set";

/** THE one freshness window for every observation the funnel keeps: AI answers and
 *  search looks are re-observed WEEKLY. A done row older than this is due and
 *  re-enters the same boundary; OUR one-day evidence cache (the collected row's
 *  ttl) still deduplicates a repeat inside a day, never double-paying per day. */
export const FRESH_MS = 7 * 24 * 3600 * 1000;

export type FunnelDeps = {
  callProvider?: <K extends CapabilityKey>(capability: K, input: CapabilityInputByKey[K], ids: { tenantId: string; unitKey: string }) => Promise<CachedCallResult>;
  collectTask?: (cacheKey: string) => Promise<CachedCallResult>;
  parse?: typeof parseCapability;
  readPageExtract?: typeof readPublicPageExtract;
  writePageExtract?: typeof writePublicPageExtract;
  loadProfile?: (tenantId: string) => Promise<BusinessProfile>;
  loadCrawl?: (tenantId: string) => Promise<CrawlFrontierState | null>;
  /** Test seam for winning-page citation-target resolution (defaults to the real
   *  redirect-only resolver in competitor-intel/polite-fetch). */
  resolveCitations?: (appearances: ResearchWinningAppearance[], fetchImpl?: typeof fetch, deadlineMs?: number) => Promise<ResearchWinningAppearance[]>;
  getAccount?: (tenantId: string) => Promise<Account | null>;
  loadActivePrompts?: (tenantId: string) => Promise<{ id: string; text: string }[]>;
  syncHistory?: (rows: PromptAnswerObservation[], tenantId: string) => Promise<void>;
  fetchPage?: typeof fetchPageHtml;
  loadState?: (tenantId: string, basisTag: string) => Promise<LoadedFunnelState>;
  saveState?: (tenantId: string, basisTag: string, state: FunnelState, expectedRowVersion: number) => Promise<number | null>;
  now?: () => number;
};

export type ResolvedDeps = ReturnType<typeof resolveDeps>;

export function resolveDeps(deps: FunnelDeps) {
  return {
    callProvider: deps.callProvider ?? providerCall,
    collectTask: deps.collectTask ?? ((k: string) => collectCapability(k)),
    parse: deps.parse ?? parseCapability,
    readPageExtract: deps.readPageExtract ?? readPublicPageExtract,
    writePageExtract: deps.writePageExtract ?? writePublicPageExtract,
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
      .contains("tags", JSON.stringify([PROMPT_TAGS.core]))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(100);
    if (error) return [];
    return ((data ?? []) as { id: string; text: string }[]).filter((r) => r.id && r.text);
  } catch {
    return [];
  }
}

export const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const round = (n: number) => Math.round(n * 10000) / 10000;

/** The account's CURRENT onboarding basis, injected by Runtime into the cursor.
 *  Absent basis is fail-closed by the executors (never scoped to a wrong basis). */
export function basisFromCursor(cursor: Record<string, unknown> | null): string {
  return cursor && typeof cursor.basis === "string" ? cursor.basis.trim() : "";
}

export const NO_BASIS_DETAIL = "I need your confirmed business details before I can research. Open Settings, Business info and save them.";

/** Raised by save() when the stored row moved underneath us; each executor
 *  catches it and fails closed (a genuine pause, never a corrupt overwrite). */
export class StateConflictError extends Error {
  constructor() {
    super("research state moved underneath the writer");
    this.name = "StateConflictError";
  }
}
export const CONFLICT_DETAIL = "My research notes changed while I was saving. I will pick this up again on the next pass.";

export type SaveCtx = { rowVersion: number };

export type Interp = {
  kind: "evidence" | "waiting" | "failed" | "soft";
  hit: boolean; payload?: unknown; cacheKey: string | null; costUsd: number;
  modelServed: string | null; modelRequested: string | null;
  /** The boundary's structured failure vocabulary, carried through so an executor
   *  NEVER treats every failure identically: the disposition alone decides whether
   *  a task is retried free, reposted once, or paused without spending again. */
  disposition?: FailureDisposition;
  /** Missing credentials are genuine unavailable coverage. */
  soft?: "not_configured"; detail?: string;
};

/** Interpret a boundary result: hit/ok carry evidence; waiting is durable/resumable
 *  and now carries the accepted-POST cost exactly once; capped/error are recoverable
 *  failures carrying a DISPOSITION; not_configured is soft unavailable coverage. */
export function interp(r: CachedCallResult): Interp {
  switch (r.state) {
    case "hit": return { kind: "evidence", hit: true, payload: r.envelope, cacheKey: r.cacheKey, costUsd: 0, modelServed: r.modelServed, modelRequested: null };
    case "ok": return { kind: "evidence", hit: false, payload: r.envelope, cacheKey: r.cacheKey, costUsd: r.costUsd, modelServed: r.modelServed, modelRequested: r.modelRequested ?? null };
    case "waiting": return { kind: "waiting", hit: false, cacheKey: r.cacheKey, costUsd: r.costUsd, modelServed: null, modelRequested: r.modelRequested ?? null, detail: r.detail };
    // A spend cap is a plain recoverable pause, never a dead task identity.
    case "capped": return { kind: "failed", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, modelRequested: null, disposition: "none", detail: r.detail };
    case "error": return { kind: "failed", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, modelRequested: null, disposition: r.disposition, detail: r.detail };
    default: return { kind: "soft", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, modelRequested: null, soft: r.state, detail: r.detail };
  }
}

/** ONE plain sentence per failure disposition, in Beacon voice: what happened and
 *  what I will do next. Callers never parse provider detail strings. */
export function pauseDetail(disposition: FailureDisposition | undefined, fallback: string): string {
  switch (disposition) {
    case "retry_free": return "A research request did not come back this time. I kept it and I will collect it for free on the next pass.";
    case "blocked": return "One research request was turned down. I set it aside so I do not repeat it, and I will try the rest.";
    case "quarantined": return "I set one request aside so I do not run it twice. I will keep checking whether it can finish.";
    case "repost_once": return "One research request timed out. I will run it once more on your next visit.";
    default: return fallback;
  }
}

/** Runtime ALWAYS injects the real run id + cycle key into the funnel cursor; the
 *  fallback covers only a direct unit call outside a run. A NEW run id resets the
 *  per-cycle receipt so what I report is this run's spend, not a lifetime total. */
export function beginCycle(state: FunnelState, cursor: Record<string, unknown> | null, fallbackRunId: string): string {
  const runId = typeof cursor?.runId === "string" && cursor.runId.trim() ? cursor.runId.trim() : fallbackRunId;
  const cycleKey = typeof cursor?.cycle === "string" && cursor.cycle.trim() ? cursor.cycle.trim() : null;
  if (state.cycle.runId !== runId) state.cycle = { runId, cycleKey, spentUsd: 0, cacheHits: 0 };
  return runId;
}

/** Every provider result lands twice: the basis LIFETIME ledger and THIS run's receipt. */
export function track(state: FunnelState, r: Interp): void {
  state.ledger.spentUsd += r.costUsd;
  state.cycle.spentUsd += r.costUsd;
  if (r.hit) { state.ledger.cacheHits += 1; state.cycle.cacheHits += 1; }
}

/** Basis-scoped optimistic save. Advances ctx.rowVersion, or throws on conflict. */
export async function save(d: ResolvedDeps, tenantId: string, basisTag: string, state: FunnelState, ctx: SaveCtx): Promise<void> {
  state.updatedAt = new Date(d.now()).toISOString();
  const next = await d.saveState(tenantId, basisTag, state, ctx.rowVersion);
  if (next == null) throw new StateConflictError();
  ctx.rowVersion = next;
}
