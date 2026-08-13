import "server-only";

/**
 * decision/coverage-pass: ONE ranked walk over every subject this account has a stake in, and the ONLY reading
 * of it any step gets. coverage-adjudication answers "does this account already have the right page?" for ONE
 * topic; this file decides WHICH topics get asked, in what order, with which evidence, and hands back both
 * halves of the answer: the highest-ranked topic that reached a real verdict, and what the rest is stuck on.
 *
 * ONE INTERPRETATION, TWO CONSUMERS. Runtime buys evidence off this pass and proposal production acts off the
 * same pass, so a run can never pay for one topic's comparison while a different topic is judged. A comparison
 * is matched to the topic that OWNS it and to the exact ask that bought it, under the account's current basis.
 *
 * $0 AND $0 OF THE WEB: no model runs, no provider is paid and NO WEBSITE IS FETCHED. The owed page is NAMED as plain data, and its stored body, or the stored reason it is unread, is READ. Nothing else. */

import type { BusinessProfile } from "@/domains/account";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { askIdentity, normalizePageIntersection, type PageCoverageReading, type PageIntersectionAsk } from "@/domains/evidence/page-intersection";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation";
import { ownedCandidatesFor, topicOutOfScope, type OwnedCandidate } from "./owned-coverage";
import { resolveCurrentBasis } from "./load-proposals";
import { adjudicateCoverage, intersectionComparison, readComparison,
  type CoverageDecision, type CoverageVerdict, type IntersectionEvidence, type MissingRequirement } from "./coverage-adjudication";
import type { OwnedPageReadOutcome } from "@/domains/evidence/funnel/research-evidence";
import { isCurrent } from "@/domains/evidence/freshness";
import { answerIntelOf } from "@/domains/evidence/answer-intel";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

// ── the searches no page of this account is FOR ───────────────────────────────
// The $0 producers can already prove it: pages of this account share a search's words and EVERY one of them is
// for something else, so the section they would carry belongs nowhere. That verdict was logged and consumed by
// nothing. It is banked here instead, and once it has earned it the search enters the SAME ranked walk every
// other subject goes through, so the ladder decides whether a page should exist. No second pipeline.

/** ONE banked need: the search, how often it came up, over how many passes, and the pages that were read and
 *  refused as the wrong kind of page or off the subject. Every field is counted, never inferred. */
type CoverageNeed = { query: string; occurrences: number; passes: number; refusedPages: string[]; lastSeen: string };

const COVERAGE_NEEDS = "coverage-needs";
/** How many needs one account banks. The rest fall off oldest first: a queue nobody bounds is a leak. */
const MAX_NEEDS = 200;
/** Passes a search has to survive, or answers that have to credit somebody else, before it earns the walk. */
const MIN_PASSES = 2, MIN_CITING_ANSWERS = 3;

/**
 * PURE: has this banked search earned a page of its own being CONSIDERED? Never a page: it earns entry to the
 * ranked walk, where the ordinary ladder decides. Recurrence is the claim (the same search coming back across
 * passes, or several stored answers handing it to somebody else), and a refusal is the proof that no page of
 * this account fits: the producers record one only when pages DID share the words and every one was refused.
 */
export function earnsOwnPage(need: Pick<CoverageNeed, "passes" | "refusedPages">, citingAnswers: number): boolean {
  return (need.passes >= MIN_PASSES || citingAnswers >= MIN_CITING_ANSWERS) && need.refusedPages.length > 0;
}

/** BANK WHAT THIS PASS SAW. One pass counts once per search however many producers raised it, so "passes" is
 *  genuinely a number of passes. Fail-soft: a store that will not read or write costs one pass of memory. */
