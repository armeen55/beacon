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
} from "@/domains/evidence/dataforseo/funnel-boundary";
import {
  providerCall,
  collectCapability,
  parseCapability,
  readPublicPageExtract,
  writePublicPageExtract,
} from "@/domains/evidence/dataforseo/funnel-boundary";
import { loadFunnelState, saveFunnelState, type FunnelState, type LoadedFunnelState } from "./state";

/** AI observations cache no longer than freshness so a due re-observation re-fetches. */
export const FRESH_MS = 7 * 24 * 3600 * 1000;

export type FunnelDeps = {
  callProvider?: <K extends CapabilityKey>(capability: K, input: CapabilityInputByKey[K], ids: { tenantId: string; unitKey: string }) => Promise<CachedCallResult>;
  collectTask?: (cacheKey: string) => Promise<CachedCallResult>;
  parse?: typeof parseCapability;
  readPageExtract?: typeof readPublicPageExtract;
  writePageExtract?: typeof writePublicPageExtract;
  loadProfile?: (tenantId: string) => Promise<BusinessProfile>;
  loadCrawl?: (tenantId: string) => Promise<CrawlFrontierState | null>;
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

/** The account's CURRENT onboarding basis, injected by Runtime into the cursor.
 *  Absent basis is fail-closed by the executors (never scoped to a wrong basis). */
export function basisFromCursor(cursor: Record<string, unknown> | null): string {
  return cursor && typeof cursor.basis === "string" ? cursor.basis.trim() : "";
}

export const NO_BASIS_DETAIL = "I could not tell which business setup to research yet. Please finish onboarding, then I will research it.";

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
  /** Which soft state produced a "soft" kind: not_configured is genuine unavailable
   *  coverage; dry_run is a benign dev/test no-spend pass. */
  soft?: "not_configured" | "dry_run"; detail?: string;
};

/** Interpret a boundary result: hit/ok carry evidence; waiting is durable/resumable
 *  and now carries the accepted-POST cost exactly once; capped/error are recoverable
 *  failures; not_configured/dry_run are "soft" (tagged so the funnel can tell genuine
 *  unavailable coverage from a dev no-spend pass). */
export function interp(r: CachedCallResult): Interp {
  switch (r.state) {
    case "hit": return { kind: "evidence", hit: true, payload: r.envelope, cacheKey: r.cacheKey, costUsd: 0, modelServed: r.modelServed, modelRequested: null };
    case "ok": return { kind: "evidence", hit: false, payload: r.envelope, cacheKey: r.cacheKey, costUsd: r.costUsd, modelServed: r.modelServed, modelRequested: r.modelRequested ?? null };
    case "waiting": return { kind: "waiting", hit: false, cacheKey: r.cacheKey, costUsd: r.costUsd, modelServed: null, modelRequested: r.modelRequested ?? null, detail: r.detail };
    case "capped":
    case "error": return { kind: "failed", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, modelRequested: null, detail: r.detail };
    default: return { kind: "soft", hit: false, cacheKey: r.cacheKey, costUsd: 0, modelServed: null, modelRequested: null, soft: r.state, detail: r.detail };
  }
}

export function track(state: FunnelState, r: Interp): void {
  state.ledger.spentUsd += r.costUsd;
  if (r.hit) state.ledger.cacheHits += 1;
}

/** Basis-scoped optimistic save. Advances ctx.rowVersion, or throws on conflict. */
export async function save(d: ResolvedDeps, tenantId: string, basisTag: string, state: FunnelState, ctx: SaveCtx): Promise<void> {
  state.updatedAt = new Date(d.now()).toISOString();
  const next = await d.saveState(tenantId, basisTag, state, ctx.rowVersion);
  if (next == null) throw new StateConflictError();
  ctx.rowVersion = next;
}
