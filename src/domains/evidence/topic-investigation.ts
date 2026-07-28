/**
 * TopicInvestigation (research packet, 2026-07-27) - the canonical NON-ACTIONABLE
 * research projection over the EvidenceSnapshot. It answers ONE question for a
 * later slice: "what have I actually investigated about this topic, and is it
 * enough to compare?" It is a pure derived view: no persistence, no lifecycle, no
 * status vocabulary, no LLM.
 *
 * It deliberately does NOT carry: a candidate action, a proposal, drafted copy, a
 * proposed URL, an existing-page-versus-new-page decision, an owned-page mapping,
 * an opportunity value, or any prose that was not observed. Those belong to the
 * slice that reasons over this packet, never to the packet itself.
 *
 * GROUPING, in strict priority order (the first rule that fires is the recorded
 * reason). Lineage before semantic guesses:
 *   1 seed_lineage  - DataForSEO recorded the seed a related/suggestion keyword
 *                     came from, so the child provably descends from that theme.
 *   2 gsc_owned_page- Google serves the same owned page for both exact queries.
 *   3 prompt_fanout - an engine's OWN fan-out for a tracked prompt is exactly the
 *                     other side's query (provider-reported lineage).
 *   4 shared_entity - the two sides carry the same specific tokens.
 *   5 serp_overlap  - the two exact result pages return the same pages. Distinct
 *                     intents do not return the same pages, so this is the one
 *                     similarity rule that cannot invent unity.
 * Every TOKEN-based rule (1, 2, 4) must additionally survive the weak-anchor
 * check: a token this account puts on nearly everything it owns proves nothing,
 * so it can never be the reason two queries were grouped. Priority decides WHICH
 * reason is recorded; the weak-anchor check decides whether ANY merge is allowed.
 * Unity that cannot be established leaves the two sides SEPARATE. Honest
 * fragmentation beats a false mega-topic.
 */

import { createHash } from "node:crypto";

import type { FunnelResearchEvidence, ResearchWinningAppearance } from "./funnel/research-evidence";
import { canonicalQueryKey, topicTokens } from "./relevance-gate";
import {
  coherenceOf, dominantPageType, pageTypeVotesOf, serpRefOf, winnerRefOf,
  type Freshness, type PageTypeVote, type SerpPageType, type SerpRef, type SerpRow, type WinnerRef,
} from "./serp-shape";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot } from "./snapshot";

// ── the contract ─────────────────────────────────────────────────────────────

type MergeReason = "seed_lineage" | "gsc_owned_page" | "prompt_fanout" | "shared_entity" | "serp_overlap";

type InvestigationKeyword = {
  query: string;
  /** The DataForSEO capability that produced this row; null when it did not come
   *  from a provider call (a Search Console query, or the account's own profile). */
  providerCapability: string | null;
  discoveredVia: string | null;
  seed: string | null;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  gscImpressions: number | null;
  /** Provider-reported volume series, ONLY when the provider returned one. */
  trend: number[] | null;
};

type TrackedPromptRef = {
  promptId: string;
  promptText: string;
  engines: string[];
  observationModes: string[];
  observedAt: string | null;
};

/** ONE provider-reported fan-out, carrying the parent prompt that produced it.
 *  The fan-out list on an observation has no lineage of its own, so the parent is
 *  CONSTRUCTED here from the enclosing observation and never guessed. */
type FanOutRef = {
  query: string;
  parentPromptId: string;
  parentPromptText: string;
  engine: string;
  observationMode: string;
  observedAt: string;
};

