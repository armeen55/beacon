/** EvidenceSnapshot kernel (2026-07-22) — the ONE normalized evidence contract every Decision (recommendations / rec-intel / drafts) and every surface (Today / Changes / Results) consumes. It collapses the six mandatory sources into a single per-tenant/site object so downstream code never again reaches into demand-graph, serp, pages, ai-visibility, research, scanning, provenance, profound-coverage, or prompt-answer-observations directly. The six mandatory sources normalize in here: GSC → owned-page search metrics (clicks/impressions/ctr/position) + query demand GA4 → owned-page engagement + real revenue $ Wix/crawl → owned-page CONTENT (title/h1/outline/schema/faq/word count/internal links) Clarity → owned-page friction (rage/dead/quickback/script errors) DataForSEO → keyword/volume demand native AI → DERIVED from the canonical AI answers on the research payload: the questions those answers answered and the addresses they credited. No input slot, so there is ONE AI truth. This module is PURE and deterministic (no I/O, no LLM, no Date.now beyond the caller-supplied `builtAt`). The I/O edge that reuses the existing cached connector readers lives in `snapshot-loader.ts`. Every source is represented in `sources[]` with an HONEST freshness/failure state so a dormant native-AI adapter or a failed GA4 read is visible, never silently zeroed. Derived views live NEXT to this contract, never inside it: `topic-investigation.ts` projects the same snapshot into non-actionable research packets (what has been investigated about a topic and whether it is enough to compare), computed on demand by the slice that needs it rather than on every snapshot build. */

import { createHash } from "node:crypto";

import { anchoredTopicMatch, canonicalQueryKey, domainOf, templateHeadings, topicTokens, weakAnchorTokens } from "./relevance-gate";
import type { FunnelResearchEvidence } from "./funnel/research-evidence";

// ── source identity + freshness ──────────────────────────────────────────────

/** The six mandatory sources. `native_ai` may fail soft / stay dormant when creds/config are absent, but its slot is ALWAYS present so its absence is honest and visible rather than a silent gap. */
export type EvidenceSourceKind = "gsc" | "ga4" | "wix" | "clarity" | "dataforseo" | "native_ai";
export const MANDATORY_SOURCES: readonly EvidenceSourceKind[] = [
  "gsc",
  "ga4",
  "wix",
  "clarity",
  "dataforseo",
  "native_ai",
] as const;
/** fresh — data present and within its freshness window. stale — data present but older than its window (usable, flagged). empty — reader ran clean but returned nothing (no rows yet). failed — reader threw / errored (a real failure, NOT the same as empty). dormant — source intentionally not configured (native AI with no creds). */
type SourceStatus = "fresh" | "stale" | "empty" | "failed" | "dormant";
type SourceFreshness = {
  source: EvidenceSourceKind;
  status: SourceStatus;
  /** ISO of the newest row this source contributed, or null. */
  lastSyncedAt: string | null;
  /** How many rows this source contributed (coverage/honesty line). */
  rowsSeen: number;
  /** One plain sentence for a customer-facing "why is this blank" line. */
  note: string;};
// ── per-owned-page evidence (GSC + GA4 + Wix + Clarity + AI joined by URL) ────
export type OwnedQuerySignal = {
  query: string;
  impressions: number;
  clicks: number;
  position: number | null;};
export type OwnedPageContent = {
  revision?: Pick<import("./pages/types").PageSnapshot, "content_hash" | "headings_hash" | "faq_hash" | "schema_hash"> | null;
  /** The crawler's own confidence in the capture, and which capture these words are (pages/page-version). */
  extractionCertainty?: string | null; versionState?: ReturnType<typeof import("./pages/page-version").selectPageVersion>["state"]; contentAt?: string | null; newestAt?: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2: string[];
  /** h2 + h3 in document order — the comparable outline. */
  outline: string[];
  schemaTypes: string[];
  hasFaq: boolean;
  faqCount: number;
  wordCount: number;
  internalLinks: { href: string; anchorText: string }[];
  fetchedAt: string | null;
  /** How the page is served, for the technical catalogue: absent means never captured, never "clean". */
  canonicalUrl?: string | null;
  hasCanonicalMismatch?: boolean | null;
  robotsMeta?: string | null;
  /** Where the read of this page actually landed. Absent on captures taken before it was recorded. */
  finalUrl?: string | null;};
type OwnedPageSearch = {
  clicks90d: number;
  impressions90d: number;
  ctr90d: number;
  position90d: number;
  topQueries: OwnedQuerySignal[];};
type OwnedPageEngagement = {
  sessions28d: number;
  engaged28d: number;
  conversions28d: number;
  /** Real GA4 revenue $, or null when unknown (never 0-for-unknown). */
  revenueUsd: number | null;};
type OwnedPageFriction = {
  sessions: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  scriptErrors: number;
  /** Composite friction score (rage + dead + 2×scriptErrors), for ranking. */
  frictionScore: number;};
export type OwnedPageEvidence = {
  /** Canonicalized owned page URL (the join key). */
  url: string;
  content: OwnedPageContent | null;
  search: OwnedPageSearch | null;
  engagement: OwnedPageEngagement | null;
  friction: OwnedPageFriction | null;
  /** AI citations of THIS owned page. `count` is DISTINCT ANSWERS that credited it, never repeats inside one. */
  aiCitations: { count: number; distinctPrompts: number; engines: string[] };};
