/**
 * research-evidence (integrity closure, Agent B) - the funnel's snapshot-facing evidence contract. PURE
 * types (no I/O, no server-only) so both the pure EvidenceSnapshot kernel and the server-only funnel
 * projector share one shape: retained keyword metrics WITH intent, exact AI observations with tri-state
 * citations, per-query SERP evidence, winning pages with TRUE per-page provenance, and the receipt.
 */

import type { ParsedPageIntersection } from "../page-intersection";

export type ResearchEngine = "chatgpt" | "gemini" | "claude" | "perplexity";

/** Provenance of an AI observation (frozen, Slice 6I). consumer_search = the ChatGPT scraper look at the
 *  consumer search experience: citation-grade evidence and THE canonical ChatGPT visibility signal.
 *  standardized_response = the llm_responses ask, canonical for gemini/claude/perplexity and AUXILIARY
 *  research for chatgpt (never engine coverage). The two are never blended or collapsed. */
export type ObservationMode = "consumer_search" | "standardized_response";

/** HOW a keyword was found. ONE canonical vocabulary shared by the funnel's working state and this
 *  projection, so nothing has to guess later: "site" and "ranked" are whole-site pulls, "related",
 *  "suggestion" and "ideas" come from a confirmed theme, "gsc" is Search Console, "profile" my own pages. */
export type KeywordDiscoveryRoute = "site" | "ranked" | "related" | "suggestion" | "gsc" | "profile" | "ideas";

type ResearchKeyword = {
  query: string;
  searchVolume: number | null;
  competition: number | null;
  competitionLevel: "low" | "medium" | "high" | null;
  /** Organic difficulty, bought with the volume and carried so Decision can weigh
   *  how hard a win is. It was paid for and then dropped here; never re-buy it. */
  difficulty: number | null;
  intent: string | null;
  /** The route this keyword was ACTUALLY discovered through, recorded at discovery
   *  and never inferred afterwards. Optional only so a payload persisted before
   *  lineage existed still reads (as absent, never as a made-up route). */
  discoveredVia?: KeywordDiscoveryRoute;
  /** The confirmed theme it was discovered FROM; null = it came from no single theme
   *  (a whole-site pull, my own pages, my own Search Console). */
  seed?: string | null;
  /** For a keyword the account ALREADY ranks for: the page that actually ranks and its ORGANIC position
   *  (rank_group; rank_absolute counts ads and packs). Absent on every other route. */
  rankedUrl?: string | null; rankedRank?: number | null;
};

type ResearchCitation = { url: string; domain: string; title: string | null };

type ResearchAiObservation = {
  promptId: string;
  /** The REAL prompt text observed (never a prompt id surfaced as evidence). */
  promptText: string;
  engine: string;
  /** Frozen provenance: which retrieval experience produced this observation. */
  observationMode: ObservationMode;
  modelRequested: string | null;
  modelServed: string | null;
  /** Provider-REPORTED web-search state; null = not reported. */
  webSearchReported: boolean | null;
  /** true = citations were observable on this path; false = not observable. */
  citationsObserved: boolean;
  /** null = not observable; [] = observed zero; nonempty = real citations. */
  citations: ResearchCitation[] | null;
  /** null = not observable on this path. */
  fanOutQueries: string[] | null;
  observedAt: string;
};

type ResearchSerpEvidence = {
  query: string;
  /** When this look ACTUALLY landed. The funnel has always recorded it and the
   *  projection used to drop it, so every consumer had to guess how old a results
   *  page was, and a claim about what Google shows cannot be dated by guesswork. */
  observedAt: string | null;
  organic: { rank: number; domain: string; url: string; title: string | null }[];
  aiOverview: ResearchCitation[];
  aiMode: ResearchCitation[];
  paa: { question: string; answeringDomain: string | null }[];
  related: string[];
};

type ResearchAppearanceKind = "serp_organic" | "ai_overview" | "ai_mode" | "ai_answer";

/** ONE winning-page appearance with its ACTUAL source (never the global engine
 *  list): a real query or a real prompt id + prompt text, its engine, its rank. */
