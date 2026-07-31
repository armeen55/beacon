import "server-only";

/**
 * funnel/state (integrity closure, Agent B) - the durable per-account research
 * document, now scoped to ONE (tenant, onboarding basis) row in
 * public.research_state via state-repo (NO json-store, NO dual-write). A new
 * basis naturally reads empty; old-basis rows stay inert. Versioned + safely
 * decoded; every list is bounded so a persisted blob cannot grow without limit.
 */

import { loadResearchState, saveResearchState, type StateRepoDeps } from "./state-repo";
import type { KeywordDiscoveryRoute, ObservationMode, OwnedPageReadOutcome, ResearchCase, ResearchPageComparison, ResearchPageExtract, ResearchWinningAppearance, WinnerReadOutcome } from "./research-evidence";

const FUNNEL_SCHEMA_VERSION = 3;

/** 700 is the enrichment batch's own documented ceiling, so the retained set and the ONE
 *  keyword_overview request that prices it are the same size. */
export const MAX_RETAINED = 700;
export const MAX_REJECTED = 150;

export type FunnelKeyword = {
  keyword: string;
  searchVolume: number | null;
  competition: number | null;
  /** The provider's OWN competition label when it sent one; a band derived from the
   *  numeric score is only the fallback, never an overwrite of what it actually said. */
  competitionLevel?: "low" | "medium" | "high" | null;
  difficulty: number | null;
  intent: string | null;
  discoveredVia: KeywordDiscoveryRoute;
  /** The confirmed theme this keyword was discovered FROM (per-seed sources only), so
   *  retention can keep every seed's discovery alive instead of one seed's. */
  seed?: string;
  /** The page that ACTUALLY ranks for this keyword and its ORGANIC position, from the
   *  ranked pull. Optional: absent on every other route and on rows stored before it. */
  rankedUrl?: string | null;
  rankedRank?: number | null;
};

export type FunnelReject = { keyword: string; reason: string };

export type FunnelPair = {
  promptId: string;
  /** Real prompt text, persisted when observed so provenance never surfaces an id. */
  promptText?: string;
  engine: "chatgpt" | "perplexity" | "gemini" | "claude";
  /** Frozen provenance (Slice 6I): the retrieval experience of this pair.
   *  Canonical coverage = chatgpt consumer_search + the other three engines
   *  standardized_response; a chatgpt standardized_response pair is AUXILIARY.
   *  Stamped by normalization on load; every consumer reads mode, never scraper. */
  mode?: ObservationMode;
  /** LEGACY decode input only (pre-6I blobs): normalization derives mode from it
   *  (chatgpt scraper true = consumer_search) and nothing else may read it. */
  scraper?: boolean;
  /** Which deliberate SAMPLE of this pair on one day this row is (0, 1 or 2). Absent = slot 0, so every
   *  row stored before sampling existed keeps its identity. A new slot is a new observation, never a retry. */
  slot?: number;
  /** The version of the prompt text that was actually asked, so a reworded question never silently
   *  overwrites the answers the old wording earned. Absent on rows stored before versioning. */
  promptVersion?: number;
  cacheKey: string | null;
  status: "pending" | "posted" | "done" | "unsupported";
  /** Terminal-collect recoveries: ONE clean repost, then unsupported. */
  reposts?: number;
  /** When the request that produced this row was actually made (a posted task keeps it across the free
   *  collect), so the canonical observation records asked-at and answered-at as different moments. */
  requestedAt?: string;
  observedAt?: string;
  modelRequested?: string | null;
  modelServed?: string | null;
  webSearchReported?: boolean | null;
  /** false = citations not observable on this path (distinct from observed zero). */
  citationsObserved?: boolean;
  /** null = not observable; [] = observed zero; nonempty = real citations. */
  citations?: { url: string; domain: string; title: string | null }[] | null;
  /** null = not observable on this path. */
  fanOutQueries?: string[] | null;
  answerHash?: string | null;
};

export type FunnelSerp = {
  query: string;
  cacheKey: string | null;
  /** failed = the one clean repost was already spent (explicit unavailable coverage). */
  status: "pending" | "posted" | "done" | "failed";
  /** When this look actually landed; a look older than FRESH_MS is due again. */
  observedAt?: string;
  /** Terminal-collect recoveries: ONE clean repost, then unavailable coverage. */
  reposts?: number;
  organic?: { rank: number; url: string; domain: string; title: string | null }[];
  aiOverview?: { url: string; domain: string; title: string | null }[];
  aiModeCacheKey?: string | null;
  aiMode?: { url: string; domain: string; title: string | null }[];
  /** ONE clean AI Mode retry after a terminal failure, then explicit missing coverage. */
  aiModeReposted?: boolean;
  aiModeFailed?: boolean;
  paa?: { question: string; answeringDomain: string | null }[];
  related?: string[];
};

export type FunnelWinningPage = {
  url: string;
  domain: string;
  /** engines of THIS page's OWN appearances only. */
  engines: string[];
  /** real appearance prompt texts. */
  examplePrompts: string[];
  appearances: ResearchWinningAppearance[];
  extract: ResearchPageExtract | null;
  /** Why the BODY is not in hand and when this URL may spend a read slot again; null = it is in hand. */
  readOutcome?: WinnerReadOutcome | null;
};