// ── competitor evidence (native AI + SERP citations) ─────────────────────────
type CompetitorEvidence = {
  url: string;
  domain: string;
  /** DISTINCT ANSWERS that credited this address. One answer gets one vote however often it repeats itself. */
  citationCount: number;
  /** Distinct tracked questions that credited it: THE authority on recurrence, and how rivals are ranked. */
  distinctPrompts: number;
  engines: string[];
  examplePrompts: string[];};
// ── demand: keyword volume + AI-answer questions ─────────────────────────────
type KeywordDemandSignal = {
  query: string;
  /** Monthly search volume, or null when unknown (never guessed). */
  searchVolume: number | null;
  /** Where the demand number came from. */
  source: "gsc" | "dataforseo" | "ai_ask" | "mixed";
  /** 0..1 paid competition, or null. */
  competition: number | null;
  competitionLevel: "low" | "medium" | "high" | null;
  /** GSC impressions when this query is a real owned/served term, else null. */
  gscImpressions: number | null;};
type QuestionDemandSignal = {
  question: string;
  /** Distinct (prompt, engine) pairs that produced this question — the weight. */
  weight: number;
  sourcePrompts: string[];
  source: "native_ai";
  /** Whether an owned page already answers it (best-effort topic match). */
  coverageStatus: "answered" | "unanswered" | "unknown";};
// ── derived intelligence (normalized ONCE, not per source) ───────────────────
type IntentCluster = {
  key: string;
  label: string;
  /** Coarse intent bucket derived deterministically from the label tokens. */
  intent: "informational" | "commercial" | "navigational" | "transactional";
  queries: string[];
};
type CannibalizationGroup = {
  query: string;
  /** Two+ owned URLs Google MATERIALLY serves for the same query: self-competition. Exactly the addresses a surface may name, so a count and a list can never disagree. */
  competingUrls: string[];
  note: string;
};
/** WHEN A SECOND PAGE OF YOURS IS REALLY COMPETING, in the units the operator can check. One appearance in 90 days is noise, not a split: every page owes MIN_SPLIT_IMPRESSIONS views of its own, the HOME PAGE owes SPLIT_SHARE of that search on top because it is shown for everything a site ranks for at all, and MAX_SPLIT_PAGES because a group is read one address at a time. */
const MIN_SPLIT_IMPRESSIONS = 50, SPLIT_SHARE = 0.05, MAX_SPLIT_PAGES = 6;
/** The site root, whatever spelling it arrives in. */
const isHomeUrl = (url: string): boolean => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") === ""; } catch { return false; } };
type ContentGapKind =
  | "unanswered_question"
  | "missing_schema"
  | "missing_faq"
  | "thin_vs_competitor";
type ContentGap = {
  kind: ContentGapKind;
  topic: string;
  detail: string;
  ownedUrl: string | null;
  competitorUrl: string | null;
};
type InternalLinkOpportunity = {
  fromUrl: string;
  toUrl: string;
  /** Suggested anchor (the target's topic label). */
  anchor: string;
  reason: string;
};
// ── the snapshot ─────────────────────────────────────────────────────────────

type EvidenceSnapshotScope = {
  tenantId: string;
  /** Site host (e.g. "example.com"), or null for a tenant-wide snapshot. */
  site: string | null;
  builtAt: string;
};

export type EvidenceSnapshot = {
  scope: EvidenceSnapshotScope;
  /** ALL six sources, always present, with honest freshness/failure state. */
  sources: SourceFreshness[];
  ownedPages: OwnedPageEvidence[];
  competitors: CompetitorEvidence[];
  keywordDemand: KeywordDemandSignal[];
  questionDemand: QuestionDemandSignal[];
  intentClusters: IntentCluster[];
  cannibalization: CannibalizationGroup[];
  contentGaps: ContentGap[];
  internalLinkOpportunities: InternalLinkOpportunity[];
  aiCitations: {
    ownedCited: number;
    competitorCited: number;
    engines: string[];
    rowsScanned: number;
  };
  /** The research funnel's basis-scoped evidence, carried verbatim: retained keyword metrics with intent, exact AI prompt/engine observations, per-query SERP evidence, winning pages with true provenance, and the funnel receipt. */
  research: FunnelResearchEvidence;
  /** Stable over timestamps; changes only when material evidence changes. */
  evidenceHash: string;
};

// ── pure assembler input (already-loaded, fail-soft per source) ──────────────

/** One loaded source payload wrapped with its honest status. `payload` is the source's already-normalized rows; a failed/dormant/empty source carries an empty payload but STILL occupies its slot in the snapshot. */
export type LoadedSource<T> = {
  status: SourceStatus;
  lastSyncedAt: string | null;
  note?: string;
  payload: T;
};