export type ResearchWinningAppearance = {
  kind: ResearchAppearanceKind;
  query: string | null;
  promptId: string | null;
  promptText: string | null;
  engine: string | null;
  rank: number | null;
  citedUrl: string;
  observedAt: string;
  modelServed: string | null;
  /** ai_answer appearances carry their observation mode; SERP kinds carry null.
   *  Optional for persisted pre-6I rows, which read as null. */
  observationMode?: ObservationMode | null;
  /** The original provider URL when a known redirect wrapper was resolved into
   *  citedUrl (provenance back to the raw citation); null when citedUrl is raw. */
  viaUrl?: string | null;
};

/** What a winning page is actually MADE OF, from the one read that was already paid for: the same
 *  extraction the read already computes, carried through instead of thrown away. Every field below the
 *  original five is OPTIONAL, so an extract persisted before they existed still deserializes and reads as
 *  "not captured". THE one readable truth: a non-null extract at current freshness, and nothing else. */
export type ResearchPageExtract = {
  title: string | null;
  h1: string | null;
  wordCount: number;
  headings: string[];
  faqCount: number;
  metaDescription?: string | null;
  /** The page's opening body words (a sample, not the page). */
  openingSample?: string | null;
  entityNames?: string[];
  hasList?: boolean;
  hasTable?: boolean;
  internalLinkCount?: number;
  externalLinkCount?: number;
  fetchedAt?: string | null;
};

const OPENING_SAMPLE_CHARS = 600;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max);

/** The fields a page snapshot already carries, named structurally so this module
 *  stays pure (no store, no I/O, no PageSnapshot import). */
type ExtractableSnapshot = {
  title: string | null; h1: string | null; word_count: number; h2_list?: string[]; faqs?: unknown[];
  meta_description?: string | null; body_paragraph_sample?: string[]; schema_entity_names?: string[];
  card_texts?: string[]; table_count?: number; internal_link_count?: number; external_link_count?: number;
  fetched_at?: string;
};

/** ONE mapper from a freshly extracted page snapshot onto the extract. Pure. */
export function pageExtractFrom(snap: ExtractableSnapshot): ResearchPageExtract {
  return {
    title: snap.title, h1: snap.h1, wordCount: snap.word_count,
    headings: strings(snap.h2_list, 20), faqCount: (snap.faqs ?? []).length,
    metaDescription: str(snap.meta_description),
    openingSample: str(strings(snap.body_paragraph_sample, 8).join(" ").slice(0, OPENING_SAMPLE_CHARS)),
    entityNames: strings(snap.schema_entity_names, 12),
    hasList: strings(snap.card_texts, 1).length > 0,
    hasTable: (snap.table_count ?? 0) > 0,
    internalLinkCount: snap.internal_link_count ?? 0,
    externalLinkCount: snap.external_link_count ?? 0,
    fetchedAt: str(snap.fetched_at),
  };
}

/** Decode a PERSISTED extract. A legacy row missing every field added later reads
 *  as the original five plus honest absence, never a throw and never a fake zero. */
export function pageExtractFromRecord(rec: Record<string, unknown>): ResearchPageExtract {
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  return {
    title: str(rec.title), h1: str(rec.h1), wordCount: num(rec.wordCount) ?? 0,
    headings: strings(rec.headings, 20), faqCount: num(rec.faqCount) ?? 0,
    metaDescription: str(rec.metaDescription), openingSample: str(rec.openingSample),
    entityNames: strings(rec.entityNames, 12), hasList: bool(rec.hasList), hasTable: bool(rec.hasTable),
    internalLinkCount: num(rec.internalLinkCount), externalLinkCount: num(rec.externalLinkCount),
    fetchedAt: str(rec.fetchedAt),
  };
}

/** Why a winner's BODY is not in hand, and the earliest I may spend a read slot on that URL again. A read
 *  outcome NEVER makes a page readable (only `extract` does that) and it never removes the ranked URL:
 *  robots_blocked = the publisher said no and is never sent through any provider; temporarily_unavailable
 *  = the site did not answer me; provider_unavailable = my one paid read of the body did not come back. */
