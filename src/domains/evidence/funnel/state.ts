import "server-only";

/**
 * funnel/state (integrity closure, Agent B) - the durable per-account research
 * document, now scoped to ONE (tenant, onboarding basis) row in
 * public.research_state via state-repo (NO json-store, NO dual-write). A new
 * basis naturally reads empty; old-basis rows stay inert. Versioned + safely
 * decoded; every list is bounded so a persisted blob cannot grow without limit.
 */

import { createHash } from "node:crypto";

import { loadResearchState, saveResearchState, type StateRepoDeps } from "./state-repo";
import type { FunnelResearchEvidence, KeywordDiscoveryRoute, KeywordOrigin, ObservationMode, OwnedPageReadOutcome, ResearchCase, ResearchPageComparison, ResearchPageExtract, ResearchWinningAppearance, WinnerReadOutcome } from "./research-evidence";

const FUNNEL_SCHEMA_VERSION = 3;

/** TWO FULL keyword_overview requests, at that endpoint's own documented ceiling of 700 keywords each. The
 *  cap used to BE 700, so the retained set was the size of ONE request and every candidate past it was
 *  dropped rather than priced; now that the funnel also harvests what the account already observed, that
 *  ceiling threw away real cases and the enrichment simply runs ceil(n / 700) requests. */
export const MAX_RETAINED = 1400;
export const MAX_REJECTED = 150;
/** Case sets on file. Bounded because each one is a paid answer stored beside the case it belongs to. */
const MAX_CASE_COMPETITORS = 12;
/** DISTINCT arrivals kept per keyword. One keyword really does arrive by several routes and from several
 *  answers, and the whole point of keeping them is that a reader can see which; six is plenty to make that
 *  case and small enough that 1,400 keywords cannot turn the stored blob into a journal. Past it the count
 *  of what was dropped is kept instead, so the bound is always visible. */
export const MAX_ORIGINS = 6;

/** The recurring winning domains bought for ONE case set, in the canonical projected shape. */
type FunnelCaseCompetitors = NonNullable<FunnelResearchEvidence["caseCompetitors"]>[number];

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
  /** The page OF THE ACCOUNT'S OWN that ACTUALLY ranks for this keyword and its ORGANIC position, from the
   *  ranked pull. Optional: absent on every other route and on rows stored before it. */
  ownedRankingUrl?: string | null;
  ownedPosition?: number | null;
  /** The registry case this keyword joined, resolved through the case identity on file. */
  caseId?: string | null;
  /** Deterministic from the owned rankings: one owned page ranks, more than one does, or none does.
   *  null = the ranked pull did not land this run, so I have not checked. */
  supports?: "existing_page" | "consolidation" | "new_page" | null;
  /** THE WHOLE JOURNEY, not just the first step. `discoveredVia` keeps naming the route the surviving row
   *  came by; these are every DISTINCT arrival behind it, in the order they were first seen, bounded at
   *  MAX_ORIGINS. Optional and additive: a row stored before lineage was kept whole decodes with it absent,
   *  which reads as "I did not record the journey", never as "it arrived from nowhere". */
  origins?: KeywordOrigin[];
  /** How many further distinct arrivals there were past that bound. Absent = none were dropped. */
  moreOrigins?: number;
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
  /** THE reporting day the plan put this reading on. Part of the working identity, so a row from another
   *  day can never be mistaken for this one's retry, and a task posted yesterday lands on YESTERDAY. */
  day?: string;
  cacheKey: string | null;
  status: "pending" | "posted" | "done" | "unsupported";
  /** Terminal-collect recoveries: ONE clean repost, then unsupported. */
  reposts?: number;
  /** THE MONEY THAT MOVED WHEN THIS ASK WAS PLACED. The free collect that finishes a posted task carries
   *  zero, and that zero used to overwrite the placement receipt on the canonical row, so a paid day read
   *  as free. It ACCUMULATES across a reposted identity, carries with the posted pair, and clears on landing. */
  postCostUsd?: number;
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
  /** EXACTLY the pages the engine reported it RETRIEVED. A page here may ALSO be in `citations`, since the
   *  provider never promises the lists are disjoint, so nothing may read this as "retrieved and not cited":
   *  `retrievedNotCitedLinks` does that subtraction for every consumer. Rows stored earlier hold the same
   *  raw list under the same name, so they decode unchanged. null = not observable; [] = observed zero. */
  retrievedResults?: { url: string; domain: string; title: string | null }[] | null;
  /** Brand names the engine itself surfaced (null = not observable). */
  brandMentions?: string[] | null;
  /** null = not observable on this path. */
  fanOutQueries?: string[] | null;
  answerHash?: string | null;
};

