import "server-only";

/**
 * decision/coverage-pass (N4, 2026-07-28): ONE ranked walk over everything this account has
 * investigated, and the ONLY reading of it any step gets. coverage-adjudication answers
 * "does this account already have the right page?" for ONE topic; this file decides WHICH
 * topics get asked, in what order, with which evidence, and hands back both halves of the
 * answer at once: the highest-ranked topic that reached a real verdict, and what the rest of
 * the research is still stuck on.
 *
 * ONE INTERPRETATION, TWO CONSUMERS. Runtime buys evidence off this pass and proposal
 * production acts off the same pass, so a run can never pay for one topic's comparison while
 * a different topic is being judged. A comparison is matched to the topic that OWNS it and to
 * the exact ask that bought it, under the account's current basis, so drifted evidence is
 * refused rather than read as an answer to a question nobody asked.
 *
 * $0 AND $0 OF THE WEB: no model runs, no provider is paid and NO WEBSITE IS FETCHED. This pass used to read
 * the customer's own page live, from an ordinary render, outside any lease, and because nothing was persisted
 * the same dead URL was refetched on every visit and no honest retry date could be given. Acquisition and
 * persistence belong to Evidence under Runtime's lease: here the owed page is NAMED as plain data, and its
 * stored body, or the stored reason it is unread, is READ. Nothing else. */

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

/** THE order every step reads: fewest missing pieces first, then the largest demand behind it, then
 *  the stable key, so the same evidence always advances the SAME topic whether it is being bought
 *  for, compared or judged. It ranks research, never work. */