export type WinnerReadOutcome = { state: "robots_blocked" | "temporarily_unavailable" | "provider_unavailable"; attemptedAt: string; retryAfter: string };

/** Why I could not read a page of MY OWN, and the earliest I may spend a read on that URL again. A SUCCESS
 *  needs no record here (the persisted page snapshot IS the success truth, and acquiring a body clears this),
 *  and my own pages never go through a paid provider, so there is no provider state. Because it is persisted,
 *  the date an operator reads stays identical across visits and deploys until the retry is genuinely due. */
export type OwnedPageReadOutcome = { url: string; state: "robots_blocked" | "temporarily_unavailable"; attemptedAt: string; retryAfter: string };

type ResearchWinningPage = {
  url: string;
  domain: string;
  /** engines of THIS page's OWN appearances only. */
  engines: string[];
  /** real appearance prompt texts (never a prompt id). */
  examplePrompts: string[];
  appearances: ResearchWinningAppearance[];
  extract: ResearchPageExtract | null;
  /** Optional: absent on a row stored before read memory existed, and read as "never tried". */
  readOutcome?: WinnerReadOutcome | null;
};

/** Why a bought page-by-page comparison is NOT in hand. Every one is a call that produced
 *  no evidence, so not one of them may ever harden into "build a new page". */
export type IntersectionUnavailable = "blocked" | "capped" | "waiting" | "quarantined" | "ambiguous" | "failed";

/** ONE page-by-page comparison, stored beside the winners it compared and projected UNCHANGED. Its
 *  IDENTITY is four facts, so a later pass can tell this answer from somebody else's: the basis (the row
 *  is basis-scoped), the topic, the NORMALIZED ask (a reordered set or an omitted default is the SAME
 *  identity, never a second buy) and when it landed with the money core's receipt. A null `comparison`
 *  beside an `unavailable` reason is an honest gap and never reads as a finding. */
export type ResearchPageComparison = {
  topicKey: string;
  /** Hash of the NORMALIZED ask; the pages and excludes it stands for sit beside it. */
  askKey: string; pages: string[]; excludePages: string[];
  /** When it landed, and the money core's cache identity for the call that bought it. */
  observedAt: string; receipt: string | null;
  comparison: ParsedPageIntersection | null;
  unavailable: IntersectionUnavailable | null;
};

/** ONE identity per case, minted the first time the case is seen and never recomputed. `anchors`
 *  are canonical query keys that have ever belonged to it. A merge keeps ONE canonical id and
 *  records the other as an alias rather than minting a third. */
export type ResearchCase = { id: string; anchors: string[]; aliasOf?: string };

type ResearchReceipt = {
  researched: number;
  retained: number;
  stale: number;
  missing: number;
  cached: number;
  spentUsd: number;
  freshestObservationAt: string | null;
};

export type FunnelResearchEvidence = {
  retainedKeywords: ResearchKeyword[];
  aiObservations: ResearchAiObservation[];
  serpEvidence: ResearchSerpEvidence[];
  winningPages: ResearchWinningPage[];
  /** Optional so a bundle built before comparisons existed still reads (as none of them). */
  pageComparisons?: ResearchPageComparison[];
  /** The case identities on file. Optional for the same reason; absent reads as none of them. */
  cases?: ResearchCase[];
  /** Failed reads of MY OWN pages, so a verdict names a retry date it will actually keep. Absent = none. */
  ownedReads?: OwnedPageReadOutcome[];
  receipt: ResearchReceipt;
};

export function emptyResearchEvidence(): FunnelResearchEvidence {
  return {
    retainedKeywords: [],
    aiObservations: [],
    serpEvidence: [],
    winningPages: [],
    pageComparisons: [], cases: [], ownedReads: [],
    receipt:{ researched: 0, retained: 0, stale: 0, missing: 0, cached: 0, spentUsd: 0, freshestObservationAt: null },
  };
}