export type TopicInvestigation = {
  /** Stable while the same evidence is grouped; it moves only when what I am
   *  investigating moves. */
  key: string;
  label: string;
  demandBasis: "search" | "ai" | "mixed" | "none";
  /** How unity was established, in the order the rules fired. */
  groupedBy: MergeReason[];
  queries: string[];
  keywords: InvestigationKeyword[];
  demand: {
    monthlySearchVolume: number | null;
    queriesWithVolume: number;
    gscImpressions: number | null;
    /** Hardest priced query in the group; null when nothing was priced. */
    difficulty: number | null;
    /** The intent every priced query agrees on; null when they disagree. */
    intent: string | null;
    trackedPrompts: number;
    fanOuts: number;
    engines: string[];
  };
  trackedPrompts: TrackedPromptRef[];
  fanOuts: FanOutRef[];
  exactSerps: SerpRef[];
  serpFreshness: Freshness;
  distinctResultDomains: number;
  resultDomains: string[];
  pageType: SerpPageType;
  /** One vote per DISTINCT domain: a domain holding four of ten is one vote. */
  pageTypeVotes: PageTypeVote[];
  serpCoherence: "coherent" | "mixed" | "unknown";
  winners: WinnerRef[];
  distinctWinners: number;
  currentReadableWinners: number;
  missingEvidence: string[];
  /** True ONLY when the next slice has enough to COMPARE. Never permission to
   *  build, publish, or propose anything. */
  readyForComparison: boolean;
};

// ── documented thresholds ────────────────────────────────────────────────────

/** A comparison needs three distinct winners that were actually read. */
const MIN_WINNERS = 3;
/** Two exact looks are the same subject when they return the same pages: this
 *  many shared results, and that share of the smaller result set. */
const OVERLAP_MIN_URLS = 2;
const OVERLAP_MIN_SHARE = 0.25;
const MAX_LIST = 12;
const MAX_FANOUTS = 20;

// ── pure helpers ─────────────────────────────────────────────────────────────

type ObsRow = FunnelResearchEvidence["aiObservations"][number];

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const eq = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((t) => b.has(t));
const inter = <T,>(a: Set<T>, b: Set<T>): number => [...a].filter((t) => b.has(t)).length;

/** A provider-reported volume series, ONLY if the provider ever returns one; the
 *  keyword rows on file carry no series today, and an absent series stays null
 *  rather than becoming a made-up trend. */
const readTrend = (row: object): number[] | null => {
  const v = (row as Record<string, unknown>).monthlySearches;
  return Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number") ? (v as number[]) : null;
};

/** The provider capability behind a discovery route; null when no provider call
 *  produced the row (Search Console demand, or the account's own profile). */
const PROVIDER_CAPABILITY: Record<string, string> = {
  related: "labs_related_keywords", suggestion: "labs_keyword_suggestions", ideas: "labs_keyword_ideas",
  site: "labs_keywords_for_site", ranked: "labs_ranked_keywords",
};

const QUESTION_STEM = /^(what|which|who|where|when|why|how)\s+(are|is|was|do|does|did|can|should)\s+(the\s+)?/i;
/** Plain topic language: no question stem, no trailing punctuation, and no orphan
 *  "s" left behind where a provider stripped an apostrophe out of a possessive. */
const labelOf = (text: string): string =>
  norm(text).replace(QUESTION_STEM, "").replace(/[?.!]+$/, "").replace(/(\w) s\b/g, "$1").trim();

// ── anchors + grouping ───────────────────────────────────────────────────────

type Anchor = {
  serps: SerpRow[]; promptIds: Set<string>; obs: ObsRow[]; qkeys: Set<string>; strong: Set<string>;
  fanOutKeys: Set<string>; urls: Set<string>; seeds: Set<string>; ownedTopPage: string | null;
};

type Rule = { reason: MergeReason; test: (a: Anchor, b: Anchor) => boolean };

/** A token-based merge is only allowed on a token this account does NOT put on
 *  everything, so a nationality, a language, a city or the business name can
 *  never be the reason two queries became one investigation. */
const RULES: Rule[] = [
  { reason: "seed_lineage", test: (a, b) => inter(a.seeds, b.seeds) > 0 && inter(a.strong, b.strong) > 0 },
  { reason: "gsc_owned_page", test: (a, b) => !!a.ownedTopPage && a.ownedTopPage === b.ownedTopPage && inter(a.strong, b.strong) > 0 },
  { reason: "prompt_fanout", test: (a, b) => inter(a.fanOutKeys, b.qkeys) > 0 || inter(b.fanOutKeys, a.qkeys) > 0 || inter(a.fanOutKeys, b.fanOutKeys) > 0 },
  { reason: "shared_entity", test: (a, b) => a.strong.size > 0 && b.strong.size > 0 && (eq(a.strong, b.strong) || inter(a.qkeys, b.qkeys) > 0) },
  { reason: "serp_overlap", test: (a, b) => {
      const shared = inter(a.urls, b.urls);
      return shared >= OVERLAP_MIN_URLS && shared / Math.max(1, Math.min(a.urls.size, b.urls.size)) >= OVERLAP_MIN_SHARE;
    } },
];

