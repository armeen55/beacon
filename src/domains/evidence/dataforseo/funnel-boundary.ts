import "server-only";

/**
 * funnel-boundary (Slice 6, 2026-07-25) - THE frozen seam between the DataForSEO
 * transport/cache/money core (dataforseo/) and the research funnel (funnel/).
 *
 * Contract rules (frozen by the orchestrator; do not widen casually):
 *   - Every provider call in the funnel goes through cachedDataForSeoCall or
 *     collectDataForSeoTask. No funnel code touches fetch, the ledger, or the
 *     cache table directly.
 *   - CACHE identity is PUBLIC: endpoint + version + normalized input + location
 *     + language + device + model + response form. Never a tenant id.
 *   - PAID-ATTEMPT identity is account-scoped: tenantId + unitKey (the Research
 *     Run unit of work). Spend lands in llm_budget_ledger under the caller's
 *     account; a cache hit reserves and records $0.
 *   - Money order is reserve -> network -> reconcile, atomic in Postgres.
 *   - "waiting" is a durable, resumable state (Standard provider task posted or
 *     another invocation fetching); it is never an error and never completion.
 */

// ── the cached provider call ────────────────────────────────────────────────

export type CachedCallSpec = {
  /** Canonical endpoint path (no scheme/host), e.g. "serp/google/organic/task_post". */
  endpoint: string;
  endpointVersion?: string;
  /** The provider request body (DataForSEO array-of-task form). */
  payload: unknown[];
  /** Normalized PUBLIC input identity fields (sorted/stable); becomes the input hash. */
  publicInput: Record<string, unknown>;
  locationCode: number;
  languageCode: string;
  device?: "desktop" | "mobile";
  modelRequested?: string;
  /** Freshness window for the cached evidence. */
  ttlMs: number;
  /** Conservative projected cost reserved BEFORE the network call. */
  estCostUsd: number;
  /** "live" resolves in one call; "task" posts a Standard task and resumes via GET. */
  mode: "live" | "task";
  /** Paid-attempt identity: the account charged on a miss. */
  tenantId: string;
  /** Logical unit of work inside the Research Run (idempotency + receipts). */
  unitKey: string;
};

export type CachedCallResult =
  | { state: "hit"; payload: unknown; costUsd: 0; cacheKey: string; modelServed: string | null }
  | { state: "ok"; payload: unknown; costUsd: number; cacheKey: string; modelServed: string | null }
  | { state: "waiting"; cacheKey: string; providerTaskId: string | null; detail: string }
  | { state: "not_configured" | "dry_run" | "capped" | "error"; cacheKey: string | null; detail: string };

export type FunnelBoundaryDeps = Record<string, unknown>;

/**
 * THE one cached, money-safe DataForSEO call. Order on a miss: single-flight
 * cache claim -> configured/dry-run/breaker checks -> atomic spend reservation
 * -> network -> reconcile to provider-reported cost -> cache write.
 * Implemented in cached-call.ts (Agent A); this re-export is the frozen import
 * path for the funnel.
 */
export { cachedDataForSeoCall, collectDataForSeoTask } from "./cached-call";

// ── funnel phase executor contract (consumed by Runtime via the facade) ─────

export type FunnelCounters = {
  rawKeywords?: number;
  normalizedKeywords?: number;
  retainedKeywords?: number;
  rejectedKeywords?: number;
  promptsChecked?: number;
  enginePairsDone?: number;
  enginePairsIntended?: number;
  serpsAnalyzed?: number;
  winningPagesFetched?: number;
  cacheHits?: number;
  spendUsd?: number;
};

export type FunnelUnitOutcome = {
  /** advanced = real progress persisted; waiting = durable provider work pending
   *  (resume later, NOT failure/completion); done = phase complete; failed =
   *  bounded recoverable failure (Runtime pauses the run honestly). */
  status: "advanced" | "waiting" | "done" | "failed";
  cursor: Record<string, unknown> | null;
  progress: FunnelCounters;
  detail?: string;
};

export type FunnelUnitFn = (
  tenantId: string,
  cursor: Record<string, unknown> | null,
  budgetMs: number,
) => Promise<FunnelUnitOutcome>;
