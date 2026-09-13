/**
 * research-evidence (integrity closure, Agent B) - the funnel's snapshot-facing evidence contract. PURE
 * types (no I/O, no server-only) so both the pure EvidenceSnapshot kernel and the server-only funnel
 * projector share one shape: retained keyword metrics WITH intent, exact AI observations with tri-state
 * citations, per-query SERP evidence, winning pages with TRUE per-page provenance, and the receipt.
 */

import type { ParsedPageIntersection } from "../page-intersection";
import { visibleFaqs } from "../pages/types";

export type ResearchEngine = "chatgpt" | "gemini" | "claude" | "perplexity";

/** Provenance of an AI observation (frozen, Slice 6I). consumer_search = the ChatGPT scraper look at the
 *  consumer search experience: citation-grade evidence and THE canonical ChatGPT visibility signal.
 *  standardized_response = the llm_responses ask, canonical for gemini/claude/perplexity and AUXILIARY
 *  research for chatgpt (never engine coverage). The two are never blended or collapsed. */
export type ObservationMode = "consumer_search" | "standardized_response";

/** HOW a keyword was found. ONE canonical vocabulary shared by the funnel's working state and this
 *  projection, so nothing has to guess later: "site" and "ranked" are whole-site pulls, "related",
 *  "suggestion" and "ideas" come from a confirmed theme, "gsc" is Search Console, "profile" my own pages.
 *  The five below are the OBSERVED routes, everything this account already paid to see: "prompt" is a
 *  question I track, "fanout" a search an engine ran for itself, "paa" a question Google put on the results
 *  page, "related_search" one it suggested beside them, "answer_entity" a subject or question an AI answer
 *  named, read back off the analysis already on file. */
export type KeywordDiscoveryRoute =
  | "site" | "ranked" | "related" | "suggestion" | "gsc" | "profile" | "ideas"
  | "prompt" | "fanout" | "paa" | "related_search" | "answer_entity";

/** ONE ARRIVAL of a keyword, with the journey that produced it kept whole. `discoveredVia` says which route
 *  a row came by; this says WHERE ON THAT ROUTE, so a fan-out can be traced back to the approved question,
 *  the engine that answered it, the day it was read and the stored answer it was read out of, and a Search
 *  Console query back to the page that earned it. Recorded at the moment of discovery and never inferred
 *  afterwards. TRI-STATE DISCIPLINE APPLIES TO EVERY FIELD: a field a route cannot know is ABSENT, never
 *  zero, never a placeholder, and never borrowed from a route that does know it. */
export type KeywordOrigin = {
  route: KeywordDiscoveryRoute;
  /** The exact string this candidate was read out of, before normalization. Absent when the keyword and
   *  the string it came from are already identical. */
  sourceQuery?: string;
  /** The search, question or confirmed theme this arrival was derived FROM: the results page a "people
   *  also ask" question sat on, the approved question an engine fanned out from, the theme a suggestion
   *  was asked for. Absent where the route has no parent. */
  parentQuery?: string;
  /** The address this arrival came in on: the Search Console page whose row carried the query, or the page
   *  of my own whose title or question it was. Absent where the route has no page. */
  pageUrl?: string;
  /** THE AI ROUTES ONLY (prompt, fanout, answer_entity): the identity of the answer this came out of, in
   *  exactly the terms ai_observations stores it under, so the join back to the answer is a lookup and
   *  never a guess. A version or day the working row never recorded stays absent, and `observationId` is
   *  present only when every part of that identity is. */
  promptId?: string;
  promptVersion?: number;
  engine?: string;
  reportingDay?: string;
  observationId?: string;
};

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
  /** EVERY route this keyword actually arrived by, each with its own journey, oldest arrival first and
   *  bounded. Optional only so a payload persisted before lineage was kept whole still reads, as absent
   *  rather than as a keyword that arrived from nowhere. */
  origins?: KeywordOrigin[];
  /** How many FURTHER distinct arrivals there were past the bound above. Absent = none were dropped, so a
   *  truncated lineage always says so instead of quietly reading as the whole story. */
  moreOrigins?: number;
  /** For a keyword the account ALREADY ranks for: the page OF ITS OWN that actually ranks and that page's
   *  ORGANIC position (rank_group; rank_absolute counts ads and packs). Absent on every other route. */
  ownedRankingUrl?: string | null; ownedPosition?: number | null;
  /** The registry case this keyword joined, resolved through the case identity on file, so one that joined
   *  under an id since absorbed lands on the case answering for it now. null = no case is about it yet. */
  parentCaseId?: string | null;
  /** What acting on this keyword would MEAN, read off the owned rankings above and nothing else: one owned
   *  page ranks (strengthen that page), more than one does (consolidate them), none does (a page of its
   *  own). null = I have not checked this account's own rankings, which is NOT the same claim as "none". */
  supports?: "existing_page" | "consolidation" | "new_page" | null;
};