export function rankInvestigations(investigations: readonly TopicInvestigation[]): TopicInvestigation[] {
  return [...investigations].sort((a, b) => a.missingEvidence.length - b.missingEvidence.length
    || (b.demand.monthlySearchVolume ?? 0) - (a.demand.monthlySearchVolume ?? 0)
    || (b.demand.gscImpressions ?? 0) - (a.demand.gscImpressions ?? 0) || a.key.localeCompare(b.key));
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

export type ReadCoverageOptions = {
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
  now?: Date;
};

/**
 * The CURRENT stored comparison for ONE topic, or the honest reason Evidence could not get
 * one, or null when neither is in hand. A comparison bought for a DIFFERENT topic or about a
 * DIFFERENT set of pages answers a question I am no longer asking, so it is REFUSED rather
 * than reused: `ask` is the exact comparison this pass would buy today and only an answer to
 * that one counts. BASIS: the stored rows are projected from the funnel state scoped to the
 * account's current basis, so an older bar's answers are not in this snapshot at all; a
 * basis I cannot read is refused outright rather than assumed current.
 */
function storedComparisonFor(snapshot: EvidenceSnapshot, inv: TopicInvestigation, basis: string | null, ask: PageIntersectionAsk): IntersectionEvidence | null {
  if (!basis) return null;
  // THE COMPLETE NORMALIZED ASK, not just the page list. The stored row carries an askKey
  // that folds in the intersection mode and the limit as well as the pages; matching on
  // pages alone would reuse an answer bought under a DIFFERENT question about the same
  // pages, which is the quiet way a comparison stops meaning what the verdict thinks.
  const want = askIdentity(ask);
  const norm = normalizePageIntersection(ask);
  // BOTH: the complete ask identity AND the row's own page set. The key alone folds in the
  // mode and the limit that the page list cannot express; the page list alone catches a row
  // whose stored key no longer describes what it holds. Either check on its own lets an
  // answer to a different question be read as the answer to this one.
  // NO BACKWARD READ. A prior-key fallback was carried for rows bought under the old packet hash,
  // and this account holds zero stored comparisons, so it was compatibility for nobody.
  // AN ALIAS IS STILL THIS CASE: reading only `key` made a comparison bought under an absorbed id
  // invisible, and bought it a second time for real money.
  const mine = new Set([inv.key, ...inv.aliasKeys]);
  const held = (snapshot.research.pageComparisons ?? []).find((c) => mine.has(c.topicKey) && c.askKey === want
    && JSON.stringify(c.pages) === JSON.stringify(norm.pages)
    && JSON.stringify(c.excludePages) === JSON.stringify(norm.exclude_pages ?? []));
  return held?.comparison ?? (held?.unavailable ? { unavailable: held.unavailable } : null);
}

/**
 * ONE RANKED PASS over everything this account has investigated, and the ONLY reading of it
 * any step gets. It adjudicates every topic in the same order, gives each one the comparison
 * IT owns, and returns both halves of the answer: the highest-ranked topic that reached a
 * real verdict, and what the rest is still stuck on.
 *
 * TWO topics are never confused again. The step that buys evidence deliberately skips a
 * topic parked on shape or meaning and buys for a lower-ranked one that can actually move,
 * so reading the verdict of whichever topic merely RANKS first stared forever at a parked
 * topic while the comparison it paid for went unread. Here the topic that OWNS a comparison
 * is the topic judged with it, a comparison whose basis, topic or exact ask has drifted is
 * refused rather than read as evidence for a question nobody asked, and every caller sees
 * the same answer. $0: no model runs and no provider is paid, so a walk over every topic costs
 * arithmetic plus at most one bounded read of page text this account already stored.
 */
/** The verdicts that can still become work an operator does. `do_nothing` is a finished
 *  answer, not one of them. */
const ACTS = new Set<CoverageVerdict>(["create_new", "improve_existing", "consolidate_or_choose"]);

export async function readCoverage(snapshot: EvidenceSnapshot, tenantId: string, opts: ReadCoverageOptions = {}): Promise<CoverageRead> {
  // EXPLICIT: 0 means "decide only, buy nothing". It caught me in a live probe reporting no
  // needs at all, so the default states its intent rather than looking like an oversight.
  const max = opts.maxQueries ?? 0;
  const needs: ResearchNeed[] = [];
  const seen = new Set<string>();
  // ONE body cache for the whole pass, and one bounded read: at most three of my own pages,
  // asked for once each, never the site. Every candidate rebuild reads out of this map.
  const bodies = new Map<string, OwnedPageBody>();
  const asked = new Set<string>();
  let queries = 0;
  let decided: DecidedTopic | null = null;
  let waitingUntil: string | null = null;
  // WHY A PAGE OF MINE IS UNREAD, off the research row Evidence persisted it to. Not a fetch, and not a guess.
  const ownedReads = new Map((snapshot.research.ownedReads ?? []).map((o) => [o.url, o]));
  for (const inv of rankInvestigations(buildTopicInvestigations(snapshot))) {
    // STOPPING ON A PARK IS HOW THE RULE BELOW BECAME DEAD CODE: production reads this pass with
    // no research budget, so the walk ended the moment ANY verdict landed, and a park ranks first.
    if (decided && ACTS.has(decided.decision.verdict) && queries >= max && (max <= 0 || needs.some((n) => n.comparison))) break;
    let candidates = ownedCandidatesFor(snapshot, inv, bodies);
    const judge = { outOfScopeTopics: topicOutOfScope(snapshot, inv, opts.profile ?? null), now: opts.now, site: snapshot.scope?.site ?? null };
    let decision: CoverageDecision;
    try { decision = await adjudicateCoverage(inv, candidates, tenantId, judge); } catch { continue; }
    // A PAGE OF MINE WHOSE WORDS ARE ALREADY STORED IS NOT AN UNREAD PAGE. This pass asked for
    // candidates with no bodies at all, so a page ranking third for the exact search, cited by
    // two engines and sitting in the body store still read "I have never read this" and parked
    // its topic forever. Read the strong ones now and decide again in the SAME pass, because a
    // requirement I can close in this breath is not a reason to send the operator away.
    let ownedRead: OwnedPageReadOutcome | null = null;
    let ownedUrl: string | null = null;
    if (decision.missing[0] === "owned_content") {
      const want = candidates.filter((c) => c.strongSignals > 0 && !c.bodyHeld && !asked.has(c.url)).slice(0, MAX_BODY_READS - asked.size).map((c) => c.url);
      for (const u of want) asked.add(u);
      const read = want.length > 0 ? await loadOwnedPageBodies(tenantId, want).catch(() => null) : null;
      for (const [key, body] of read ?? []) bodies.set(key, body);
      // AN EMPTY BODY STORE IS UNKNOWN COVERAGE, NEVER PROOF A PAGE HAS NO WORDS, and the two are not even
      // the same problem: a store that failed to answer is retryable, an absent body is a page I have never
      // read. Both used to `continue` here, so the case was neither queued nor parked and vanished off every
      // surface. A page my own results already name earns ONE live read of its own, once per whole pass.
      // A page my own results already name, whose words are not on file, is NAMED for the run's page phase to
      // go and read under its lease. Naming it here is free and safe; fetching it here was the whole defect.
      const owed = want.find((u) => !bodies.has(u));
      if (owed) { ownedUrl = owed; ownedRead = ownedReads.get(owed) ?? null; }
      // DECIDE AGAIN IN THE SAME PASS: a body already stored is judged in this breath, and a read that failed
      // hands the verdict its persisted reason so the verdict says which failure this was and on what date.
      if (ownedRead || want.some((u) => bodies.has(u))) {
        candidates = ownedCandidatesFor(snapshot, inv, bodies);
        try { decision = await adjudicateCoverage(inv, candidates, tenantId, { ...judge, ownedRead }); } catch { continue; }
      }
    }
    let ask = intersectionComparison(decision, inv, candidates);
    let reading: PageCoverageReading | null = null;
    // THE ANSWER THIS TOPIC ALREADY BOUGHT, matched on its own key AND the exact ask, so a
    // comparison bought for another topic can never be read as evidence about this one.
    const held = ask ? opts.intersection ?? storedComparisonFor(snapshot, inv, opts.basis ?? null, ask) : null;
    if (held) {
      try { decision = await adjudicateCoverage(inv, candidates, tenantId, { ...judge, intersection: held }); } catch { continue; }
      reading = readComparison(held, candidates);
      ask = intersectionComparison(decision, inv, candidates);
    }
    // A PARK MAY NEVER OUTRANK A DECISION. Mixed shape is terminal now rather than an
    // impossible purchase, and it ranks FIRST because it is missing the fewest pieces. Taking
    // the first verdict that merely is not research_needed therefore handed `decided` to a
    // topic that can never produce a Change, and `decided` is the ONLY door to the new-page
    // builder, so one parked topic would starve every topic that could actually earn work.
    // An actionable verdict always wins; a park is the answer only when nothing else is.
    if (decision.verdict !== "research_needed" && (!decided || (ACTS.has(decision.verdict) && !ACTS.has(decided.decision.verdict)))) {
      decided = { investigation: inv, candidates, decision, reading };
    }
    const query = (nextResearchQuery(decision, inv) ?? "").trim();
    const comparison = max <= 0 || query || needs.some((n) => n.comparison) ? null : ask;
    // A CASE THAT CAN ONLY WAIT IS STILL A CASE. A winner read due tomorrow and a page of my own that did
    // not answer both buy nothing today, and dropping them here is exactly how a topic stopped being visible
    // anywhere at all. `owned_content` is always listed; everything else waiting carries its own date. The
    // EARLIEST of those dates is the whole account's waiting truth, counted over every topic walked rather
    // than only the ones that fit the research budget, because Today reads it whatever the budget was.
    const retryAfter = decision.hold ?? null;
    if (retryAfter && (waitingUntil == null || retryAfter < waitingUntil)) waitingUntil = retryAfter;
    const owedBody = decision.missing[0] === "owned_content";
    // EVERY QUEUED NEED COUNTS AGAINST THE SAME CEILING. A body I owe and a page I am waiting on cost
    // no search, but they still enter the run's frozen plan, and leaving them uncounted let EVERY topic
    // into it: the plan header promises three, the drift guard that gates the one paid comparison is
    // only as narrow as that plan, and the run's durable progress grew without bound.
    if (query ? queries >= max || seen.has(query.toLowerCase()) : (!comparison && !retryAfter && !owedBody) || queries >= max) continue;
    seen.add(query.toLowerCase()); queries += 1;
    needs.push({ topicKey: inv.key, requirement: decision.missing[0]!, query: query || null, comparison, ownedUrl: owedBody ? ownedUrl : null, retryAfter });
  }
  return { decided, needs, waitingUntil };
}

/** The exact search that closes what the verdict named, or null when no search can. An
 *  unsettled meaning is already decided by the results page ON FILE, so queueing it sent runs
 *  to fetch competitor pages for topics they would refuse anyway (26 of 53 live topics); a
 *  shape that will not settle is CLOSED upstream and never arrives here at all; an unread page
 *  of mine is read inside this pass; and the comparison is bought by its own ask. FRESHNESS:
 *  taking the first row asked for the page I already hold whenever a group carried a current
 *  look beside a stale one, so the stale one stayed stale forever. A `winners` topic re-lists its
 *  CURRENT search so the winner reads bank that topic's own top pages, and the look itself is held
 *  already, so it is not a buy. A topic merely WAITING on a page-body retry lists nothing: re-listing
 *  its search would buy another results page just to sit out somebody else's timeout. */
function nextResearchQuery(d: CoverageDecision, inv: TopicInvestigation): string | null {
  const need = d.topicKey === inv.key && !d.hold ? d.missing[0] : null;
  if (need === "exact_serp" || need === "fresh_serp") return inv.exactSerps.find((s) => s.freshness !== "current")?.query ?? inv.queries[0] ?? null;
  return need === "winners" ? inv.exactSerps.find((s) => s.freshness === "current")?.query ?? null : null;
}

/** WHAT THIS ACCOUNT'S RESEARCH IS STUCK ON: at most `max` searches plus at most ONE
 *  comparison, read off the SAME canonical pass that decides whether a page is owed, so a
 *  run can never pay for one topic's comparison while a different topic is being judged. A
 *  topic no purchase can move is skipped rather than queued, two topics stuck on one search
 *  spend one slot, and an unreadable packet never stalls the agenda. */
export async function researchNeeds(snapshot: EvidenceSnapshot, tenantId: string, profile: BusinessProfile | null, max: number): Promise<ResearchNeed[]> {
  return (await readCoverage(snapshot, tenantId, { maxQueries: max, profile, basis: await resolveCurrentBasis(tenantId, profile) })).needs;
}