export type FunnelSerp = {
  query: string;
  cacheKey: string | null;
  /** failed = the one clean repost was already spent, OR the provider answered a different search
   *  (`identityMismatch` below); both are explicit unavailable coverage. */
  status: "pending" | "posted" | "done" | "failed";
  /** WHERE THIS SEARCH CAME FROM, stamped by the agenda that chose it: fan_out = a search an engine ran
   *  itself to answer a tracked question, prompt = that question's own approved words, keyword = a phrase
   *  from my own pages, an open case or the researched set. Absent on rows stored before the stamp. */
  source?: "fan_out" | "prompt" | "keyword";
  /** THE TRACKED QUESTION THIS SEARCH CAME OUT OF (fan_out and prompt only), so a join back to the question
   *  is the parent that was RECORDED rather than a lossy match on the words. Absent = none was recorded. */
  parentPromptId?: string;
  /** THE PROVIDER ANSWERED A DIFFERENT SEARCH than the one asked, in its own echo of the keyword. Both
   *  strings are kept so the gap is inspectable, the row is held as unavailable coverage, and it never
   *  joins evidence: a results page for another phrase cannot back a claim about this one. */
  identityMismatch?: { asked: string; served: string };
  /** When this look actually landed; a look older than FRESH_MS is due again. */
  observedAt?: string;
  /** Terminal-collect recoveries: ONE clean repost, then unavailable coverage. */
  reposts?: number;
  /** `snippet` is the words Google shows under the result, already bounded by the parser. Absent on a row stored before the words were kept, which is never the claim that the result showed none. */
  organic?: { rank: number; url: string; domain: string; title: string | null; snippet?: string | null }[];
  aiOverview?: { url: string; domain: string; title: string | null }[];
  aiModeCacheKey?: string | null;
  aiMode?: { url: string; domain: string; title: string | null }[];
  /** ONE clean AI Mode retry after a terminal failure, then explicit missing coverage. */
  aiModeReposted?: boolean;
  aiModeFailed?: boolean;
  /** `answer` is the answer Google published for that follow-up question. null = the provider sent the question with no answer; absent = the look predates the answers being kept. */
  paa?: { question: string; answeringDomain: string | null; answer?: string | null }[];
  related?: string[];
  /** WHAT THIS RESULTS PAGE IS SHAPED LIKE, WHOSE PAGE HOLDS ITS ANSWER BOX AND WHAT THAT BOX SAYS, and the overview's own words beside the pages it cited. Every one of them arrives in the payload this row already paid
   *  for; keeping only the citation list discarded the half of each bought page that says what these pages actually claim. CAPTURE INCOMPLETE IS NEVER OBSERVED ZERO: each is written only when the payload actually said
   *  something, so ABSENT means unknown (the look predates these fields, or the response did not carry them) and null on `featured` means the provider's own block list proved this page has no answer box.
   *  `aiOverviewState` is the one three-way truth about the overview, because `aiOverview: []` said both "Google shows none here" and "the asynchronous stub has not landed yet", and downstream could only read the first. */
  itemTypes?: string[];
  featured?: { url: string; domain: string; title: string | null; text?: string | null } | null;
  aiOverviewText?: string;
  aiOverviewState?: "observed" | "pending" | "absent";
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
    /** ONE bought answer per case set: the domains that keep winning across that case's whole keyword set. */
    caseCompetitors: FunnelCaseCompetitors[];
    /** THE READINGS THIS ACCOUNT HAS ALREADY HARVESTED, as one fingerprint of the canonical answer set (see
     *  `analysisWatermark`). Written by the discovery stage when it genuinely read that set, so it always names
     *  what was CONSUMED: an interrupted pass leaves it where it was and recomputes the same debt, a completed
     *  one clears it. Absent = nothing has been harvested under this basis yet, which is a real debt, not zero. */
    consumedAnalyses?: string;
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

/** THE SETTLED-ANALYSIS FINGERPRINT of the canonical answer set: one token per answer, its own identity plus
 *  the hash of the reading stamped on it. A verdict that lands on an answer ALREADY on file moves this, which
 *  is precisely the debt nothing else could see; a day that settles no new reading leaves it exactly where it
 *  was. PURE and order free, and it carries no answer text and no journey: an id and a hash, nothing else.
 *  Both sides read it here so the fingerprint that opens the work and the one that clears it are one string. */
export function analysisWatermark(rows: readonly { id: string; hash: string | null }[]): string {
  return createHash("sha256").update(rows.map((r) => `${r.id}:${r.hash ?? ""}`).sort().join("|")).digest("hex").slice(0, 16);
}

export function emptyFunnelState(tenantId: string, basisTag = "", now = ""): FunnelState {
  return {
    schemaVersion: FUNNEL_SCHEMA_VERSION,
    tenantId,
    basisTag,
    discovery: { seeds: [], retained: [], rejected: [], counts: { raw: 0, normalized: 0, retained: 0, rejected: 0 }, caseCompetitors: [] },
    prompts: { pairs: [], intendedPairs: 0 },
    serps: { queries: [], analyzed: 0 },
    winningPages: [],
    pageComparisons: [], cases: [], ownedReads: [],
    ledger: { spentUsd: 0, cacheHits: 0 },
    cycle: { runId: null, cycleKey: null, spentUsd: 0, cacheHits: 0 },
    updatedAt: now,
  };
}

/** ADDITIVE, at the SAME schema version: a keyword stored while the owned ranking was called rankedUrl keeps that
 *  ranking under its current name instead of reading as one no page of mine ranks for. Nothing here invents support.
 *  A row stored before origins existed keeps them ABSENT (never an empty list, which would claim I looked and found
 *  no journey), and an over-long stored list is clamped to the same bound the writer holds itself to. */
function decodeKeyword(k: FunnelKeyword): FunnelKeyword {
  const legacy = k as FunnelKeyword & { rankedUrl?: string | null; rankedRank?: number | null };
  // The clamp KEEPS THE REMAINDER IN THE COUNT: dropping the tail of an over-long stored list without
  // adding what was dropped to moreOrigins deleted arrivals the row had actually recorded.
  const over = Array.isArray(k.origins) ? k.origins.length - MAX_ORIGINS : 0;
  const row = over > 0
    ? { ...k, origins: k.origins!.slice(0, MAX_ORIGINS), moreOrigins: (k.moreOrigins ?? 0) + over }
    : k;
  if (row.ownedRankingUrl != null || legacy.rankedUrl == null) return row;
  return { ...row, ownedRankingUrl: legacy.rankedUrl, ownedPosition: row.ownedPosition ?? legacy.rankedRank ?? null };
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
    discovery: d && typeof d === "object"
      ? { ...base.discovery, ...d, counts: { ...base.discovery.counts, ...d.counts },
        retained: Array.isArray(d.retained) ? d.retained.map(decodeKeyword) : base.discovery.retained,
        caseCompetitors: Array.isArray(d.caseCompetitors) ? d.caseCompetitors.slice(0, MAX_CASE_COMPETITORS) : base.discovery.caseCompetitors }
      : base.discovery,
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