export type EvidenceSnapshotInput = {
  scope: EvidenceSnapshotScope;
  /** GSC: per-owned-page search metrics keyed by canonical URL. */
  gsc: LoadedSource<{ url: string; clicks90d: number; impressions90d: number; ctr90d: number; position90d: number; topQueries: OwnedQuerySignal[] }[]>;
  /** GA4: per-owned-page engagement + revenue keyed by canonical URL. */
  ga4: LoadedSource<{ url: string; sessions28d: number; engaged28d: number; conversions28d: number; revenueUsd: number | null }[]>;
  /** Wix/crawl: per-owned-page CONTENT keyed by canonical URL. */
  wix: LoadedSource<({ url: string } & OwnedPageContent)[]>;
  /** Clarity: per-owned-page friction keyed by canonical URL. */
  clarity: LoadedSource<({ url: string } & OwnedPageFriction)[]>;
  /** DataForSEO: keyword volume rows. */
  dataforseo: LoadedSource<{ query: string; searchVolume: number | null; competition: number | null; competitionLevel: "low" | "medium" | "high" | null }[]>;
  /** Research funnel: retained keywords WITH intent, the CANONICAL AI answers, per-query SERP evidence, winning pages with true provenance, + the receipt. The native-AI source is DERIVED from the answers on this payload; it has no input slot of its own, so there is one AI truth and never a weaker second. */
  research: LoadedSource<FunnelResearchEvidence>;
  /** TRUE when the canonical answer read FAILED this run: not an empty account (it told a 418 answer account "nothing stored yet"). REQUIRED so no later builder can forget it and quietly claim the same. */
  aiAnswersUnread: boolean;
};

/** Grounding and redirect hosts an engine routes its citations through: infrastructure, never a source AI keeps recommending, so unfiltered they are a fake number one. */
const CITATION_WRAPPERS = new Set(["vertexaisearch.cloud.google.com", "www.google.com", "google.com", "www.bing.com", "bing.com"]);
/** The bounds the AI lists keep, unchanged from the reader they replace: a snapshot is a decision surface, not a dump, and a fragment too short or too long to be a question stays out. */
const MAX_CITED_PAGES = 15, MAX_QUESTIONS = 30, MIN_QUESTION_LEN = 12, MAX_QUESTION_LEN = 160;

// ── pure helpers ─────────────────────────────────────────────────────────────

export function canonicalUrlKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  }
}

const norm = (s: string): string => s.trim().toLocaleLowerCase("en-US");

/** Phrases an account must have on file before any word of its own can be called ubiquitous. */
const MIN_ANCHOR_CORPUS = 10;

const COMMERCIAL = /\b(buy|price|cost|cheap|deal|discount|hire|near me|for sale|book|order|shop)\b/i;
const TRANSACTIONAL = /\b(download|sign ?up|subscribe|checkout|apply|register|quote)\b/i;
const NAVIGATIONAL = /\b(login|log in|contact|about|homepage|official site|dashboard)\b/i;

const classifyIntent = (label: string): IntentCluster["intent"] =>
  TRANSACTIONAL.test(label) ? "transactional" : NAVIGATIONAL.test(label) ? "navigational" : COMMERCIAL.test(label) ? "commercial" : "informational";

/** WEAK ANCHORS: the one word this account puts on nearly everything it owns fits anything, so on its own it proves no topical connection and must never make every page look related to every other. Read from the account's OWN corpus (its page titles, the searches it retained, the prompts it observed); under MIN_ANCHOR_CORPUS phrases nothing has recurred often enough to earn the label, so the set is empty and a single-topic account keeps its honest overlaps unchanged. ONE definition per account, shared by the snapshot's evidence joins and by the TopicInvestigation projection in `topic-investigation.ts`. */
export function weakAnchorsOf(ownedPages: OwnedPageEvidence[], research: FunnelResearchEvidence): Set<string> {
  const corpus = [...new Set([...ownedPages.map((p) => p.content?.title || p.content?.h1 || p.url),
    ...research.retainedKeywords.map((k) => k.query), ...research.aiObservations.map((o) => o.promptText)]
    .map((s) => (s ?? "").trim()).filter(Boolean))];
  return corpus.length < MIN_ANCHOR_CORPUS ? new Set<string>() : weakAnchorTokens(corpus);
}

/** Deterministic freshness row for a source, derived from its LoadedSource. */
function freshnessOf(source: EvidenceSourceKind, loaded: LoadedSource<unknown>, rowsSeen: number): SourceFreshness {
  const defaultNote: Record<SourceStatus, string> = {
    fresh: `I have current ${source.toUpperCase()} data (${rowsSeen} rows).`,
    stale: `My ${source.toUpperCase()} data is older than its window; still using it, flagged.`,
    empty: `I connected to ${source.toUpperCase()} but there is nothing recorded yet.`,
    failed: `I could not read ${source.toUpperCase()} this run.`,
    dormant: `${source.toUpperCase()} is not connected, so research runs without it for now.`,
  };
  return {
    source,
    status: loaded.status,
    lastSyncedAt: loaded.lastSyncedAt,
    rowsSeen,
    note: loaded.note ?? defaultNote[loaded.status],
  };
}

// ── the pure assembler ───────────────────────────────────────────────────────