type ResearchCitation = { url: string; domain: string; title: string | null };

/** ONE stored AI answer, as the snapshot carries it: the identity it lives under in ai_observations, the whole journey
 *  the engine reported, and the settled reading of it when there is one. It replaces the funnel's projected working
 *  pair, which held one 20 pair window, so an account with 140 answers a day read as an account with one answer.
 *  TRI-STATE DISCIPLINE on every list: null = this path does not report it at all, [] = it reported none.
 *  `analysis` is present ONLY for a reading settled under current rules against THIS answer, and never for a refusal. */
export type CanonicalPairObservation = {
  observationId: string;
  promptId: string;
  promptVersion: number;
  /** The REAL prompt text observed (never a prompt id surfaced as evidence). */
  promptText: string;
  engine: string;
  /** The money core's cache identity for the envelope this answer was read from, carried so a receipt can
   *  PROVE the call rather than merely state it. Optional: absent on a row a test built by hand and on one
   *  stored before the identity was kept, which reads as "not recorded", never as "not bought". */
  cacheKey?: string | null;
  modelRequested: string | null;
  modelServed: string | null;
  /** Frozen provenance: which retrieval experience produced this observation. */
  observationMode: ObservationMode;
  reportingDay: string;
  /** When the reading landed; null = the row never recorded a completion. */
  observedAt: string | null;
  answerHash: string;
  /** Provider-REPORTED web-search state; null = not reported. */
  webSearchReported: boolean | null;
  /** DERIVED, never stored: citations !== null, which every reader of this shape asks as "was this path able to
   *  credit anybody at all". The loader always fills it; absent only on a row a test built by hand. */
  citationsObserved?: boolean;
  fanOutQueries: string[] | null;
  citations: ResearchCitation[] | null;
  /** The pages the engine reported it RETRIEVED. A page here may also appear in `citations`, so the
   *  not-cited half is derived by `retrievedNotCitedLinks`, never read off this list. */
  retrievedResults: ResearchCitation[] | null;
  /** Brand names the engine itself surfaced; null = not observable, [] never fabricated. */
  brandMentions: string[] | null;
  analysis: Record<string, unknown> | null;
  /** The stored reading's own stamp, carried RAW off the row so a settled reading is MATERIAL evidence: two
   *  runs over the same citations but a different reading state are no longer one evidence identity. null =
   *  nothing has been read out of this answer yet. Optional only so a row a test built by hand still reads;
   *  the loader always fills it. */
  analysisHash?: string | null;
};

type ResearchSerpEvidence = {
  query: string;
  /** When this look ACTUALLY landed. The funnel has always recorded it and the
   *  projection used to drop it, so every consumer had to guess how old a results
   *  page was, and a claim about what Google shows cannot be dated by guesswork. */
  observedAt: string | null;
  organic: { rank: number; domain: string; url: string; title: string | null; snippet?: string | null }[];
  aiOverview: ResearchCitation[];
  aiMode: ResearchCitation[];
  paa: { question: string; answeringDomain: string | null; answer?: string | null }[];
  related: string[];
  /** WHAT THE RESULTS PAGE ITSELF SAYS, carried through so a diagnosis can name the proposition an owned page lacks instead of guessing it off a list of urls: the words under each result, the block list, the answer box
   *  with the answer in it, and the overview's own words. Optional and additive, so a bundle built before they were carried reads as one that did not record them, which is never the claim that the page shows none.
   *  `aiOverviewState` is the one three-way truth: observed (words or references landed), pending (an asynchronous overview is still outstanding), absent (the provider reported none). null = the look predates the stamp. */
  itemTypes?: string[] | null;
  featured?: { url: string; domain: string; title: string | null; text?: string | null } | null;
  aiOverviewText?: string | null;
  aiOverviewState?: "observed" | "pending" | "absent" | null;
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
  observationId?: string;
  promptVersion?: number;
  reportingDay?: string;
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
  /** HOW MANY QUESTION ENTRIES THIS PAGE ANSWERS AS. Absent is "the read that banked it does not report this", which is what a provider parse of a rival's page honestly is: a 0 there is a claim that the page has none, and every reader below distinguishes the two. */ faqCount?: number;
  metaDescription?: string | null;
  /** The page's opening body words (a sample, not the page). */
  openingSample?: string | null;
  entityNames?: string[];
  hasList?: boolean;
  hasTable?: boolean;
  internalLinkCount?: number;
  externalLinkCount?: number;
  fetchedAt?: string | null;
  /** THE PAGE'S OWN MAIN CONTENT, nav, header, footer and aside removed, which is the only field a comparison can
   *  read what a winner ANSWERS from: 20 headings and 600 characters of opening were a fingerprint of the page and
   *  the comparison built on them could only ever ask whether two labels matched. Null where the read carried no
   *  words, which stays a named gap and is never a body. `truncated` says the capture was cut at the ceiling, so
   *  everything past `heldChars` of `totalChars` is UNKNOWN rather than absent, at both doors that read it.
   *  All four are absent on a row banked before they existed, and absent reads as "not captured", never as none. */
  mainText?: string | null;
  truncated?: boolean | null;
  heldChars?: number | null;
  totalChars?: number | null;
  /** The subheadings under the h2s, and the structured-data types the page declares. */
  h3s?: string[];
  /** THE PAGE'S SECTIONS AS THE PROVIDER PARSED THEM, each heading with the words under it (delivery loop, 2026-09-07). `mainText` joins the passages without their headings, so a reader anchoring on a heading found it only in the trailing heading list and opened its window on the document's tail; the fact pass and the comparison read the section itself here. Absent on a capture that carried no topics. */
  sections?: { heading: string | null; text: string }[];
  schemaTypes?: string[];
};