export type FunnelState = {
  schemaVersion: number;
  tenantId: string;
  basisTag: string;
  discovery: {
    seeds: string[];
    retained: FunnelKeyword[];
    rejected: FunnelReject[];
    counts: { raw: number; normalized: number; retained: number; rejected: number };
  };
  /** The CURRENT working set only: pairs whose prompt or engine left the intended
   *  set are pruned. True history lives in prompt_answer_observations. */
  prompts: { pairs: FunnelPair[]; intendedPairs: number };
  /** The CURRENT chosen keyword set only; obsolete queries are pruned. */
  serps: { queries: FunnelSerp[]; analyzed: number };
  winningPages: FunnelWinningPage[];
  /** Bought page-by-page comparisons, newest first, ONE per topic, bounded, in the canonical projected shape. */
  pageComparisons: ResearchPageComparison[];
  /** The case identities Runtime reconciled, so an id minted today is the same id tomorrow. */
  cases: ResearchCase[];
  /** Why a page of MY OWN could not be read and when I may try it again. Bounded; a success clears its row. */
  ownedReads: OwnedPageReadOutcome[];
  /** LIFETIME totals for this basis (not the receipt). */
  ledger: { spentUsd: number; cacheHits: number };
  /** THIS run's receipt: reset whenever Runtime hands us a new run id. */
  cycle: { runId: string | null; cycleKey: string | null; spentUsd: number; cacheHits: number };
  updatedAt: string;
};

export type LoadedFunnelState = { state: FunnelState; rowVersion: number };

export function emptyFunnelState(tenantId: string, basisTag = "", now = ""): FunnelState {
  return {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    tenantId,
    basisTag,
    discovery: { seeds: [], retained: [], rejected: [], counts: { raw: 0, normalized: 0, retained: 0, rejected: 0 } },
    prompts: { pairs: [], intendedPairs: 0 },
    serps: { queries: [], analyzed: 0 },
    winningPages: [],
    pageComparisons: [], cases: [], ownedReads: [],
    ledger: { spentUsd: 0, cacheHits: 0 },
    cycle: { runId: null, cycleKey: null, spentUsd: 0, cacheHits: 0 },
    updatedAt: now,
  };
}

/** Decode an unknown persisted blob into a safe, current-shape state. Never throws.
 *  A schema/basis/tenant mismatch reads as EMPTY so stale-shape residue never renders. */
function decodeFunnelState(tenantId: string, basisTag: string, raw: unknown): FunnelState {
  const base = emptyFunnelState(tenantId, basisTag);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<FunnelState>;
  if (r.schemaVersion !== FUNNEL_SCHEMA_VERSION || r.tenantId !== tenantId || r.basisTag !== basisTag) return base;
  const d = r.discovery;
  return {
    ...base,
    discovery: d && typeof d === "object" ? { ...base.discovery, ...d, counts: { ...base.discovery.counts, ...d.counts } } : base.discovery,
    prompts: r.prompts && typeof r.prompts === "object" ? { ...base.prompts, ...r.prompts } : base.prompts,
    serps: r.serps && typeof r.serps === "object" ? { ...base.serps, ...r.serps } : base.serps,
    winningPages: Array.isArray(r.winningPages) ? r.winningPages : base.winningPages,
    // ADDITIVE, at the SAME schema version: a row stored before comparisons existed reads
    // as none of them rather than being thrown away with every keyword and answer on it.
    pageComparisons: Array.isArray(r.pageComparisons) ? r.pageComparisons : base.pageComparisons,
    cases: Array.isArray(r.cases) ? r.cases : base.cases,
    ownedReads: Array.isArray(r.ownedReads) ? r.ownedReads : base.ownedReads,
    ledger: r.ledger && typeof r.ledger === "object" ? { ...base.ledger, ...r.ledger } : base.ledger,
    cycle: r.cycle && typeof r.cycle === "object" ? { ...base.cycle, ...r.cycle } : base.cycle,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/** Load the basis-scoped state plus its optimistic row_version (0 when absent). */
export async function loadFunnelState(tenantId: string, basisTag: string, deps?: StateRepoDeps): Promise<LoadedFunnelState> {
  const row = await loadResearchState<FunnelState>(tenantId, basisTag, deps);
  if (!row) return { state: emptyFunnelState(tenantId, basisTag), rowVersion: 0 };
  return { state: decodeFunnelState(tenantId, basisTag, row.state), rowVersion: row.rowVersion };
}

/** Optimistic save. Returns the new row version, or null on a version conflict. */
export async function saveFunnelState(
  tenantId: string,
  basisTag: string,
  state: FunnelState,
  expectedRowVersion: number,
  deps?: StateRepoDeps,
): Promise<number | null> {
  return saveResearchState<FunnelState>(
    tenantId,
    basisTag,
    { ...state, schemaVersion: FUNNEL_SCHEMA_VERSION, tenantId, basisTag },
    expectedRowVersion,
    deps,
  );
}