export async function recordCoverageNeeds(
  tenantId: string, seen: readonly { query: string; refusedPages?: readonly string[] }[], now: Date = new Date(),
): Promise<void> {
  const fresh = new Map<string, { query: string; refused: Set<string> }>();
  for (const s of seen) {
    const key = canonicalQueryKey(s.query);
    if (!key) continue;
    const cur = fresh.get(key) ?? { query: s.query.trim(), refused: new Set<string>() };
    for (const r of s.refusedPages ?? []) cur.refused.add(r);
    fresh.set(key, cur);
  }
  if (fresh.size === 0) return;
  try {
    const held = await readStore<CoverageNeed>(COVERAGE_NEEDS, [], { tenantId });
    const by = new Map(held.map((n) => [canonicalQueryKey(n.query), n]));
    for (const [key, s] of fresh) {
      const prior = by.get(key);
      by.set(key, { query: prior?.query ?? s.query, occurrences: (prior?.occurrences ?? 0) + 1,
        passes: (prior?.passes ?? 0) + 1, lastSeen: now.toISOString(),
        refusedPages: [...new Set([...(prior?.refusedPages ?? []), ...s.refused])].slice(0, 8) });
    }
    await writeStore(COVERAGE_NEEDS, [...by.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, MAX_NEEDS), { tenantId });
  } catch (e) {
    log.warn("[coverage-pass] the searches with no page of their own were not banked this pass", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** The banked searches that have earned the walk, in this account's own words. Fail-soft to nothing. */
async function promotedNeeds(tenantId: string, snapshot: EvidenceSnapshot): Promise<string[]> {
  try {
    const held = await readStore<CoverageNeed>(COVERAGE_NEEDS, [], { tenantId });
    if (held.length === 0) return [];
    const site = (snapshot.scope?.site ?? "").replace(/^www\./, "").toLowerCase();
    // HOW MANY STORED ANSWERS TO THIS QUESTION HANDED IT TO SOMEBODY ELSE. Counted off answers already on file.
    const citing = new Map<string, number>();
    for (const o of snapshot.research.aiObservations) {
      const cites = o.citations ?? [];
      if (cites.length === 0 || (site && cites.some((c) => c.domain.replace(/^www\./, "").toLowerCase().endsWith(site)))) continue;
      const key = canonicalQueryKey(o.promptText);
      if (key) citing.set(key, (citing.get(key) ?? 0) + 1);
    }
    // A need nobody has raised in three weeks is not promoted again and again: the site may have grown the
    // page, and every promotion buys a results-page read. Recency is a window, not a deletion.
    const RECENT_MS = 21 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - RECENT_MS;
    return held.filter((n) => Date.parse(n.lastSeen ?? "") >= cutoff
      && earnsOwnPage(n, citing.get(canonicalQueryKey(n.query)) ?? 0)).map((n) => n.query);
  } catch { return []; }
}

/** A subject whose winning pages I have ALREADY READ is not research any more: it is a decision, so it is never
 *  queued behind work that has barely started. Two read pages is the bar the page brief itself is written at. */
const settled = (i: TopicInvestigation): number => (i.currentReadableWinners >= 2 ? 1 : 0);

/** THE order every step reads. A subject one purchase from a verdict comes first, and then WHAT A PAGE OF
 *  YOURS STANDS TO WIN BACK: a search one of your own pages is already losing clicks on outranks a phrase with
 *  300,000 searches you own no page for, whatever the volume says, because volume nobody of yours competes for
 *  is somebody else's business. Then fewest missing pieces, then demand, then the stable key, so the same
 *  evidence always advances the SAME topic whether it is being bought for, compared or judged. Research, never
 *  work. */
export function rankInvestigations(investigations: readonly TopicInvestigation[],
  worth: (inv: TopicInvestigation) => number = () => 0): TopicInvestigation[] {
  return [...investigations].sort((a, b) => settled(b) - settled(a) || worth(b) - worth(a)
    || a.missingEvidence.length - b.missingEvidence.length
    || (b.demand.monthlySearchVolume ?? 0) - (a.demand.monthlySearchVolume ?? 0)
    || (b.demand.gscImpressions ?? 0) - (a.demand.gscImpressions ?? 0) || a.key.localeCompare(b.key));
}

/** What ONE exact query row of the account's own is losing against the click curve, in clicks. 0 = nothing.
 *  `at` is THE SAME curve the diagnosis measured with; it defaults to the industry table only for a caller
 *  running outside a pass, which holds no fitted curve to hand over. */
function shortfall(q: { impressions: number; clicks: number; position: number | null }, at: (position: number) => number = defaultExpectedCtrAt): number {
  const pos = q.position;
  if (!(q.impressions > 0) || pos == null || !(pos > 0)) return 0;
  return Math.max(0, (at(pos) - Math.min(1, q.clicks / q.impressions)) * q.impressions);
}

/** WHAT PAGES OF THIS ACCOUNT'S OWN STAND TO WIN BACK on one topic's searches, off the exact query rows
 *  already held. Nothing is bought and nothing is invented to compute it. */
function ownedOpportunity(snapshot: EvidenceSnapshot, inv: TopicInvestigation, at?: (position: number) => number): number {
  const keys = new Set(inv.queries.map((q) => canonicalQueryKey(q)).filter(Boolean));
  let clicks = 0;
  for (const p of snapshot.ownedPages) for (const q of p.search?.topQueries ?? []) {
    if (keys.has(canonicalQueryKey(q.query))) clicks += shortfall(q, at);
  }
  return Math.round(clicks);
}

/** How many pages of the account's own may open a subject of their own in one pass. */
const MAX_OWNED_TOPICS = 25;
/** How many promoted searches with no page of their own may open a subject in one pass. */
const MAX_PROMOTED_TOPICS = 10;
/** The empty packet a page-anchored subject starts from: everything I do not hold, held honestly at nothing. */
const BARE = { aliasKeys: [], demandBasis: "search" as const, groupedBy: [], keywords: [], trackedPrompts: [], fanOuts: [],
  answerIntel: answerIntelOf([]),
  exactSerps: [], serpFreshness: "missing" as const, distinctResultDomains: 0, resultDomains: [], pageType: "unknown" as const,
  pageTypeVotes: [], serpCoherence: "unknown" as const, winners: [], distinctWinners: 0, currentReadableWinners: 0, diminishing: false,
  demand: { monthlySearchVolume: null, queriesWithVolume: 0, gscImpressions: null, difficulty: null, intent: null, trackedPrompts: 0, fanOuts: 0, engines: [] } };

/** EVERY SUBJECT THIS PASS MAY WALK: what the evidence proves I investigated, PLUS one subject per page of the
 *  account's own that is measurably losing clicks on a search no case covers yet. A page of yours falling IS a
 *  subject, whether or not I have ever bought a results page for it, and without this it could never enter a
 *  plan at all: that is how 22 declining pages sat in Watching for ever while unowned volume held every slot.
 *  Nothing is invented. The query, the views and the position are the account's own rows, and every piece I do
 *  not hold is named as missing rather than filled in. */
function topicsFor(snapshot: EvidenceSnapshot, promoted: readonly string[] = []): TopicInvestigation[] {
  const built = buildTopicInvestigations(snapshot);
  const covered = new Set(built.flatMap((i) => i.queries.map((q) => canonicalQueryKey(q))));
  const owned = snapshot.ownedPages
    .map((p) => [...(p.search?.topQueries ?? [])].sort((a, b) => shortfall(b) - shortfall(a))[0])
    .filter((q) => !!q && shortfall(q) > 0).sort((a, b) => shortfall(b!) - shortfall(a!));
  const extra: TopicInvestigation[] = [];
  for (const q of owned) {
    const key = canonicalQueryKey(q!.query);
    if (!key || covered.has(key) || extra.length >= MAX_OWNED_TOPICS) continue;
    covered.add(key);
    extra.push({ ...BARE, key: `owned::${key}`, label: q!.query, queries: [q!.query],
      demand: { ...BARE.demand, gscImpressions: q!.impressions },
      missingEvidence: ["I have not looked at Google's results for this yet."],
      nextAcquisition: { kind: "buy_serp", subject: q!.query,
        why: "A page of yours already comes up for this and I have never looked at its results, so buying that one results page is what changes the answer." } });
  }
  // AND THE SEARCHES NO PAGE OF THIS ACCOUNT IS FOR, banked by the producers and promoted by the rule above.
  // They enter as ordinary subjects with nothing filled in: the ladder buys the results page and decides.
  for (const q of promoted) {
    const key = canonicalQueryKey(q);
    if (!key || covered.has(key) || extra.length >= MAX_OWNED_TOPICS + MAX_PROMOTED_TOPICS) continue;
    covered.add(key);
    extra.push({ ...BARE, key: `needs::${key}`, label: q, queries: [q],
      missingEvidence: ["I have not looked at Google's results for this yet."],
      nextAcquisition: { kind: "buy_serp", subject: q,
        why: "Pages of yours share the words in this search and every one of them is for something else, so buying that one results page is what says whether a page of your own is owed." } });
  }
  return [...built, ...extra];
}

/** The whole pass may read at most this many of my own pages' STORED words, once each. */
const MAX_BODY_READS = 3;
/** ONE topic, the ONE thing it is stuck on, and either the exact purchase that closes it (a search to look
 *  up, the comparison, or the page of my own Evidence must go and read) or the date I may try again. A case
 *  that can only WAIT is still listed, because a requirement nobody can see is a requirement nobody fixes.
 *  `ownedUrl` is a NAME, not an action: this pass fetches nothing, and the run's page phase does the read. */
export type ResearchNeed = { topicKey: string; requirement: MissingRequirement; query: string | null; comparison: PageIntersectionAsk | null; ownedUrl: string | null; retryAfter: string | null };

/** A topic whose evidence reached a FINAL answer, with everything that answer rests on, so
 *  the step that acts on it never has to re-derive the candidates or re-read the comparison. */
export type DecidedTopic = {
  investigation: TopicInvestigation;
  candidates: OwnedCandidate[];
  decision: CoverageDecision;
  /** The page by page comparison behind the verdict, when one settled it. */
  reading: PageCoverageReading | null;
};

/** THE one interpretation of this account's coverage: the highest-ranked topic that is actually decided,
 *  what the rest of the research is stuck on, and the EARLIEST date any of it may legally be read again.
 *  That last one is computed over the whole ranked walk, whatever the research budget was, because a
 *  surface that says "checking" while the next legal read is tomorrow is lying about a wait. */
export type CoverageRead = { decided: DecidedTopic | null; needs: ResearchNeed[]; waitingUntil: string | null };

type ReadCoverageOptions = {
  /** How much research the caller may queue. 0 queues NOTHING, searches and comparison
   *  alike, and asks only "what is decided". The clamp used to guard the search branch
   *  only, so a caller that asked for no research still got handed a paid comparison. */
  maxQueries?: number;
  /** The account's CURRENT basis. The stored rows are projected from funnel state already
   *  scoped to it, so an older bar's answers are not in this snapshot at all; a basis I
   *  cannot read is refused outright rather than assumed current. */
  basis?: string | null;
  profile?: BusinessProfile | null;
  /** A TEST SEAM ONLY: production reads the stored comparison out of the snapshot. */
  intersection?: IntersectionEvidence;
  /** A pattern already computed for ONE topic (the drafting pass supplies it; this pass never calls a
   *  model). Attached only when the topic matches, so no case can wear another case's pattern. */
  patternFor?: { topicKey: string; pattern: import("./winning-pattern").WinningPattern } | null;
  /** THE ACCOUNT'S OWN CLICK CURVE, the same one the diagnosis measured with. Absent = the industry table. */
  curve?: { expectedCtrAt: (position: number) => number };
  /** What is wrong with how this account's pages are SERVED, already read off the inventory and the capture.
   *  A page nothing can reach is never named as the page to improve. */
  technical?: readonly import("./technical-findings").TechnicalFinding[];
  now?: Date;
};

/** The CURRENT stored comparison for ONE topic, the honest reason Evidence could not get one, or null. A
 *  comparison bought for a DIFFERENT topic or about a DIFFERENT set of pages answers a question I am no longer
 *  asking, so it is REFUSED rather than reused: `ask` is the exact comparison this pass would buy today. The
 *  stored rows are scoped to the account's current basis, and a basis I cannot read is refused outright. */
function storedComparisonFor(snapshot: EvidenceSnapshot, inv: TopicInvestigation, basis: string | null, ask: PageIntersectionAsk): IntersectionEvidence | null {
  if (!basis) return null;
  // BOTH the complete normalized ask identity AND the row's own page set. The key folds in the mode and the
  // limit that the page list cannot express; the page list catches a row whose stored key no longer describes
  // what it holds. Either check alone lets an answer to a different question be read as the answer to this one.
  // AN ALIAS IS STILL THIS CASE: reading only `key` made a comparison bought under an absorbed id invisible.
  const want = askIdentity(ask);
  const norm = normalizePageIntersection(ask);
  const mine = new Set([inv.key, ...inv.aliasKeys]);
  const held = (snapshot.research.pageComparisons ?? []).find((c) => mine.has(c.topicKey) && c.askKey === want
    && JSON.stringify(c.pages) === JSON.stringify(norm.pages)
    && JSON.stringify(c.excludePages) === JSON.stringify(norm.exclude_pages ?? []));
  return held?.comparison ?? (held?.unavailable ? { unavailable: held.unavailable } : null);
}

/**
 * ONE RANKED PASS over every subject this account has a stake in, and the ONLY reading of it any step gets. It
 * adjudicates every topic in the same order, gives each one the comparison IT owns, and returns both halves of
 * the answer: the highest-ranked topic that reached a real verdict, and what the rest is still stuck on. The
 * topic that OWNS a comparison is the topic judged with it, and a comparison whose basis, topic or exact ask has drifted is refused. $0: no model runs and no provider is paid.
 */
/** The verdicts that can still become work an operator does. `do_nothing` is a finished
 *  answer, not one of them. */
const ACTS = new Set<CoverageVerdict>(["create_new", "improve_existing", "consolidate_or_choose"]);

export async function readCoverage(snapshot: EvidenceSnapshot, tenantId: string, opts: ReadCoverageOptions = {}): Promise<CoverageRead> {
  // EXPLICIT: 0 means "decide only, buy nothing". It caught me in a live probe reporting no needs at all, so the default states its intent rather than looking like an oversight.
  const max = opts.maxQueries ?? 0;
  const needs: ResearchNeed[] = [];
  const seen = new Set<string>();
  // ONE body cache for the whole pass, and one bounded read: at most three of my own pages, asked for once each, never the site. Every candidate rebuild reads out of this map.
  const bodies = new Map<string, OwnedPageBody>();
  const asked = new Set<string>();
  let queries = 0;
  const nowMs = (opts.now ?? new Date()).getTime();
  let decided: DecidedTopic | null = null;
  let waitingUntil: string | null = null;
  // WHY A PAGE OF MINE IS UNREAD, off the research row Evidence persisted it to. Not a fetch, and not a guess.
  const ownedReads = new Map((snapshot.research.ownedReads ?? []).map((o) => [o.url, o]));
  const promoted = await promotedNeeds(tenantId, snapshot);
  for (const inv of rankInvestigations(topicsFor(snapshot, promoted), (i) => ownedOpportunity(snapshot, i, opts.curve?.expectedCtrAt))) {
    // STOPPING ON A PARK IS HOW THE RULE BELOW BECAME DEAD CODE: production reads this pass with no research budget, so the walk ended the moment ANY verdict landed, and a park ranks first.
    if (decided && ACTS.has(decided.decision.verdict) && queries >= max && (max <= 0 || needs.some((n) => n.comparison))) break;
    let candidates = ownedCandidatesFor(snapshot, inv, bodies);
    const judge = { outOfScopeTopics: topicOutOfScope(snapshot, inv, opts.profile ?? null), now: opts.now, site: snapshot.scope?.site ?? null,
      ...(opts.technical ? { technical: opts.technical } : {}),
      ...(opts.patternFor && opts.patternFor.topicKey === inv.key ? { pattern: opts.patternFor.pattern } : {}) };
    let decision: CoverageDecision;
    try { decision = await adjudicateCoverage(inv, candidates, tenantId, judge); } catch { continue; }
    // A PAGE OF MINE WHOSE WORDS ARE ALREADY STORED IS NOT AN UNREAD PAGE: the strong ones are read now and
    // judged again in the SAME pass, because a requirement I can close in this breath is not a reason to send the operator away.
    let ownedRead: OwnedPageReadOutcome | null = null;
    let ownedUrl: string | null = null;
    if (decision.missing[0] === "owned_content") {
      const want = candidates.filter((c) => c.strongSignals > 0 && !c.bodyHeld && !asked.has(c.url)).slice(0, MAX_BODY_READS - asked.size).map((c) => c.url);
      for (const u of want) asked.add(u);
      const read = want.length > 0 ? await loadOwnedPageBodies(tenantId, want).catch(() => null) : null;
      // ONE FRESHNESS MATRIX, BOTH SIDES OF THE FENCE: judging a body of any age as held here made this gate and Evidence's own page phase disagree about the word "current".
      for (const [key, body] of read ?? []) if (isCurrent("owned_page", body.fetchedAt, nowMs)) bodies.set(key, body);
      // AN EMPTY BODY STORE IS UNKNOWN COVERAGE, NEVER PROOF A PAGE HAS NO WORDS. A page my own results name,
      // whose words are not on file, is NAMED for the run's page phase to read under its lease; naming it here is free and safe, and fetching it here was the whole defect.
      const owed = want.find((u) => !bodies.has(u));
      if (owed) { ownedUrl = owed; ownedRead = ownedReads.get(owed) ?? null; }
      // DECIDE AGAIN IN THE SAME PASS: a body already stored is judged in this breath, and a read that failed hands the verdict its persisted reason so the verdict says which failure this was and on what date.
      if (ownedRead || want.some((u) => bodies.has(u))) {
        candidates = ownedCandidatesFor(snapshot, inv, bodies);
        try { decision = await adjudicateCoverage(inv, candidates, tenantId, { ...judge, ownedRead }); } catch { continue; }
      }
    }
    let ask = intersectionComparison(decision, inv, candidates);
    let reading: PageCoverageReading | null = null;
    // THE ANSWER THIS TOPIC ALREADY BOUGHT, matched on its own key AND the exact ask, so a comparison bought for another topic can never be read as evidence about this one.
    const held = ask ? opts.intersection ?? storedComparisonFor(snapshot, inv, opts.basis ?? null, ask) : null;
    if (held) {
      try { decision = await adjudicateCoverage(inv, candidates, tenantId, { ...judge, intersection: held }); } catch { continue; }
      reading = readComparison(held, candidates);
      ask = intersectionComparison(decision, inv, candidates);
    }
    // A PARK MAY NEVER OUTRANK A DECISION: `decided` is the ONLY door to the new-page builder, so one parked topic taking it would starve every topic that could actually earn work. An actionable verdict always
    // wins; a park is the answer only when nothing else is.
    if (decision.verdict !== "research_needed" && (!decided || (ACTS.has(decision.verdict) && !ACTS.has(decided.decision.verdict)))) {
      decided = { investigation: inv, candidates, decision, reading };
    }
    const query = (nextResearchQuery(decision, inv) ?? "").trim();
    const comparison = max <= 0 || query || needs.some((n) => n.comparison) ? null : ask;
    // A CASE THAT CAN ONLY WAIT IS STILL A CASE, and the EARLIEST of those dates is the whole account's waiting truth, counted over every topic walked rather than only the ones inside the research budget.
    const retryAfter = decision.hold ?? null;
    if (retryAfter && (waitingUntil == null || retryAfter < waitingUntil)) waitingUntil = retryAfter;
    const owedBody = decision.missing[0] === "owned_content";
    // EVERY QUEUED NEED COUNTS AGAINST THE SAME CEILING: a body I owe and a page I am waiting on cost no
    // search, but they still enter the run's frozen plan, which is what the paid comparison's drift guard reads.
    // NOTHING LEFT TO BUY RELEASES THE SLOT, and A SEARCH IS SOMETHING LEFT TO BUY. `diminishing` is computed
    // against the WINNER window, so between days 8 and 30 after a look a fully researched topic asks for a fresh
    // results page and still reads as diminishing; releasing it there dropped the exact class that ranks first.
    // The release is for a topic NO purchase can move: no search, no comparison, no page of my own owed, no date I promised. That is the mixed-meaning shape it was written for and nothing else.
    if (inv.diminishing && !query && !comparison && !owedBody && !retryAfter) continue;
    if (query ? queries >= max || seen.has(query.toLowerCase()) : (!comparison && !retryAfter && !owedBody) || queries >= max) continue;
    seen.add(query.toLowerCase()); queries += 1;
    needs.push({ topicKey: inv.key, requirement: decision.missing[0]!, query: query || null, comparison, ownedUrl: owedBody ? ownedUrl : null, retryAfter });
  }
  return { decided, needs, waitingUntil };
}

/** The exact search that closes what the verdict named, or null when no search can. An unsettled meaning is
 *  already decided by the results page ON FILE; a shape that will not settle is CLOSED upstream; an unread page
 *  of mine is read inside this pass; and the comparison is bought by its own ask. A `winners` topic re-lists its
 *  CURRENT search so the winner reads bank that topic's own top pages, which is not a buy. A topic merely
 *  WAITING on a page-body retry lists nothing. */
function nextResearchQuery(d: CoverageDecision, inv: TopicInvestigation): string | null {
  const need = d.topicKey === inv.key && !d.hold ? d.missing[0] : null;
  if (need === "exact_serp" || need === "fresh_serp") return inv.exactSerps.find((s) => s.freshness !== "current")?.query ?? inv.queries[0] ?? null;
  return need === "winners" ? inv.exactSerps.find((s) => s.freshness === "current")?.query ?? null : null;
}

/** WHAT THIS ACCOUNT'S RESEARCH IS STUCK ON: at most `max` searches plus at most ONE comparison, read off the
 *  SAME canonical pass that decides whether a page is owed. A topic no purchase can move is skipped rather than
 *  queued, two topics stuck on one search spend one slot, and an unreadable packet never stalls the agenda. */
export async function researchNeeds(snapshot: EvidenceSnapshot, tenantId: string, profile: BusinessProfile | null, max: number): Promise<ResearchNeed[]> {
  return (await readCoverage(snapshot, tenantId, { maxQueries: max, profile, basis: await resolveCurrentBasis(tenantId, profile) })).needs;
}
