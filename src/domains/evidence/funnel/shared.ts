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
import { loadGscDecaySignalsForTenant, loadGscPageSignalsForTenant, type GscDecaySignal, type GscPageSignal } from "@/domains/evidence/readers/gsc-page-signals";
import type { SerpAgendaPageQuery } from "./normalize";
import { loadCrawlFrontier, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { syncPageSnapshots, syncPromptAnswerObservations } from "@/lib/persistence/dual-write";
import type { PageSnapshot } from "@/domains/evidence/pages/types";
import type { PromptAnswerObservation } from "@/domains/evidence/ai-visibility/prompt-answer-observations";
import { readAiObservationViews, recordAiObservation, type AiObservationRecord } from "@/domains/evidence/ai-visibility/ai-observations";
import type {
  CachedCallResult,
  CapabilityInputByKey,
  CapabilityKey,
  FailureDisposition,
} from "@/domains/evidence/dataforseo/funnel-boundary";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import type { ObservationMode, ResearchWinningAppearance } from "./research-evidence";
import {
  keywordIdeasBatched, providerCall,
  collectCapability,
  parseCapability,
  readPublicPageExtract,
  writePublicPageExtract,
} from "@/domains/evidence/dataforseo/funnel-boundary";
import { loadFunnelState, saveFunnelState, type FunnelPair, type FunnelState, type LoadedFunnelState } from "./state";

/** THE freshness matrix moved to evidence/freshness, a LEAF with no imports of its own: the provider
 *  registry and the page-extract store must consult the same table these executors do, and both of them sit
 *  UNDER the funnel boundary this file imports, so keeping the table here forced them to carry a second copy
 *  of the numbers, which is exactly how two of them drifted. Import freshnessMsFor / isCurrent from there. */

/** ONE stored analysis WITH the identity of the answer it was written about. The analysis alone was all
 *  that ever reached discovery, so a keyword harvested out of it could not say which answer named it; the
 *  identity below is exactly the one ai_observations files that answer under, so the trip back is a lookup.
 *  Every identity field is optional: a caller that genuinely holds only the analysis omits them. */
export type AnswerAnalysisRecord = {
  analysis: Record<string, unknown>;
  observationId?: string;
  promptId?: string;
  promptVersion?: number;
  promptText?: string;
  engine?: string;
  reportingDay?: string;
};

export type FunnelDeps = {
  callProvider?: <K extends CapabilityKey>(capability: K, input: CapabilityInputByKey[K], ids: { tenantId: string; unitKey: string }) => Promise<CachedCallResult>;
  collectTask?: (cacheKey: string) => Promise<CachedCallResult>;
  parse?: typeof parseCapability;
  readPageExtract?: typeof readPublicPageExtract;
  writePageExtract?: typeof writePublicPageExtract;
  loadProfile?: (tenantId: string) => Promise<BusinessProfile>;
  loadCrawl?: (tenantId: string) => Promise<CrawlFrontierState | null>;
  /** Top queries of the account's own strongest pages: portfolio 1 of the SERP agenda.
   *  null = the READ FAILED; [] = the account genuinely has none yet. */
  loadPageQueries?: (tenantId: string) => Promise<SerpAgendaPageQuery[] | null>;
  /** The analyses ALREADY stored beside the answers this account bought: what each answer was about and
   *  what it actually answered, EACH STILL ATTACHED TO THE ANSWER IT IS ABOUT. Read-only and bounded;
   *  nothing here is ever re-purchased or re-analyzed. */
  loadAnswerAnalyses?: (tenantId: string) => Promise<AnswerAnalysisRecord[]>;
  /** Test seam for winning-page citation-target resolution (defaults to the real
   *  redirect-only resolver in competitor-intel/polite-fetch). */
  resolveCitations?: (appearances: ResearchWinningAppearance[], fetchImpl?: typeof fetch, deadlineMs?: number) => Promise<ResearchWinningAppearance[]>;
  getAccount?: (tenantId: string) => Promise<Account | null>;
  syncHistory?: (rows: PromptAnswerObservation[], tenantId: string) => Promise<void>;
  /** THE canonical full-fidelity observation write (ai_observations). Separate seam from syncHistory
   *  because the history row is a PROJECTION of this record, derived from it at the same instant. */
  recordObservation?: (rec: AiObservationRecord, tenantId: string) => Promise<void>;
  fetchPage?: typeof fetchPageHtml;
  /** The ONE canonical persistence of a page of the ACCOUNT'S OWN: the same page_snapshots row every other
   *  read of my own pages writes, so a body acquired here is the body Decision reads back. */
  writeOwnedPage?: (snapshot: PageSnapshot, tenantId: string) => Promise<void>;
  /** THE canonical read back of that same row, so a body I already hold is never re-fetched from the customer's website. */
  readOwnedBodies?: typeof loadOwnedPageBodies;
  keywordIdeas?: (seeds: string[], ids: { tenantId: string; unitKey: string }) => Promise<CachedCallResult[]>;
  loadState?: (tenantId: string, basisTag: string) => Promise<LoadedFunnelState>;
  saveState?: (tenantId: string, basisTag: string, state: FunnelState, expectedRowVersion: number) => Promise<number | null>;
  now?: () => number;
};

export type ResolvedDeps = ReturnType<typeof resolveDeps>;

export function resolveDeps(deps: FunnelDeps) {
  return {
    callProvider: deps.callProvider ?? providerCall,
    keywordIdeas: deps.keywordIdeas ?? ((seeds: string[], ids: { tenantId: string; unitKey: string }) => keywordIdeasBatched(seeds, ids)),
    collectTask: deps.collectTask ?? ((k: string) => collectCapability(k)),
    parse: deps.parse ?? parseCapability,
    readPageExtract: deps.readPageExtract ?? readPublicPageExtract,
    writePageExtract: deps.writePageExtract ?? writePublicPageExtract,
    loadProfile: deps.loadProfile ?? loadBusinessProfile,
    loadCrawl: deps.loadCrawl ?? loadCrawlFrontier,
    loadPageQueries: deps.loadPageQueries ?? defaultPageQueries,
    loadAnswerAnalyses: deps.loadAnswerAnalyses ?? defaultAnswerAnalyses,
    getAccount: deps.getAccount ?? getTenant,
    syncHistory: deps.syncHistory ?? syncPromptAnswerObservations,
    recordObservation: deps.recordObservation ?? recordAiObservation,
    fetchPage: deps.fetchPage ?? fetchPageHtml,
    writeOwnedPage: deps.writeOwnedPage ?? ((snapshot: PageSnapshot, tenantId: string) => syncPageSnapshots([snapshot], tenantId)),
    readOwnedBodies: deps.readOwnedBodies ?? loadOwnedPageBodies,
    loadState: deps.loadState ?? loadFunnelState,
    saveState: deps.saveState ?? saveFunnelState,
    now: deps.now ?? Date.now,
  };
}

/** The SAME canonical Search Console read the evidence snapshot's
 *  ownedPages.search.topQueries comes from: the strongest pages by 90-day
 *  impressions, each carrying its own top queries. A page whose last 28 days of
 *  clicks fell against the 28 before marks its queries declining, so a slipping
 *  money query is checked in search before a steady one. null = the READ FAILED
 *  (mirrors the tracked-questions read), [] = the account genuinely has no page
 *  queries yet. A failure that read as [] once let a blind agenda buy anyway. */
async function defaultPageQueries(tenantId: string): Promise<SerpAgendaPageQuery[] | null> {
  try {
    const signals: Map<string, GscPageSignal> = await loadGscPageSignalsForTenant(tenantId);
    // Decay only ORDERS the portfolio, so its own failure is soft: nothing is lost.
    const decay = await loadGscDecaySignalsForTenant(tenantId).catch(() => new Map<string, GscDecaySignal>());
    const out: SerpAgendaPageQuery[] = [];
    for (const p of [...signals.values()].sort((a, b) => b.impressions90d - a.impressions90d).slice(0, 25)) {
      const d = decay.get(p.page);
      const declining = !!d && d.clicksNow < d.clicksPrior;
      for (const q of p.topQueries ?? []) out.push({ query: q.query, impressions: q.impressions, declining, page: p.page });
    }
    return out;
  } catch {
    return null;
  }
}

/** The analyses already stored beside answers this account paid for, newest first and deliberately FEW: a
 *  full-row read of this table is megabytes and a bounded handful is plenty of candidate language. Each one
 *  keeps the identity of the answer it is about, so a keyword taken out of it can name the question, the
 *  engine, the day and the stored answer that produced it instead of arriving anonymous. An unreadable
 *  table costs the pass that one free source, and never claims the account has none. */
async function defaultAnswerAnalyses(tenantId: string): Promise<AnswerAnalysisRecord[]> {
  const rows = await readAiObservationViews(tenantId, { limit: 25 });
  return rows.filter((r) => !!r.analysis).map((r) => ({
    analysis: r.analysis as Record<string, unknown>,
    observationId: r.id, promptId: r.promptId, promptVersion: r.version,
    promptText: r.promptText, engine: r.engine, reportingDay: r.day,
  }));
}

/** Mode is stamped by normalization; the legacy scraper flag is decode input ONLY (nothing else reads it).
 *  It lives here because BOTH executors decode it: the prompt unit to know what it is buying, the page unit
 *  to credit one citation seen through two ChatGPT looks to the consumer look exactly once. */
export const modeOf = (p: FunnelPair): ObservationMode => p.mode ?? (p.scraper ? "consumer_search" : "standardized_response");

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
