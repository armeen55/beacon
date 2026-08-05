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
 * fragmentation beats a false mega-topic. */

import { caseRows, foldCases, type CaseFold } from "./case-identity";
import type { FunnelResearchEvidence, KeywordOrigin, ResearchCase, ResearchWinningAppearance } from "./funnel/research-evidence";
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
  discoveredVia: string | null;
  seed: string | null;
  searchVolume: number | null;
  difficulty: number | null;
  intent: string | null;
  gscImpressions: number | null;
  /** The journey this keyword arrived by, as the funnel recorded it at discovery. */
  origins: KeywordOrigin[] | null;
  moreOrigins: number | null;
};

type TrackedPromptRef = {
  promptId: string;
  promptText: string;
  engines: string[];
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
  /** null = the answer this came out of never recorded when it landed; a date is never invented for it. */
  observedAt: string | null;
};

export type TopicInvestigation = {
  /** THE CASE, not the packet: one durable identity per subject, resolved by `foldCases` below. */
  key: string;
  /** EVERY id this case still answers to, for as long as it is retained: an answer bought under one, or a
   *  live proposal filed under one, is STILL this case's, on this build and on every build after it. */
  aliasKeys: string[];
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
  /** THE ONE purchase most likely to change a decision here, or null when nothing left to buy would.
   *  Derived from the first missing item that is actually acquirable today, never from a wish list. */
  nextAcquisition: { kind: "read_winner" | "buy_serp" | "buy_volume"; subject: string; why: string } | null;
  /** True when things are still missing and NONE of them can be bought now: unacquirable, already
   *  tried on this basis, or held until a date. Further research here has stopped paying. */
  diminishing: boolean;
};

// ── documented thresholds ────────────────────────────────────────────────────

/** Three distinct publishers, wherever agreement is claimed (see missingEvidence below). */
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

/** What the grouping pass established, shared by the packet build and the case reconcile so neither
 *  can group the same evidence differently from the other. */
type Grouped = {
  anchors: Anchor[]; members: InvestigationKeyword[][]; reasons: MergeReason[][]; groups: number[][];
  folded: CaseFold[]; builtAt: number; strongOf: (text: string | null | undefined) => Set<string>;
};

/**
 * Project the canonical evidence into research packets. PURE and deterministic:
 * same snapshot in, same packets out, and the only clock is the snapshot's own
 * builtAt. An investigation exists only where something was actually
 * investigated: an exact result page I looked at, or a prompt I tracked. Demand
 * with neither stays demand and is never dressed up as research. */
export function buildTopicInvestigations(snapshot: EvidenceSnapshot): TopicInvestigation[] {
  const g = groupEvidence(snapshot);
  // ONE PACKET PER CASE, not per group: where the registry outranked the rules and united two groups, the
  // anchors of both are assembled into the single investigation that one case actually is.
  return g.folded.map((f) => assemble(f.from.flatMap((i) => g.groups[i]!), g, snapshot, f.id, f.aliases))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/** Runtime's ONE reconcile: the case rows this evidence proves, folded onto the rows on file (case-identity
 *  carries the whole rule), so an id minted today is the same id tomorrow and every alias it answers to is
 *  written back flat beside it. Pure; Runtime persists it through the funnel save path, and Decision never
 *  writes research state. */
export function reconcileResearchCases(snapshot: EvidenceSnapshot): ResearchCase[] {
  return caseRows(groupEvidence(snapshot).folded, snapshot.research.cases ?? []);
}

function groupEvidence(snapshot: EvidenceSnapshot): Grouped {
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
  const lineageByQuery = new Map<string, { seed: string | null; via: string | null; difficulty: number | null; intent: string | null; origins: KeywordOrigin[] | null; moreOrigins: number | null }>();
  for (const k of research.retainedKeywords) {
    lineageByQuery.set(canonicalQueryKey(k.query), { seed: k.seed ?? null, via: k.discoveredVia ?? null, difficulty: k.difficulty, intent: k.intent, origins: k.origins ?? null, moreOrigins: k.moreOrigins ?? null });
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
        query: kw.query, discoveredVia: lin?.via ?? null, seed: lin?.seed ?? null, searchVolume: kw.searchVolume,
        difficulty: lin?.difficulty ?? null, intent: lin?.intent ?? null, gscImpressions: kw.gscImpressions,
        origins: lin?.origins ?? null, moreOrigins: lin?.moreOrigins ?? null,
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

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < anchors.length; i += 1) byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]);
  const groups = [...byRoot.values()];
  // THE ANCHORS OF ONE CASE: every exact search, tracked prompt and priced keyword it is about, which
  // is what the identity on file is matched against. Membership may grow all it likes; the id may not.
  const keys = groups.map((idx) => [...new Set(idx.flatMap((i) =>
    [...anchors[i].qkeys, ...members[i].map((k) => canonicalQueryKey(k.query))]))].filter(Boolean).sort());
  return { anchors, members, reasons, groups, folded: foldCases(keys, research.cases ?? []), builtAt, strongOf };
}

// ── one packet ───────────────────────────────────────────────────────────────

