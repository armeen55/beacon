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
 * $0 and deterministic: the judgment model stays off here and no provider is reached, so
 * walking every topic costs arithmetic and nothing else.
 */

import type { BusinessProfile } from "@/domains/account";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { askIdentity, normalizePageIntersection, type PageCoverageReading, type PageIntersectionAsk } from "@/domains/evidence/page-intersection";
import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation";
import { ownedCandidatesFor, topicOutOfScope, type OwnedCandidate } from "./owned-coverage";
import { resolveCurrentBasis } from "./load-proposals";
import {
  adjudicateCoverage, intersectionComparison, readComparison,
  type CoverageDecision, type IntersectionEvidence, type MissingRequirement,
} from "./coverage-adjudication";

/** THE order every step reads: fewest missing pieces first, then the largest demand behind it, then
 *  the stable key, so the same evidence always advances the SAME topic whether it is being bought
 *  for, compared or judged. It ranks research, never work. */
export function rankInvestigations(investigations: readonly TopicInvestigation[]): TopicInvestigation[] {
  return [...investigations].sort((a, b) => a.missingEvidence.length - b.missingEvidence.length
    || (b.demand.monthlySearchVolume ?? 0) - (a.demand.monthlySearchVolume ?? 0)
    || (b.demand.gscImpressions ?? 0) - (a.demand.gscImpressions ?? 0) || a.key.localeCompare(b.key));
}

/** ONE topic, the ONE thing it is stuck on, and the exact purchase that closes it: a search to look up, or the comparison. Never both, never neither. */
export type ResearchNeed = { topicKey: string; requirement: MissingRequirement; query: string | null; comparison: PageIntersectionAsk | null };

/** A topic whose evidence reached a FINAL answer, with everything that answer rests on, so
 *  the step that acts on it never has to re-derive the candidates or re-read the comparison. */
export type DecidedTopic = {
  investigation: TopicInvestigation;
  candidates: OwnedCandidate[];
  decision: CoverageDecision;
  /** The page by page comparison behind the verdict, when one settled it. */
  reading: PageCoverageReading | null;
};

/** THE one interpretation of this account's coverage: the highest-ranked topic that is
 *  actually decided, and separately what the rest of the research is stuck on. */
export type CoverageRead = { decided: DecidedTopic | null; needs: ResearchNeed[] };

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
function storedComparisonFor(snapshot: EvidenceSnapshot, topicKey: string, basis: string | null, ask: PageIntersectionAsk): IntersectionEvidence | null {
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
  const held = (snapshot.research.pageComparisons ?? []).find((c) => c.topicKey === topicKey && c.askKey === want
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
 * the same answer. $0: the judgment model stays off and no provider is reached, so a walk
 * over every topic costs nothing but arithmetic.
 */
export async function readCoverage(snapshot: EvidenceSnapshot, tenantId: string, opts: ReadCoverageOptions = {}): Promise<CoverageRead> {
  // EXPLICIT: 0 means "decide only, buy nothing". It caught me in a live probe reporting no
  // needs at all, so the default states its intent rather than looking like an oversight.
  const max = opts.maxQueries ?? 0;
  const needs: ResearchNeed[] = [];
  const seen = new Set<string>();
  let queries = 0;
  let decided: DecidedTopic | null = null;
  for (const inv of rankInvestigations(buildTopicInvestigations(snapshot))) {
    if (decided && queries >= max && (max <= 0 || needs.some((n) => n.comparison))) break;
    const candidates = ownedCandidatesFor(snapshot, inv);
    // The judgment model stays OFF here: the ladder that reaches a final verdict is
    // deterministic, and running a reasoning model per topic inside an operator's page
    // load for an answer no screen shows is a bill nobody asked for.
    const judge = { model: "off" as const, outOfScopeTopics: topicOutOfScope(snapshot, inv, opts.profile ?? null), now: opts.now };
    let decision: CoverageDecision;
    try { decision = await adjudicateCoverage(inv, candidates, tenantId, judge); } catch { continue; }
    let ask = intersectionComparison(decision, inv, candidates);
    let reading: PageCoverageReading | null = null;
    // THE ANSWER THIS TOPIC ALREADY BOUGHT, matched on its own key AND the exact ask, so a
    // comparison bought for another topic can never be read as evidence about this one.
    const held = ask ? opts.intersection ?? storedComparisonFor(snapshot, inv.key, opts.basis ?? null, ask) : null;
    if (held) {
      try { decision = await adjudicateCoverage(inv, candidates, tenantId, { ...judge, intersection: held }); } catch { continue; }
      reading = readComparison(held, candidates);
      ask = intersectionComparison(decision, inv, candidates);
    }
    if (!decided && decision.verdict !== "research_needed") decided = { investigation: inv, candidates, decision, reading };
    const query = (nextResearchQuery(decision, inv) ?? "").trim();
    const comparison = max <= 0 || query || needs.some((n) => n.comparison) ? null : ask;
    if (!query ? !comparison : queries >= max || seen.has(query.toLowerCase())) continue;
    if (query) { seen.add(query.toLowerCase()); queries += 1; }
    needs.push({ topicKey: inv.key, requirement: decision.missing[0]!, query: query || null, comparison });
  }
  return { decided, needs };
}

/** The exact search that closes what the verdict named, or null when no search can. A mixed
 *  shape and an unsettled meaning are already decided by the results page ON FILE, so
 *  queueing them sent runs to fetch competitor pages for topics they would refuse anyway
 *  (26 of 53 live topics); an unread page of mine is a page to READ; and the comparison is
 *  bought by its own ask. FRESHNESS: taking the first row asked for the page I already hold
 *  whenever a group carried a current look beside a stale one, so the stale one stayed
 *  stale forever. A `winners` topic re-lists its CURRENT search so the winner reads bank
 *  that topic's own top pages, and the look itself is held already, so it is not a buy. */
function nextResearchQuery(d: CoverageDecision, inv: TopicInvestigation): string | null {
  const need = d.topicKey === inv.key ? d.missing[0] : null;
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