/**
 * Project the canonical evidence into research packets. PURE and deterministic:
 * same snapshot in, same packets out, and the only clock is the snapshot's own
 * builtAt. An investigation exists only where something was actually
 * investigated: an exact result page I looked at, or a prompt I tracked. Demand
 * with neither stays demand and is never dressed up as research.
 */
export function buildTopicInvestigations(snapshot: EvidenceSnapshot): TopicInvestigation[] {
  const research = snapshot.research;
  const builtAt = Date.parse(snapshot.scope.builtAt);
  const weak = weakAnchorsOf(snapshot.ownedPages, research);
  const strongOf = (text: string | null | undefined): Set<string> => new Set(topicTokens(text).filter((t) => !weak.has(t)));

  // Which owned page Google serves most for an exact query (a grouping signal
  // only: the packet never carries the page, that mapping is the next slice).
  const topOwnedFor = new Map<string, { url: string; impressions: number }>();
  for (const p of snapshot.ownedPages) {
    for (const q of p.search?.topQueries ?? []) {
      const key = canonicalQueryKey(q.query);
      const best = topOwnedFor.get(key);
      if (!best || q.impressions > best.impressions) topOwnedFor.set(key, { url: p.url, impressions: q.impressions });
    }
  }

  // Lineage as the funnel recorded it at discovery, never re-derived here.
  const lineageByQuery = new Map<string, { seed: string | null; via: string | null; difficulty: number | null; intent: string | null; trend: number[] | null }>();
  for (const k of research.retainedKeywords) {
    lineageByQuery.set(canonicalQueryKey(k.query), { seed: k.seed ?? null, via: k.discoveredVia ?? null, difficulty: k.difficulty, intent: k.intent, trend: readTrend(k) });
  }

  // ── anchors: one per exact result page looked at, one per tracked prompt ──
  const anchors: Anchor[] = [];
  const blank = (): Omit<Anchor, "strong" | "qkeys"> => ({ serps: [], promptIds: new Set(), obs: [], fanOutKeys: new Set(), urls: new Set(), seeds: new Set(), ownedTopPage: null });
  for (const s of research.serpEvidence) {
    const key = canonicalQueryKey(s.query);
    anchors.push({
      ...blank(), serps: [s], qkeys: new Set([key]), strong: strongOf(s.query),
      urls: new Set(s.organic.map((o) => canonicalUrlKey(o.url)).filter(Boolean)),
      ownedTopPage: topOwnedFor.get(key)?.url ?? null,
    });
  }
  const byPrompt = new Map<string, ObsRow[]>();
  for (const o of research.aiObservations) {
    if (!o.promptId) continue;
    byPrompt.set(o.promptId, [...(byPrompt.get(o.promptId) ?? []), o]);
  }
  for (const [promptId, obs] of byPrompt) {
    const text = obs.map((o) => o.promptText).find((t) => !!t) ?? "";
    const selfKey = canonicalQueryKey(text);
    // A tracked prompt is NEVER its own fan-out: an engine echoing the prompt back
    // is not a second search, so it can neither add lineage nor group anything.
    const fanOutKeys = new Set(
      obs.flatMap((o) => o.fanOutQueries ?? []).map(canonicalQueryKey).filter((k) => !!k && k !== selfKey),
    );
    anchors.push({ ...blank(), promptIds: new Set([promptId]), obs, fanOutKeys, qkeys: new Set(selfKey ? [selfKey] : []), strong: strongOf(text) });
  }
  if (anchors.length === 0) return [];

  // ── keyword membership (lineage first, then the account's specific tokens) ──
  const members: InvestigationKeyword[][] = anchors.map(() => []);
  for (const kw of snapshot.keywordDemand) {
    const key = canonicalQueryKey(kw.query);
    const lin = lineageByQuery.get(key);
    const seedKey = lin?.seed ? canonicalQueryKey(lin.seed) : "";
    const strong = strongOf(kw.query);
    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i];
      const bySeed = !!seedKey && a.qkeys.has(seedKey);
      const byIdentity = a.qkeys.has(key);
      const byTokens = strong.size > 0 && a.strong.size > 0 && eq(strong, a.strong);
      if (!bySeed && !byIdentity && !byTokens) continue;
      if (seedKey) a.seeds.add(seedKey);
      members[i].push({
        query: kw.query, providerCapability: lin?.via ? PROVIDER_CAPABILITY[lin.via] ?? null : null,
        discoveredVia: lin?.via ?? null, seed: lin?.seed ?? null, searchVolume: kw.searchVolume,
        difficulty: lin?.difficulty ?? null, intent: lin?.intent ?? null, gscImpressions: kw.gscImpressions, trend: lin?.trend ?? null,
      });
    }
  }

  // ── merge anchors, rule by rule, in priority order ──
  const parent = anchors.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const reasons: MergeReason[][] = anchors.map(() => []);
  for (const rule of RULES) {
    for (let i = 0; i < anchors.length; i += 1) {
      for (let j = i + 1; j < anchors.length; j += 1) {
        if (find(i) === find(j) || !rule.test(anchors[i], anchors[j])) continue;
        parent[find(i)] = find(j);
        reasons[i].push(rule.reason);
        reasons[j].push(rule.reason);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < anchors.length; i += 1) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);

  const out = [...groups.values()].map((idx) => assemble(idx, anchors, members, reasons, research, snapshot, builtAt, strongOf));
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

// ── one packet ───────────────────────────────────────────────────────────────

function assemble(
  idx: number[],
  anchors: Anchor[],
  members: InvestigationKeyword[][],
  reasons: MergeReason[][],
  research: FunnelResearchEvidence,
  snapshot: EvidenceSnapshot,
  builtAt: number,
  strongOf: (text: string | null | undefined) => Set<string>,
): TopicInvestigation {
  const serps = idx.flatMap((i) => anchors[i].serps);
  const obs = idx.flatMap((i) => anchors[i].obs);
  const promptIds = new Set(idx.flatMap((i) => [...anchors[i].promptIds]));
  const serpKeys = new Set(serps.map((s) => canonicalQueryKey(s.query)));

  const keywords: InvestigationKeyword[] = [];
  const seenQuery = new Set<string>();
  for (const k of idx.flatMap((i) => members[i])) {
    const key = canonicalQueryKey(k.query);
    if (seenQuery.has(key)) continue;
    seenQuery.add(key);
    keywords.push(k);
  }
  keywords.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.query.localeCompare(b.query));

  // ── fan-outs keep the exact parent prompt that produced them ──
  const fanOuts: FanOutRef[] = [];
  const seenFan = new Set<string>();
  for (const o of obs) {
    const selfKey = canonicalQueryKey(o.promptText);
    for (const q of o.fanOutQueries ?? []) {
      const key = canonicalQueryKey(q);
      if (!key || key === selfKey) continue;
      const dedupe = `${o.promptId}|${o.engine}|${key}`;
      if (seenFan.has(dedupe)) continue;
      seenFan.add(dedupe);
      fanOuts.push({ query: q, parentPromptId: o.promptId, parentPromptText: o.promptText, engine: o.engine, observationMode: o.observationMode, observedAt: o.observedAt });
    }
  }
  fanOuts.sort((a, b) => a.query.localeCompare(b.query) || a.engine.localeCompare(b.engine));

  const trackedPrompts: TrackedPromptRef[] = [...new Set(obs.map((o) => o.promptId))].map((id) => {
    const rows = obs.filter((o) => o.promptId === id);
    return {
      promptId: id,
      promptText: rows.map((r) => r.promptText).find((t) => !!t) ?? "",
      engines: [...new Set(rows.map((r) => r.engine))].sort(),
      observationModes: [...new Set(rows.map((r) => r.observationMode))].sort(),
      observedAt: rows.map((r) => r.observedAt).filter(Boolean).sort().at(-1) ?? null,
    };
  }).sort((a, b) => a.promptText.localeCompare(b.promptText));

  // ── the exact result pages I looked at, the rows on them, and when I looked ──
  const exactSerps: SerpRef[] = serps
    .map((s) => serpRefOf(s, research.winningPages, builtAt))
    .sort((a, b) => a.query.localeCompare(b.query));
  // THE WORST LOOK IN THE GROUP, never the best. One fresh look beside two from January
  // used to read "current" while two thirds of the page-type evidence was months old.
  const serpFreshness: Freshness =
    exactSerps.length === 0 ? "missing"
      : exactSerps.some((s) => s.freshness === "stale") ? "stale"
        : exactSerps.some((s) => s.freshness === "undated") ? "undated" : "current";

  const resultDomains = [...new Set(exactSerps.flatMap((s) => s.organicRows.map((o) => o.domain)))].sort();

  // ── winners: only pages whose OWN provenance points at this investigation, and
  // that provenance is KEPT so a reader can tell a ranking from a citation ──
  const isMine = (a: ResearchWinningAppearance): boolean =>
    (!!a.query && serpKeys.has(canonicalQueryKey(a.query))) || (!!a.promptId && promptIds.has(a.promptId));
  const winners: WinnerRef[] = research.winningPages
    .map((w) => ({ page: w, mine: w.appearances.filter(isMine) }))
    .filter((x) => x.mine.length > 0)
    .map((x) => winnerRefOf(x.page, x.mine, builtAt))
    .sort((a, b) => a.url.localeCompare(b.url));
  // Counted by DISTINCT SITE. Three pages from one publisher are one publisher's view,
  // and the whole file's conservatism rests on agreement ACROSS sources.
  const currentReadableWinners = new Set(winners.filter((w) => w.extractState === "current").map((w) => w.domain)).size;

  // ── label: what the evidence itself calls this, never the first prompt ──
  const label =
    keywords.find((k) => k.searchVolume != null)?.query ??
    [...exactSerps].sort((a, b) => b.organicResults - a.organicResults || a.query.length - b.query.length || a.query.localeCompare(b.query))[0]?.query ??
    mostRepeated(fanOuts.map((f) => f.query)) ??
    [...trackedPrompts].sort((a, b) => a.promptText.length - b.promptText.length || a.promptText.localeCompare(b.promptText))[0]?.promptText ??
    "";
  const strong = strongOf(label);

  const votes = pageTypeVotesOf(serps);
  const serpCoherence = coherenceOf(serps, strong);
  // A page type describes the shape that wins for ONE subject, and it is only
  // supported by a CURRENT exact look. Without either, the honest answer is that
  // I do not know yet, and the votes below stay visible as what I did see.
  const pageType: SerpPageType =
    serpFreshness !== "current" ? "unknown" : serpCoherence !== "coherent" ? "mixed" : dominantPageType(votes);

  const volumes = keywords.map((k) => k.searchVolume).filter((v): v is number => v != null);
  const impressions = keywords.map((k) => k.gscImpressions).filter((v): v is number => v != null);
  const difficulties = keywords.map((k) => k.difficulty).filter((v): v is number => v != null);
  const intents = [...new Set(keywords.map((k) => k.intent).filter((v): v is string => !!v))];
  const searchDemand = volumes.length > 0 || impressions.length > 0;
  const aiDemand = trackedPrompts.length > 0;
  // "none" is a real answer. Falling through to "search" made a packet say the demand is
  // Google search and, one field later, that it holds no Google demand data at all.
  const demandBasis: TopicInvestigation["demandBasis"] =
    searchDemand ? (aiDemand ? "mixed" : "search") : aiDemand ? "ai" : "none";

  // ── what is missing, said plainly and only when it is actually missing ──
  const missingEvidence: string[] = [];
  if (exactSerps.length === 0) missingEvidence.push("I have not looked at Google's results for this yet.");
  else if (serpFreshness === "undated") missingEvidence.push("I have these results but not the date I read them, so I am not treating them as current.");
  else if (serpFreshness === "stale") missingEvidence.push("My last look at these results is over a week old.");
  if (!searchDemand) missingEvidence.push("I have no monthly search volume for this yet, so I cannot say what Google demand looks like.");
  if (!aiDemand) missingEvidence.push("No AI engine I track has been asked this yet, so I cannot say it recurs in AI answers.");
  if (serpCoherence === "mixed") missingEvidence.push("These results answer more than one meaning of the phrase, so I am not calling it one topic.");
  if (serpCoherence === "unknown") missingEvidence.push("I have too few results here to tell whether they agree on one subject.");
  if (winners.length < MIN_WINNERS) missingEvidence.push(`I have found ${winners.length} of the ${MIN_WINNERS} winning pages I need before I can compare.`);
  else if (currentReadableWinners < MIN_WINNERS) missingEvidence.push(`I have read ${currentReadableWinners} of these ${winners.length} winning pages recently enough to trust; I need ${MIN_WINNERS}.`);
  const lineageIntact = keywords.every((k) => !!k.discoveredVia || k.gscImpressions != null) && fanOuts.every((f) => !!f.parentPromptText);
  if (!lineageIntact) missingEvidence.push("I cannot trace every keyword here back to how I found it.");
  if (pageType === "mixed") missingEvidence.push("The pages that win here do not agree on one shape.");

  const readyForComparison =
    serpCoherence === "coherent" &&
    (searchDemand || aiDemand) &&
    serpFreshness === "current" &&
    pageType !== "mixed" && pageType !== "unknown" &&
    winners.length >= MIN_WINNERS &&
    currentReadableWinners >= MIN_WINNERS &&
    lineageIntact;

  // Representative queries: what was searched, in evidence order (priced demand,
  // then the exact looks, then the engines' own fan-outs when nothing else exists).
  const queries = [...new Set([...keywords.map((k) => k.query), ...exactSerps.map((s) => s.query), ...fanOuts.map((f) => f.query)])];
  const key = `inv_${createHash("sha256").update([...new Set([...serpKeys, ...promptIds])].sort().join("|")).digest("hex").slice(0, 12)}`;
  return {
    key,
    label: labelOf(label),
    demandBasis,
    groupedBy: [...new Set(idx.flatMap((i) => reasons[i]))],
    queries: queries.slice(0, MAX_LIST),
    keywords: keywords.slice(0, MAX_LIST),
    demand: {
      // THE LARGEST SINGLE PRICED QUERY, never a sum. The provider reports one bucketed
      // figure for close variants, so adding "iran leader", "iran leadership" and "iran
      // supreme leader" at 246,000 each invented half a million searches that do not
      // exist. Demand that overlaps is not demand that adds.
      monthlySearchVolume: volumes.length > 0 ? Math.max(...volumes) : null,
      queriesWithVolume: volumes.length,
      gscImpressions: impressions.length > 0 ? impressions.reduce((n, v) => n + v, 0) : null,
      difficulty: difficulties.length > 0 ? Math.max(...difficulties) : null,
      intent: intents.length === 1 ? intents[0] : null,
      trackedPrompts: trackedPrompts.length,
      fanOuts: fanOuts.length,
      engines: [...new Set(obs.map((o) => o.engine))].sort(),
    },
    trackedPrompts: trackedPrompts.slice(0, MAX_LIST),
    fanOuts: fanOuts.slice(0, MAX_FANOUTS),
    exactSerps,
    serpFreshness,
    distinctResultDomains: resultDomains.length,
    resultDomains: resultDomains.slice(0, MAX_LIST),
    pageType,
    pageTypeVotes: votes,
    serpCoherence,
    winners: winners.slice(0, MAX_LIST),
    distinctWinners: new Set(winners.map((w) => w.domain)).size,
    currentReadableWinners,
    missingEvidence,
    readyForComparison,
  };
}

function mostRepeated(values: string[]): string | undefined {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]?.[0];
}
