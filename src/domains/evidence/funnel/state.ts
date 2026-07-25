import "server-only";

/**
 * funnel/state (Slice 6, Agent B) - the durable per-account research-funnel
 * document in the tenant-scoped mirrored json-store "research-funnel" (already
 * registered), read/written with { tenantId } explicit. Versioned + safely
 * decoded; every list is bounded so the mirrored blob cannot grow without limit.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "research-funnel";
const FUNNEL_SCHEMA_VERSION = 1;

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
  engine: "chatgpt" | "perplexity" | "gemini" | "claude";
  scraper?: boolean;
  cacheKey: string | null;
  status: "pending" | "posted" | "done" | "unsupported";
  observedAt?: string;
  modelServed?: string | null;
  citations?: { url: string; domain: string }[];
  webSearchReported?: boolean | null;
};

export type FunnelSerp = {
  query: string;
  cacheKey: string | null;
  status: "pending" | "posted" | "done" | "failed";
  organic?: { rank: number; url: string; domain: string }[];
  aiOverview?: { url: string; domain: string }[];
  aiModeCacheKey?: string | null;
  aiModeCitations?: { url: string; domain: string }[];
};

export type FunnelWinningPage = {
  url: string;
  domain: string;
  appearances: { query: string; rank: number | null; surface: "organic" | "ai_overview" | "ai_answer" | "ai_mode" }[];
  fetched: boolean;
  cacheKey?: string;
  extract: { title: string | null; h1: string | null; wordCount: number; headings: string[]; faqCount: number } | null;
};

export type FunnelState = {
  schemaVersion: number;
  tenantId: string;
  basisTag?: string;
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

export function emptyFunnelState(tenantId: string, now = ""): FunnelState {
  return {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    tenantId,
    discovery: { seeds: [], raw: [], normalized: [], retained: [], rejected: [], counts: { raw: 0, normalized: 0, retained: 0, rejected: 0 } },
    prompts: { pairs: [], intendedPairs: 0 },
    serps: { queries: [], analyzed: 0 },
    winningPages: [],
    ledger: { spentUsd: 0, cacheHits: 0 },
    updatedAt: now,
  };
}

/** Decode an unknown persisted blob into a safe, current-shape state. Never throws. */
function decodeFunnelState(tenantId: string, raw: unknown): FunnelState {
  const base = emptyFunnelState(tenantId);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<FunnelState>;
  if (r.schemaVersion !== FUNNEL_SCHEMA_VERSION || r.tenantId !== tenantId) return base;
  const d = r.discovery;
  return {
    ...base,
    basisTag: typeof r.basisTag === "string" ? r.basisTag : undefined,
    discovery: d && typeof d === "object" ? { ...base.discovery, ...d, counts: { ...base.discovery.counts, ...d.counts } } : base.discovery,
    prompts: r.prompts && typeof r.prompts === "object" ? { ...base.prompts, ...r.prompts } : base.prompts,
    serps: r.serps && typeof r.serps === "object" ? { ...base.serps, ...r.serps } : base.serps,
    winningPages: Array.isArray(r.winningPages) ? r.winningPages : base.winningPages,
    ledger: r.ledger && typeof r.ledger === "object" ? { ...base.ledger, ...r.ledger } : base.ledger,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

export async function loadFunnelState(tenantId: string): Promise<FunnelState> {
  try {
    const rows = await readStore<FunnelState>(STORE, [], { tenantId });
    const row = (rows ?? []).find((x) => x && (x as FunnelState).tenantId === tenantId);
    return decodeFunnelState(tenantId, row ?? null);
  } catch {
    return emptyFunnelState(tenantId);
  }
}

export async function saveFunnelState(tenantId: string, state: FunnelState): Promise<void> {
  await writeStore<FunnelState>(STORE, [{ ...state, schemaVersion: FUNNEL_SCHEMA_VERSION, tenantId }], { tenantId });
}
