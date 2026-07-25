import "server-only";

/**
 * funnel/state (integrity closure, Agent B) - the durable per-account research
 * document, now scoped to ONE (tenant, onboarding basis) row in
 * public.research_state via state-repo (NO json-store, NO dual-write). A new
 * basis naturally reads empty; old-basis rows stay inert. Versioned + safely
 * decoded; every list is bounded so a persisted blob cannot grow without limit.
 */

import { loadResearchState, saveResearchState, type StateRepoDeps } from "./state-repo";
import type { ResearchPageExtract, ResearchWinningAppearance } from "./research-evidence";

const FUNNEL_SCHEMA_VERSION = 2;

export const MAX_RETAINED = 150;
export const MAX_REJECTED = 150;

export type FunnelKeyword = {
  keyword: string;
  searchVolume: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  discoveredVia: "site" | "ranked" | "related" | "suggestion" | "gsc" | "profile";
};

export type FunnelReject = { keyword: string; reason: string };

export type FunnelPair = {
  promptId: string;
  /** Real prompt text, persisted when observed so provenance never surfaces an id. */
  promptText?: string;
  engine: "chatgpt" | "perplexity" | "gemini" | "claude";
  scraper?: boolean;
  cacheKey: string | null;
  status: "pending" | "posted" | "done" | "unsupported";
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
  status: "pending" | "posted" | "done" | "failed";
  organic?: { rank: number; url: string; domain: string; title: string | null }[];
  aiOverview?: { url: string; domain: string; title: string | null }[];
  aiModeCacheKey?: string | null;
  aiMode?: { url: string; domain: string; title: string | null }[];
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
  fetched: boolean;
  contentHash?: string | null;
  extract: ResearchPageExtract | null;
};

export type FunnelState = {
  schemaVersion: number;
  tenantId: string;
  basisTag: string;
  discovery: {
    seeds: string[];
    raw: FunnelKeyword[];
    normalized: string[];
    retained: FunnelKeyword[];
    rejected: FunnelReject[];
    counts: { raw: number; normalized: number; retained: number; rejected: number };
  };
  prompts: { pairs: FunnelPair[]; intendedPairs: number };
  serps: { queries: FunnelSerp[]; analyzed: number };
  winningPages: FunnelWinningPage[];
  ledger: { spentUsd: number; cacheHits: number };
  updatedAt: string;
};

export type LoadedFunnelState = { state: FunnelState; rowVersion: number };

export function emptyFunnelState(tenantId: string, basisTag = "", now = ""): FunnelState {
  return {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    tenantId,
    basisTag,
    discovery: { seeds: [], raw: [], normalized: [], retained: [], rejected: [], counts: { raw: 0, normalized: 0, retained: 0, rejected: 0 } },
    prompts: { pairs: [], intendedPairs: 0 },
    serps: { queries: [], analyzed: 0 },
    winningPages: [],
    ledger: { spentUsd: 0, cacheHits: 0 },
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
    ledger: r.ledger && typeof r.ledger === "object" ? { ...base.ledger, ...r.ledger } : base.ledger,
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