const OPENING_SAMPLE_CHARS = 600;
/** HOW MUCH OF A WINNER'S OWN WORDS ONE COMPARISON READS. 12,000 characters is about 2,000 words: it holds the
 *  whole body of every winning page this account has ever read except an encyclopedia roster, it leaves room for
 *  three winners and the owned page inside one reading, and a page longer than it is marked cut rather than
 *  silently shortened. Stated once here and applied wherever an extract is built or re-held. */
const MAIN_TEXT_CEILING = 12_000;
/** THE MAIN TEXT AS THIS READ HOLDS IT, with what was kept and what there was. `seen` carries a total an earlier
 *  read already measured, so re-holding a provider's longer capture at the comparison ceiling never understates
 *  the page. Whitespace-normalized, because a body arrives from a crawl as one run and from a provider as blocks. */
export const mainOf = (text: string | null | undefined, seen = 0, ceiling = MAIN_TEXT_CEILING): Pick<ResearchPageExtract, "mainText" | "truncated" | "heldChars" | "totalChars"> => {
  const whole = (text ?? "").replace(/\s+/g, " ").trim(), held = whole.slice(0, ceiling), total = Math.max(seen, whole.length);
  return { mainText: held || null, truncated: total > held.length, heldChars: held.length, totalChars: total };
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max);

/** The fields a page snapshot already carries, named structurally so this module
 *  stays pure (no store, no I/O, no PageSnapshot import). */
type ExtractableSnapshot = {
  title: string | null; h1: string | null; word_count: number; h2_list?: string[]; faqs?: unknown[];
  meta_description?: string | null; body_paragraph_sample?: string[]; schema_entity_names?: string[];
  card_texts?: string[]; table_count?: number; internal_link_count?: number; external_link_count?: number;
  fetched_at?: string; body_text?: string; h3_list?: string[]; schema_types?: string[];
};

/** ONE mapper from a freshly extracted page snapshot onto the extract. Pure. */
export function pageExtractFrom(snap: ExtractableSnapshot): ResearchPageExtract {
  return {
    title: snap.title, h1: snap.h1, wordCount: snap.word_count,
    headings: strings(snap.h2_list, 20), faqCount: visibleFaqs(snap.faqs).length,
    metaDescription: str(snap.meta_description),
    openingSample: str(strings(snap.body_paragraph_sample, 8).join(" ").slice(0, OPENING_SAMPLE_CHARS)),
    entityNames: strings(snap.schema_entity_names, 12),
    hasList: strings(snap.card_texts, 1).length > 0,
    hasTable: (snap.table_count ?? 0) > 0,
    internalLinkCount: snap.internal_link_count ?? 0,
    externalLinkCount: snap.external_link_count ?? 0,
    fetchedAt: str(snap.fetched_at),
    // THE READING ITSELF: the crawler already strips nav, header, footer and aside before it counts a word, so the
    // main content is on the snapshot and was being thrown away here every time a winner was read.
    ...mainOf(snap.body_text), h3s: strings(snap.h3_list, 20), schemaTypes: strings(snap.schema_types, 12),
  };
}

/** Decode a PERSISTED extract. A legacy row missing every field added later reads
 *  as the original five plus honest absence, never a throw and never a fake zero. */