function assemble(idx: number[], g: Grouped, snapshot: EvidenceSnapshot, key: string, aliasKeys: string[]): TopicInvestigation {
  const { anchors, members, reasons, builtAt, strongOf } = g;
  const research = snapshot.research;
  const serps = idx.flatMap((i) => anchors[i].serps);
  const obs = idx.flatMap((i) => anchors[i].obs);
  const promptIds = new Set(idx.flatMap((i) => [...anchors[i].promptIds]));
  const serpKeys = new Set(serps.map((s) => canonicalQueryKey(s.query)));

  const byQuery = new Map<string, InvestigationKeyword>();
  for (const k of idx.flatMap((i) => members[i])) {
    const q = canonicalQueryKey(k.query);
    if (!byQuery.has(q)) byQuery.set(q, k);
  }
  const keywords = [...byQuery.values()].sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.query.localeCompare(b.query));

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
    // REAL ORGANIC ORDER, never the alphabet: sorting by url handed the comparison a rank 8 page
    // while the rank 1 page from the same publisher sat behind it. An engine citation is not a
    // ranking, so a cited-only page sorts after every ranked one and can never pass for one.
    .sort((a, b) => organicRank(a) - organicRank(b) || a.url.localeCompare(b.url));
  // Counted by DISTINCT SITE. Three pages from one publisher are one publisher's view,
  // and the whole file's conservatism rests on agreement ACROSS sources.
  const currentReadableWinners = new Set(winners.filter((w) => w.extractState === "current").map((w) => w.domain)).size;
  const rankedPublishers = new Set(winners.filter((w) => organicRank(w) < Number.MAX_SAFE_INTEGER).map((w) => w.domain)).size;

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
  // THE COMPARISON IS BOUGHT ON ADDRESSES; A PAGE IS WRITTEN FROM WORDS. Saying I needed readable
  // bodies "before I can compare" contradicted the address-based comparison that actually ships.
  if (rankedPublishers < MIN_WINNERS) missingEvidence.push(`I can name ${rankedPublishers} of the ${MIN_WINNERS} sites that win here, so I cannot compare them against your own pages yet.`);
  else if (currentReadableWinners < MIN_WINNERS) missingEvidence.push(`I have read ${currentReadableWinners} of the ${MIN_WINNERS} winning pages I would need before writing a page of your own.`);
  const lineageIntact = keywords.every((k) => !!k.discoveredVia || k.gscImpressions != null || (k.origins?.length ?? 0) > 0) && fanOuts.every((f) => !!f.parentPromptText);
  if (!lineageIntact) missingEvidence.push("I cannot trace every keyword here back to how I found it.");
  if (pageType === "mixed") missingEvidence.push("The pages that win here do not agree on one shape.");

  // ── the ONE next purchase, and when buying more stops paying ──
  // A winner I have not read is the cheapest thing that moves this on, so it comes first; then the
  // exact results page I never bought; then the keyword ask. Anything held until a promised date is
  // NOT a next step, and saying so with the date beats offering a purchase I refuse to make.
  const unread = winners.filter((w) => w.extractState !== "current");
  const heldUntil = unread.map((w) => w.readOutcome?.retryAfter).filter((r): r is string => !!r && Date.parse(r) > builtAt).sort()[0] ?? null;
  const readable = unread.find((w) => !w.readOutcome || Date.parse(w.readOutcome.retryAfter) <= builtAt) ?? null;
  if (heldUntil && !readable) missingEvidence.push(`I am holding off on the winning pages here until ${heldUntil.slice(0, 10)}, which is the date I promised for them.`);
  const nextAcquisition: TopicInvestigation["nextAcquisition"] =
    readable && currentReadableWinners < MIN_WINNERS
      ? { kind: "read_winner", subject: readable.url, why: `I have read ${currentReadableWinners} of the ${MIN_WINNERS} winning pages here, so reading this one is what moves this forward.` }
      : exactSerps.length === 0
        ? { kind: "buy_serp", subject: labelOf(label), why: "I have never looked at Google's results for this, so buying that one results page is what changes the answer." }
        : !searchDemand
          ? { kind: "buy_volume", subject: keywords[0]?.query ?? labelOf(label), why: "I hold no monthly search volume here, so pricing this phrase is what tells me whether it is worth your time." }
          : null;
  // Nothing left to buy, but things still missing, means further research here has stopped paying.
  const diminishing = nextAcquisition === null && missingEvidence.length > 0;

  // Representative queries: what was searched, in evidence order (priced demand,
  // then the exact looks, then the engines' own fan-outs when nothing else exists).
  const queries = [...new Set([...keywords.map((k) => k.query), ...exactSerps.map((s) => s.query), ...fanOuts.map((f) => f.query)])];
  return {
    key,
    aliasKeys,
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
    nextAcquisition,
    diminishing,
  };
}

/** The best organic position this page holds for THIS investigation; a page only ever cited by an
 *  engine has none, so it sorts last and is never counted as one of the ranked winners. */
const organicRank = (w: WinnerRef): number =>
  Math.min(...w.appearances.filter((a) => a.kind === "serp_organic" && (a.rank ?? 0) > 0).map((a) => a.rank!), Number.MAX_SAFE_INTEGER);

function mostRepeated(values: string[]): string | undefined {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]?.[0];
}