/** Normalize the six loaded sources into ONE EvidenceSnapshot. PURE: same input → same output (the only clock is scope.builtAt, supplied by the caller). Joins owned pages by canonical URL, derives intent/clustering, cannibalization, content gaps, internal-link opportunities, and a stable evidenceHash. Every source occupies a freshness slot even when empty/failed/ dormant, so the snapshot never hides a missing source. */
export function buildEvidenceSnapshot(input: EvidenceSnapshotInput): EvidenceSnapshot {
  const { scope } = input;

  // ── join owned pages by canonical URL ──
  const ownedByUrl = new Map<string, OwnedPageEvidence>();
  const ensure = (rawUrl: string): OwnedPageEvidence | null => {
    const url = canonicalUrlKey(rawUrl);
    if (!url) return null;
    let row = ownedByUrl.get(url);
    if (!row) {
      row = {
        url,
        content: null,
        search: null,
        engagement: null,
        friction: null,
        aiCitations: { count: 0, distinctPrompts: 0, engines: [] },
      };
      ownedByUrl.set(url, row);
    }
    return row;
  };

  for (const r of input.gsc.payload) {
    const row = ensure(r.url);
    if (row)
      row.search = {
        clicks90d: r.clicks90d,
        impressions90d: r.impressions90d,
        ctr90d: r.ctr90d,
        position90d: r.position90d,
        // THE SAME GRAIN THE READER KEPT: a second, tighter cut here threw away searches the reader had already paid to fetch, and a search the kernel never sees is a change it can never earn.
        topQueries: [...r.topQueries].sort((a, b) => b.impressions - a.impressions).slice(0, 40),
      };
  }
  for (const r of input.ga4.payload) {
    const row = ensure(r.url);
    if (row)
      row.engagement = { sessions28d: r.sessions28d, engaged28d: r.engaged28d, conversions28d: r.conversions28d, revenueUsd: r.revenueUsd };
  }
  for (const r of input.wix.payload) {
    const row = ensure(r.url);
    if (row) { const { url: _url, ...content } = r; void _url; row.content = { ...content, outline: [...content.outline] }; }
  }
  // SITE FURNITURE COMES OUT AT THE CANONICAL EXTRACTION, not in three producers' private filters. A heading
  // this site prints on a third of its pages is navigation, and left in the canonical outline it grounded
  // drafts, earned words a page never earned, and counted as list items. Stripped HERE, every consumer
  // (drafters, page jobs, fit, journeys) reads the same clean outline; nothing needs its own copy of this
  // defense, and no phrase list is ever hardcoded: the set is computed from the account's own pages.
  {
    const furniture = templateHeadings([...ownedByUrl.values()].map((p) => p.content?.outline ?? []));
    if (furniture.size > 0) for (const row of ownedByUrl.values()) {
      if (row.content?.outline?.length) row.content.outline = row.content.outline.filter((h) => !furniture.has(h.trim().toLowerCase().replace(/\s+/g, " ")));
    }
  }
  for (const r of input.clarity.payload) {
    const row = ensure(r.url);
    if (row) { const { url: _url, ...friction } = r; void _url; row.friction = friction; }
  }

  // ── the AI answers on file: which addresses they keep crediting, split into this account's and everybody else's ── RECURRENCE ACROSS ANSWERS, never inside one: an address is evidence because it comes back on question after question. ONE ANSWER IS ONE VOTE, whatever its citation list repeats: an answer that named the same address eleven times used to outrank one that three separate questions credited. An address the account owns attaches to that page; every other one is a competitor citation.
  const observations = input.research.payload.aiObservations;
  const citedByUrl = new Map<string, { url: string; count: number; prompts: Map<string, string>; engines: Set<string> }>();
  for (const o of observations) { const voted = new Set<string>(); for (const c of o.citations ?? []) {
    // A HOST OR IT IS NOT AN ADDRESS: a citation with no parseable host (`about:blank` and its kind) used to land as a competitor with an empty domain and inflate the count.
    const key = canonicalUrlKey(c.url), host = domainOf(c.url);
    if (!key || !host.includes(".") || CITATION_WRAPPERS.has(host) || voted.has(key)) continue;
    let agg = citedByUrl.get(key);
    if (!agg) { agg = { url: c.url, count: 0, prompts: new Map(), engines: new Set() }; citedByUrl.set(key, agg); }
    voted.add(key); agg.count += 1; agg.engines.add(o.engine); agg.prompts.set(o.promptId, o.promptText);
  } }
  const competitorByUrl = new Map<string, CompetitorEvidence>();
  for (const [key, agg] of citedByUrl) {
    const counts = { citationCount: agg.count, distinctPrompts: agg.prompts.size, engines: [...agg.engines].sort() };
    if (ownedByUrl.has(key) || (scope.site != null && domainOf(agg.url) === scope.site)) {
      const row = ensure(agg.url);
      if (row) row.aiCitations = { count: counts.citationCount, distinctPrompts: counts.distinctPrompts, engines: counts.engines };
    } else {
      competitorByUrl.set(key, { url: key, domain: domainOf(agg.url), ...counts, examplePrompts: [...agg.prompts.values()].slice(0, 5) });
    }
  }

  const ownedPages = [...ownedByUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  // HOW MANY QUESTIONS CREDIT IT FIRST, how many answers second: recurrence across questions is the claim, and the answer count only breaks a tie between rivals that recur equally often.
  const competitors = [...competitorByUrl.values()]
    .sort((a, b) => b.distinctPrompts - a.distinctPrompts || b.citationCount - a.citationCount || a.url.localeCompare(b.url)).slice(0, MAX_CITED_PAGES);

  // ── keyword demand: GSC served queries ∪ DataForSEO volume ──
  const kwByQuery = new Map<string, KeywordDemandSignal>();
  // GSC-served queries first (real, owned demand).
  const gscImpressionsByQuery = new Map<string, number>();
  for (const p of ownedPages) {
    for (const q of p.search?.topQueries ?? []) {
      const key = norm(q.query);
      if (!key) continue;
      gscImpressionsByQuery.set(key, (gscImpressionsByQuery.get(key) ?? 0) + q.impressions);
    }
  }
  for (const [key, impressions] of gscImpressionsByQuery) {
    kwByQuery.set(key, {
      query: key,
      searchVolume: null,
      source: "gsc",
      competition: null,
      competitionLevel: null,
      gscImpressions: impressions,
    });
  }
  for (const kw of input.dataforseo.payload) {
    const key = norm(kw.query);
    if (!key) continue;
    const existing = kwByQuery.get(key);
    if (existing) {
      existing.searchVolume = kw.searchVolume;
      existing.competition = kw.competition;
      existing.competitionLevel = kw.competitionLevel;
      existing.source = existing.gscImpressions != null ? "mixed" : "dataforseo";
    } else {
      kwByQuery.set(key, {
        query: key,
        searchVolume: kw.searchVolume,
        source: "dataforseo",
        competition: kw.competition,
        competitionLevel: kw.competitionLevel,
        gscImpressions: null,
      });
    }
  }
  const keywordDemand = [...kwByQuery.values()].sort(
    (a, b) =>
      (b.searchVolume ?? 0) - (a.searchVolume ?? 0) ||
      (b.gscImpressions ?? 0) - (a.gscImpressions ?? 0) ||
      a.query.localeCompare(b.query),
  );

  // ── AI-answer questions + owned coverage best-effort ──
  const ownedContentText = ownedPages.map((p) =>
    [p.content?.title, p.content?.h1, ...(p.content?.outline ?? [])].filter(Boolean).join(" "),
  );
  const weak = weakAnchorsOf(ownedPages, input.research.payload);
  const relatedTopic = (a: string, b: string): boolean => anchoredTopicMatch(a, b, weak).relevant;
  // The questions the answers themselves ANSWERED, read off the settled readings only: an unsettled or refused reading carries no analysis, so nothing here is ever a question nobody actually read out of an answer.
  const askedByText = new Map<string, { weight: number; prompts: Set<string> }>();
  for (const o of observations) for (const q of Array.isArray(o.analysis?.questionsAnswered) ? o.analysis.questionsAnswered : []) {
    const text = typeof q === "string" ? q.trim() : "";
    if (text.length < MIN_QUESTION_LEN || text.length > MAX_QUESTION_LEN) continue;
    const entry = askedByText.get(text) ?? { weight: 0, prompts: new Set<string>() };
    entry.weight += 1; entry.prompts.add(o.promptText); askedByText.set(text, entry);
  }
  const questionDemand: QuestionDemandSignal[] = [...askedByText.entries()]
    .map(([question, entry]) => {
      const covered = ownedContentText.some((text) => relatedTopic(question, text));
      return {
        question,
        weight: entry.weight,
        sourcePrompts: [...entry.prompts].slice(0, 8),
        source: "native_ai" as const,
        coverageStatus: (ownedContentText.length === 0 ? "unknown" : covered ? "answered" : "unanswered") as QuestionDemandSignal["coverageStatus"],
      };
    })
    .sort((a, b) => b.weight - a.weight || a.question.localeCompare(b.question)).slice(0, MAX_QUESTIONS);

  // ── intent clusters from owned served queries + AI questions ──
  const clusterByTopic = new Map<string, IntentCluster>();
  const clusterKey = (label: string): string => {
    const tokens = topicTokens(label);
    return tokens.slice(0, 3).sort().join("-") || norm(label);
  };
  const addToCluster = (label: string) => {
    const key = clusterKey(label);
    if (!key) return;
    let c = clusterByTopic.get(key);
    if (!c) {
      c = { key, label, intent: classifyIntent(label), queries: [] };
      clusterByTopic.set(key, c);
    }
    if (!c.queries.some((q) => norm(q) === norm(label))) c.queries.push(label);
  };
  for (const kw of keywordDemand) addToCluster(kw.query);
  for (const q of questionDemand) addToCluster(q.question);
  const intentClusters = [...clusterByTopic.values()]
    .map((c) => ({ ...c, queries: c.queries.slice(0, 12) }))
    .sort((a, b) => b.queries.length - a.queries.length || a.key.localeCompare(b.key));

  // ── cannibalization: 2+ owned URLs MATERIALLY serving the same query ── A page Google showed once for a search lands in that search's rows, and counting it as competition told an operator six of their pages compete for something four of them are never really shown for. A page joins a split on its own weight.
  const urlsByQuery = new Map<string, Map<string, number>>();
  for (const p of ownedPages) {
    for (const q of p.search?.topQueries ?? []) {
      const key = norm(q.query);
      if (!key) continue;
      if (!urlsByQuery.has(key)) urlsByQuery.set(key, new Map());
      const at = urlsByQuery.get(key)!;
      at.set(p.url, (at.get(p.url) ?? 0) + Math.max(0, q.impressions));
    }
  }
  const materialSplit = (rows: Map<string, number>): Array<[string, number]> => {
    const total = [...rows.values()].reduce((a, n) => a + n, 0);
    return [...rows.entries()]
      // THE HOME PAGE IS SHOWN FOR EVERYTHING a site ranks for at all, so a flat floor lets it into every split on the site. It joins only by carrying a real share of the search, never on the floor alone.
      // THE FLOOR IS UNCONDITIONAL AND THE SHARE IS AN EXTRA HURDLE, never a second way in. As an OR it admitted
      // every page of a search only two pages are ever shown for, so 49 views against 49 read as a split and so
      // did 1 against 1. The home page clears the floor and then has to carry a real share of the search too.
      .filter(([url, n]) => n >= MIN_SPLIT_IMPRESSIONS && (!isHomeUrl(url) || (total > 0 && n >= SPLIT_SHARE * total)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_SPLIT_PAGES);
  };
  const cannibalization: CannibalizationGroup[] = [...urlsByQuery.entries()]
    .map(([query, rows]) => ({ query, kept: materialSplit(rows) }))
    .filter(({ kept }) => kept.length >= 2)
    // WHAT IS COUNTED IS WHAT IS NAMED: every surface downstream lists these addresses one by one, so the count in the sentence and the length of the list are the same number by construction.
    .map(({ query, kept }) => ({ query, competingUrls: kept.map(([url]) => url),
      note: `${kept.length} of your pages compete for "${query}", so pick one owner and point the rest at it.` }))
    .sort((a, b) => b.competingUrls.length - a.competingUrls.length || a.query.localeCompare(b.query));

  // ── content gaps: unanswered AI questions + owned-vs-competitor structure ──
  const contentGaps: ContentGap[] = [];
  for (const q of questionDemand) {
    if (q.coverageStatus !== "unanswered") continue;
    contentGaps.push({ kind: "unanswered_question", topic: q.question, ownedUrl: null, competitorUrl: null,
      detail: `AI keeps getting asked "${q.question}" (${q.weight} prompts) and none of your pages answer it.` });
  }

  // ── internal-link opportunities: owned page A on-topic for owned page B ──
  const internalLinkOpportunities: InternalLinkOpportunity[] = [];
  for (const from of ownedPages) {
    const fromLinks = new Set((from.content?.internalLinks ?? []).map((l) => canonicalUrlKey(l.href)));
    for (const to of ownedPages) {
      if (from.url === to.url) continue;
      if (fromLinks.has(to.url)) continue;
      const toLabel = to.content?.h1 ?? to.content?.title;
      const fromText = [from.content?.title, from.content?.h1, ...(from.content?.outline ?? [])]
        .filter(Boolean)
        .join(" ");
      if (!toLabel || !fromText) continue;
      // Anchored, never bare: the site-wide word alone is not a reason to link one page to another.
      if (!relatedTopic(fromText, toLabel)) continue;
      internalLinkOpportunities.push({ fromUrl: from.url, toUrl: to.url, anchor: toLabel,
        reason: `"${from.url}" is on-topic for "${toLabel}" but does not link to it yet.` });
    }
  }
  internalLinkOpportunities.sort(
    (a, b) => a.fromUrl.localeCompare(b.fromUrl) || a.toUrl.localeCompare(b.toUrl),
  );

  // ── AI citation rollup, off the same answers everything above was built from ──
  const ownedCited = ownedPages.filter((p) => p.aiCitations.count > 0).length;
  const aiEngines = [...new Set(observations.map((o) => o.engine))].sort();
  // FOUR STATES, FOUR CLAIMS, each in my own words: a read I did not get, no answer stored yet, answers that named nobody, answers that named pages. The shared default said "nothing recorded yet" over a row counting stored answers.
  const unread = input.aiAnswersUnread, credited = citedByUrl.size > 0;
  const nativeAi: LoadedSource<null> = { payload: null,
    status: unread ? "failed" : observations.length === 0 ? "dormant" : credited ? "fresh" : "empty",
    lastSyncedAt: observations.map((o) => o.observedAt).filter((t): t is string => !!t).sort().at(-1) ?? null,
    ...(unread ? { note: "Your stored AI answers could not be read this run, so decisions are made without them." }
      : observations.length === 0 ? { note: "No AI answer is stored for your questions yet, so that evidence is not in play for now." }
      : credited ? {} : { note: `${observations.length} AI answers are stored and not one of them has named a page yet, so there is nothing to compare pages on.` }) };

  // ── freshness for all six sources ──
  const sources: SourceFreshness[] = [
    freshnessOf("gsc", input.gsc, input.gsc.payload.length),
    freshnessOf("ga4", input.ga4, input.ga4.payload.length),
    freshnessOf("wix", input.wix, input.wix.payload.length),
    freshnessOf("clarity", input.clarity, input.clarity.payload.length),
    freshnessOf("dataforseo", input.dataforseo, input.dataforseo.payload.length),
    freshnessOf("native_ai", nativeAi, observations.length),
  ];

  const snapshot: Omit<EvidenceSnapshot, "evidenceHash"> = {
    scope,
    sources,
    ownedPages,
    competitors,
    keywordDemand,
    questionDemand,
    intentClusters,
    cannibalization,
    contentGaps,
    internalLinkOpportunities,
    aiCitations: {
      ownedCited,
      competitorCited: competitors.length,
      engines: aiEngines,
      rowsScanned: observations.length,
    },
    research: input.research.payload,
  };

  return { ...snapshot, evidenceHash: hashSnapshot(snapshot) };
}

/** Stable evidence hash over the MATERIAL evidence (not timestamps or the per-source freshness/lastSyncedAt clock). Two runs with the same underlying evidence produce the same hash even if built at different times. */
export function hashSnapshot(snapshot: Omit<EvidenceSnapshot, "evidenceHash">): string {
  const stable = {
    t: snapshot.scope.tenantId,
    site: snapshot.scope.site,
    src: snapshot.sources.map((s) => [s.source, s.status, s.rowsSeen]),
    op: snapshot.ownedPages.map((p) => [
      p.url,
      materialContent(p.content),
      p.search ? [p.search.clicks90d, p.search.impressions90d, p.search.position90d] : null,
      p.engagement ? [p.engagement.conversions28d, p.engagement.revenueUsd] : null,
      p.friction ? [p.friction.frictionScore] : null,
      p.aiCitations.count,
    ]),
    comp: snapshot.competitors.map((c) => [c.url, c.citationCount, c.distinctPrompts]),
    kw: snapshot.keywordDemand.map((k) => [k.query, k.searchVolume, k.source, k.gscImpressions]),
    q: snapshot.questionDemand.map((q) => [q.question, q.weight, q.coverageStatus]),
    gap: snapshot.contentGaps.map((g) => [g.kind, g.topic]),
    ilo: snapshot.internalLinkOpportunities.map((l) => [l.fromUrl, l.toUrl]),
    can: snapshot.cannibalization.map((c) => [c.query, c.competingUrls]),
    // MATERIAL research truth, not counters: the actual retained keyword metrics, the exact AI observations (observation MODE, models served/requested, web-search state, cited urls+domains, fan-out queries), the per-query SERP evidence, and the winning pages with their extract structure. Every timestamp and every spend/cache counter is excluded, so the same evidence at a later clock hashes identically while a changed citation, mode, served model, fan-out, settled reading, volume/intent, or extract structure changes it.
    // THE WORDS A RESULTS PAGE CARRIES ARE DELIBERATELY NOT HASHED: snippet, featured, itemTypes, aiOverviewText, aiOverviewState and the PAA answer are briefing a writer reads, not evidence a decision stands on, and Google rewrites them constantly. Folding them in would re-identify every Ready and implemented row the first time a snippet was reworded. WHICH pages rank, WHICH are cited and WHICH questions are asked still move the hash, exactly as before.
    res: {
      kw: snapshot.research.retainedKeywords.map((k) => [k.query, k.searchVolume, k.competition, k.intent]),
      // The SETTLED READING is material too: same citations, same fan-outs, a reading now on file is different evidence.
      ai: snapshot.research.aiObservations.map((o) => [o.promptId, o.engine, o.observationMode, o.modelServed, o.modelRequested, o.webSearchReported, o.citationsObserved, (o.citations ?? []).map((c) => [c.url, c.domain]), o.fanOutQueries, o.analysisHash ?? null]),
      serp: snapshot.research.serpEvidence.map((s) => [s.query, s.organic.map((o) => [o.rank, o.url]), s.aiOverview.map((c) => c.url), s.aiMode.map((c) => c.url), s.paa.map((p) => p.question), s.related]),
      win: snapshot.research.winningPages.map((w) => [w.url, w.engines, w.examplePrompts, materialExtract(w.extract)]),
    },
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

const materialContent = (c: OwnedPageContent | null) => c ? [c.revision ?? null, c.title, c.metaDescription, c.h1, c.h2, c.outline, [...c.schemaTypes].sort(), c.faqCount, c.wordCount, c.internalLinks, c.versionState ?? null, c.extractionCertainty ?? null, c.finalUrl ?? null, c.canonicalUrl ?? null, c.robotsMeta ?? null, c.hasCanonicalMismatch ?? null] : null;
const materialExtract = (x: EvidenceSnapshot["research"]["winningPages"][number]["extract"]) => x ? [
  x.title, x.h1, x.wordCount, x.headings, x.faqCount ?? null, x.metaDescription ?? null, x.openingSample ?? null, x.entityNames ?? null,
  x.hasList ?? null, x.hasTable ?? null, x.internalLinkCount ?? null, x.externalLinkCount ?? null, x.mainText ?? null,
  x.truncated ?? null, x.heldChars ?? null, x.totalChars ?? null, x.h3s ?? null, x.sections ?? null, x.schemaTypes ?? null] : null;

/** Job-scoped identity: affected owned revisions and exact-query winning material, never unrelated account drift
 * or capture clocks. Unknown and partial captures retain their actual scope, not fabricated complete evidence. */
export function jobEvidenceHash(snapshot: Pick<EvidenceSnapshot, "ownedPages" | "research">, pageKeys: readonly string[], primaryQuery: string): string {
  const keys = new Set(pageKeys.map((k) => canonicalUrlKey(k)).filter(Boolean));
  const pages = snapshot.ownedPages.filter((p) => keys.has(canonicalUrlKey(p.url)))
    .map((p) => [canonicalUrlKey(p.url),
      materialContent(p.content),
      p.search ? [p.search.clicks90d, p.search.impressions90d, p.search.position90d] : null,
      p.engagement ? [p.engagement.conversions28d, p.engagement.revenueUsd] : null,
      p.friction ? [p.friction.frictionScore] : null, p.aiCitations.count])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const qk = canonicalQueryKey(primaryQuery ?? "");
  // Database row ordering is not new evidence.
  const serp = qk ? snapshot.research.serpEvidence.filter((s) => canonicalQueryKey(s.query) === qk)
    .map((s) => [[...s.organic].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url)).map((o) => [o.rank, o.url]),
      [...s.aiOverview].map((c) => c.url).sort(), [...s.aiMode].map((c) => c.url).sort()])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : [];
  const winners = jobWinners(snapshot.research, primaryQuery)
    .map((w) => [canonicalUrlKey(w.url), materialExtract(w.extract)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify({ pages, serp, winners })).digest("hex").slice(0, 16);
}

/** THE PAGES ACQUIRED FOR ONE JOB'S OWN SEARCH, by the two ways a page is ever acquired for it: it ranks on that
 *  exact search's results page, or an assistant answering that exact search cited it. The appearance half used to be
 *  missing here, so a winner read BECAUSE an assistant cited it never moved the job's identity and never reopened the
 *  work it was read for. ONE rule, read by the identity above and by the brief below, so what reopens a job is exactly
 *  what its writer is then handed. Deterministic and order-free. Exported for `serpAnswersOf` in serp-shape, so the passages a brief quotes come off exactly the pages this rule already calls this job's winners. */
export function jobWinners(research: Pick<EvidenceSnapshot["research"], "serpEvidence" | "winningPages">, primaryQuery: string | readonly string[], channel: "seo" | "aeo" = "seo") {
  // ONE GROUP, EVERY PHRASING (campaign, 2026-09-05): a reader asks one thing several ways and the diagnosis already groups them, so the winners of "boy farsi names" and "farsi boy names" are one job's winners. A single string is one phrasing and behaves exactly as it always did.
  const keys = new Set((typeof primaryQuery === "string" ? [primaryQuery] : primaryQuery).map((q) => canonicalQueryKey(q ?? "")).filter(Boolean)); if (keys.size === 0) return [];
  const serps = (research.serpEvidence ?? []).filter((s) => keys.has(canonicalQueryKey(s.query)));
  const support = (w: EvidenceSnapshot["research"]["winningPages"][number]) => { const url = canonicalUrlKey(w.url), ranks = serps.flatMap((s) => (s.organic ?? []).filter((o) => canonicalUrlKey(o.url) === url).map((o) => o.rank));
    const citations = new Set(serps.flatMap((s) => ([ ["ai_overview", s.aiOverview ?? []], ["ai_mode", s.aiMode ?? []] ] as const).flatMap(([kind, rows]) => rows.filter((o) => canonicalUrlKey(o.url) === url).map(() => `${kind}|${canonicalQueryKey(s.query)}|${s.observedAt}`))));
    for (const a of w.appearances ?? []) if (keys.has(canonicalQueryKey(a.query ?? a.promptText ?? "")) && a.kind !== "serp_organic") citations.add(a.kind === "ai_answer" ? `${a.kind}|${a.promptId ?? a.promptText ?? a.query}|${a.promptVersion ?? ""}|${a.engine}|${a.reportingDay ?? a.observedAt.slice(0, 10)}` : `${a.kind}|${canonicalQueryKey(a.query ?? "")}|${a.observedAt}`);
    return { rank: ranks.length ? Math.min(...ranks) : null, citationObservations: citations.size }; };
  return (research.winningPages ?? [])
    .map((w) => ({ ...w, querySupport: support(w) }))
    .filter((w) => w.querySupport.rank != null || w.querySupport.citationObservations > 0 || (w.appearances ?? []).some((a) => keys.has(canonicalQueryKey(a.query ?? a.promptText ?? ""))))
    .sort((a, b) => (channel === "aeo" ? b.querySupport.citationObservations - a.querySupport.citationObservations : 0) || (a.querySupport.rank ?? Infinity) - (b.querySupport.rank ?? Infinity) || b.querySupport.citationObservations - a.querySupport.citationObservations || Number(!!b.extract?.mainText) - Number(!!a.extract?.mainText) || canonicalUrlKey(a.url).localeCompare(canonicalUrlKey(b.url)))
    .filter((w, i, rows) => rows.findIndex((x) => canonicalUrlKey(x.url) === canonicalUrlKey(w.url)) === i);
}