export function pageExtractFromRecord(rec: Record<string, unknown>): ResearchPageExtract {
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  return {
    title: str(rec.title), h1: str(rec.h1), wordCount: num(rec.wordCount) ?? 0,
    headings: strings(rec.headings, 20), ...(num(rec.faqCount) != null ? { faqCount: num(rec.faqCount)! } : {}),
    metaDescription: str(rec.metaDescription), openingSample: str(rec.openingSample),
    /* AN ENTITY LIST NOBODY BANKED IS NOT AN EMPTY ONE (Build Queue E-039): `strings` handed back [] for a row that carries no such field at all, so a winner read through the provider, which reports no entities, and a winner banked before the field existed both read as pages that name nothing, and the comparison then said the winners name nothing this page lacks. Absent stays absent at the decoder, and the comparison reads it as unknown. */ ...(Array.isArray(rec.entityNames) ? { entityNames: strings(rec.entityNames, 12) } : {}), hasList: bool(rec.hasList), hasTable: bool(rec.hasTable),
    internalLinkCount: num(rec.internalLinkCount), externalLinkCount: num(rec.externalLinkCount),
    fetchedAt: str(rec.fetchedAt),
    // A ROW BANKED BEFORE THE READING EXISTED HELD NO WORDS, and that is honest absence: `mainText: null` with
    // `truncated: null` says nothing was captured, which no door may read as a page that carries nothing.
    mainText: str(rec.mainText), truncated: bool(rec.truncated) ?? null, heldChars: num(rec.heldChars) ?? null,
    totalChars: num(rec.totalChars) ?? null, ...(Array.isArray(rec.h3s) ? { h3s: strings(rec.h3s, 20) } : {}), ...(Array.isArray(rec.schemaTypes) ? { schemaTypes: strings(rec.schemaTypes, 12) } : {}),
    ...(Array.isArray(rec.sections) ? { sections: rec.sections.filter((s): s is Record<string, unknown> => s != null && typeof s === "object" && typeof s.text === "string").map((s) => ({ heading: str(s.heading), text: s.text as string })) } : {}),
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
 *  records the other as an alias rather than minting a third.
 *  `pages` and `parentId` are what the SEMANTIC pass adds ON TOP of that identity: which of my own addresses
 *  answers this case, and the broader case this one sits under. BOTH ARE OPTIONAL AND ADDITIVE, so a row
 *  written before they existed reads as a case with no page filed and no parent rather than a broken row,
 *  and the identity rules above never depend on either of them. */
export type ResearchCase = { id: string; anchors: string[]; aliasOf?: string;
  pages?: { url: string; relation: "covers" | "partially_covers" | "does_not_cover" }[]; parentId?: string };

/** THE domains that keep winning across a WHOLE case's keyword set, bought in ONE request for the set and
 *  never one per keyword. DOMAIN evidence, never a keyword: nothing here ever enters the keyword funnel.
 *  `served` is the one place cache-versus-paid is recorded per call, because the executor that made it knew,
 *  and `receipt` is the money core's own cache identity for it. */
type ResearchCaseCompetitors = {
  caseId: string;
  /** How many of the case's keywords the one request actually carried (the provider ceiling is 200). */
  keywordsAsked: number;
  domains: { domain: string; avgPosition: number | null; rating: number | null; keywordsCount: number | null }[];
  observedAt: string; receipt: string | null; served: "paid" | "cache";
};

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
  /** THE CANONICAL RECORD, loaded from ai_observations by the snapshot loader; the funnel never fills this. */
  aiObservations: CanonicalPairObservation[];
  serpEvidence: ResearchSerpEvidence[];
  winningPages: ResearchWinningPage[];
  /** Optional so a bundle built before comparisons existed still reads (as none of them). */
  pageComparisons?: ResearchPageComparison[];
  /** The case identities on file. Optional for the same reason; absent reads as none of them. */
  cases?: ResearchCase[];
  /** Failed reads of MY OWN pages, so a verdict names a retry date it will actually keep. Absent = none. */
  ownedReads?: OwnedPageReadOutcome[];
  /** The recurring winning domains bought per case set. Optional and additive; absent reads as none. */
  caseCompetitors?: ResearchCaseCompetitors[];
  receipt: ResearchReceipt;
};

export function emptyResearchEvidence(): FunnelResearchEvidence {
  return {
    retainedKeywords: [],
    aiObservations: [],
    serpEvidence: [],
    winningPages: [],
    pageComparisons: [], cases: [], ownedReads: [], caseCompetitors: [],
    receipt:{ researched: 0, retained: 0, stale: 0, missing: 0, cached: 0, spentUsd: 0, freshestObservationAt: null },
  };
}
