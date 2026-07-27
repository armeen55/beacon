/**
 * decision/opportunities (decision truth replacement, 2026-07-27): the ONE
 * diagnosis. It answers "what does the evidence actually justify for this page"
 * BEFORE a single word is drafted, and DOING NOTHING IS THE DEFAULT ANSWER.
 *
 * What it replaced: a loop that manufactured a title AND a description proposal
 * for every owned page over 20 impressions, ranked by gross traffic, so the pages
 * that already win got the most "work". A page is not a problem because it is big.
 *
 * How a page earns an action now: only its EXACT query rows (query, impressions,
 * clicks, position) are measured against the ONE click curve this repo already
 * owns (evidence/forecast/tenant-ctr-curve). A page earns `act_existing_page` only
 * when its best query clears ALL THREE floors in contracts.ts: enough impressions
 * to trust, a real click gap against that position, and enough recoverable clicks
 * to be worth an operator's morning. Everything else is `watch` (a real but
 * sub-floor gap) or `do_nothing` (it already beats the curve), carried with the
 * exact numbers so the receipt can show its work. Page totals are never measured
 * and never quoted as query numbers. `recoverableClicks` is the only value scalar
 * that leaves this module: a small page with a real gap outranks a huge page with
 * none.
 *
 * A GAP IS NOT AN ACTION (evidence-qualified changes, 2026-07-27). A click gap
 * proves something is wrong; it never proves WHAT TO CHANGE. So every page that
 * clears the floors is also asked what evidence I actually HOLD for it
 * (EvidenceReadiness in contracts.ts): the exact query rows, this page's own
 * current copy, and a live results page observed for THAT EXACT search. Without
 * all three the outcome is `research_needed`, whose reason names exactly what is
 * missing, so nothing is ever drafted for a search I have never looked at. The
 * readiness rides on the candidate, so the producer sets confidence from evidence
 * completeness rather than from how good the draft reads.
 *
 * MODELED OPPORTUNITY, NEVER PROMISED LIFT. `recoverableClicks` is the distance to
 * a generalized curve, so the copy says "this search earns about N fewer clicks
 * than pages at a similar position usually get", never "a sharper title is worth N
 * clicks". Only a diagnosed action may name the edit as the strongest explanation.
 *
 * PURE + deterministic. No I/O, no LLM.
 */

import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal, NewPageOpportunity } from "@/domains/evidence/snapshot";
import { anchoredTopicMatch, canonicalQueryKey, scoreTopicMatch, topicTokens, weakAnchorTokens } from "@/domains/evidence/relevance-gate";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { MIN_CTR_DEFICIT, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, readyForAction,
  type DecisionCandidate, type EvidenceInput, type EvidenceReadiness, type ProposalKind } from "./contracts";

/** Phrases an account must have on file before any word of its own can be called
 *  ubiquitous. Under this, a one-topic account keeps its honest overlaps. */
const MIN_ANCHOR_CORPUS = 10;

/** How small a soft search must be, against the clicks the page already earns, to
 *  be watched rather than acted on when the page beats its curve overall. */
const PARITY_MINOR_SHARE = 0.1;

/** The curve the gap is measured against. Defaults to the industry curve this
 *  repo already ships; a tenant-fitted curve is passed in when one exists. */
export type CompileOptions = { curve?: Pick<TenantCtrCurve, "expectedCtrAt"> };

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const pct = (v: number): string => `${(v * 100).toFixed(1)} percent`;

/** Coarse searcher-intent bucket from the query tokens (feeds the drafter's
 *  intent directive). Deterministic; never fabricates. */
function intentOf(query: string): string | undefined {
  const q = query.toLowerCase();
  if (/\b(when|hours?|open|today|time)\b/.test(q)) return "when";
  if (/\b(cost|price|how much|cheap|fee)\b/.test(q)) return "cost";
  if (/\b(how|guide|tutorial|steps?)\b/.test(q)) return "how";
  if (/\b(where|near me|location|address|directions?)\b/.test(q)) return "where";
  if (/\b(who|best|top|review)\b/.test(q)) return "who";
  if (/\b(list|examples?|ideas?)\b/.test(q)) return "list";
  if (/\b(vs|versus|compare|difference)\b/.test(q)) return "compare";
  return undefined;
}

// ── query-level measurement (the ONLY thing that earns an action) ─────────────

type QueryGap = {
  query: string; impressions: number; clicks: number; position: number; expectedCtr: number; actualCtr: number;
  /** expected minus actual, in click-rate points. Negative = beating the curve. */
  deficit: number;
  /** deficit x impressions, rounded. Negative = nothing to recover. */
  recoverableClicks: number;
};

/** Measure ONE exact query row against the curve. Null when the row cannot be
 *  measured honestly (no position, no impressions). */
function measureQuery(q: OwnedQuerySignal, expectedCtrAt: (position: number) => number): QueryGap | null {
  const impressions = Number(q.impressions);
  const clicks = Number(q.clicks);
  const position = q.position;
  if (!Number.isFinite(impressions) || impressions <= 0) return null;
  if (position == null || !Number.isFinite(position) || position <= 0) return null;
  if (!Number.isFinite(clicks) || clicks < 0) return null;
  const expectedCtr = expectedCtrAt(position);
  const actualCtr = Math.min(1, clicks / impressions);
  const deficit = expectedCtr - actualCtr;
  return { query: q.query, impressions, clicks, position, expectedCtr, actualCtr, deficit, recoverableClicks: Math.round(deficit * impressions) };
}

/** The query with the most recoverable clicks. Deterministic tiebreak. */
function bestGap(gaps: QueryGap[]): QueryGap | null {
  return [...gaps].sort((a, b) => b.recoverableClicks - a.recoverableClicks || b.impressions - a.impressions || a.query.localeCompare(b.query))[0] ?? null;
}

/** Which ONE field the gap justifies rewriting, or null when the copy cannot say.
 *  The searcher's own words missing from the title is a title job; a title that
 *  already carries them leaves the description as the remaining click lever. When
 *  both already say it, nothing in the copy explains the gap and the honest
 *  answer is to watch, not to rewrite something at random. */
function fieldForGap(page: OwnedPageEvidence, query: string): "title" | "meta" | null {
  const content = page.content;
  if (!content) return null; // the page's own copy has not been read yet
  const wanted = topicTokens(query);
  if (wanted.length === 0) return null;
  const says = (text: string | null): boolean => {
    if (!text) return false;
    const have = new Set(topicTokens(text));
    return wanted.every((t) => have.has(t));
  };
  if (!says(content.title)) return "title";
  if (!says(content.metaDescription)) return "meta";
  return null;
}

const fieldLabel = (field: "title" | "meta"): string => (field === "title" ? "title" : "description");

// ── evidence readiness (a gap opens an investigation, evidence closes it) ─────

/** A candidate carrying what evidence the decision HOLDS. Structurally a
 *  DecisionCandidate (contracts.ts stays frozen); the extra field is read only
 *  inside Decision, to gate drafting and to set confidence. */
export type QualifiedCandidate = DecisionCandidate & { readiness?: EvidenceReadiness };

/** What research this snapshot holds, indexed once per pass. A live results page
 *  counts for a query only under EXACT/canonical identity: a neighbouring search
 *  never vouches for the one that is losing clicks. */
type ResearchIndex = { serpQueries: Set<string>; winnersByQuery: Map<string, number> };
function indexResearch(snapshot: EvidenceSnapshot): ResearchIndex {
  const research = snapshot.research;
  const serpQueries = new Set((research?.serpEvidence ?? []).map((e) => canonicalQueryKey(e.query)).filter(Boolean));
  const winnersByQuery = new Map<string, number>();
  for (const page of research?.winningPages ?? []) {
    // A page I never READ vouches for nothing: only a fetched extract says WHY it
    // wins. Counting bare appearances bought High confidence on unread pages.
    if (!page.extract) continue;
    const keys = new Set(page.appearances.map((a) => canonicalQueryKey(a.query)).filter(Boolean));
    for (const k of keys) winnersByQuery.set(k, (winnersByQuery.get(k) ?? 0) + 1);
  }
  return { serpQueries, winnersByQuery };
}

/** What I hold for ONE page and ONE exact query. Never inferred from a neighbour. */
function readinessOf(page: OwnedPageEvidence, gap: QueryGap, index: ResearchIndex): EvidenceReadiness {
  const content = page.content;
  const key = canonicalQueryKey(gap.query);
  return {
    gsc: gap.impressions > 0 && Number.isFinite(gap.position),
    ownedCopy: !!content && !!((content.title ?? "").trim() || (content.metaDescription ?? "").trim()),
    serp: !!key && index.serpQueries.has(key),
    winners: index.winnersByQuery.get(key) ?? 0,
    // FALSE until a page-body store exists. An outline is a list of headings, not the
    // page's words: produce-bundle holds PAGE_BODY_TEXT = null and every receipt says
    // so, and one contract read two ways always inflated in the same direction.
    body: false,
  };
}

/** Name exactly what is missing, in the operator's words. Never a lab word. */
function missingSentence(r: EvidenceReadiness): string {
  const missing: string[] = [];
  if (!r.serp) missing.push("I have not looked at the live results page for that search yet");
  if (!r.ownedCopy) missing.push("I do not hold this page's current title and description");
  if (!r.gsc) missing.push("I do not hold trustworthy search numbers for that exact search");
  return `I can see the gap but ${missing.join(", and ")}, so I cannot tell you what to change.`;
}

/** One page's honest outcome, measured on its exact queries only. */
function candidateForPage(page: OwnedPageEvidence, expectedCtrAt: (position: number) => number, index: ResearchIndex): QualifiedCandidate {
  const pageUrl = absoluteUrl(page.url);
  const gaps = (page.search?.topQueries ?? [])
    .map((q) => measureQuery(q, expectedCtrAt))
    .filter((g): g is QueryGap => g != null);
  // Counting the weak query too, does this page already earn more clicks than its own
  // positions predict? A title or description is ONE lever shared by every search the
  // page serves, so rewriting it to chase a single soft query bets the searches that
  // are winning against the one that is not, and on a page already ahead of its curve
  // that trade is not worth an operator's morning: the honest answer is watch.
  const earned = gaps.reduce((s, g) => s + g.clicks, 0);
  const predicted = gaps.reduce((s, g) => s + g.expectedCtr * g.impressions, 0);
  const best = bestGap(gaps);
  // ...but only while the soft search is SMALL next to what the page already earns.
  // Enough winners can out-sum a genuinely broken search, and a gap worth a large
  // share of the page's own clicks is never a rounding error: measured against the
  // page's own scale, so it needs no invented number and holds at any size.
  const minor = !!best && best.recoverableClicks < PARITY_MINOR_SHARE * Math.max(earned, 1);
  const pageBeatsCurve = gaps.length > 1 && earned >= predicted && minor;
  if (!best) {
    return {
      action: (page.search?.impressions90d ?? 0) >= MIN_QUERY_IMPRESSIONS ? "research_needed" : "do_nothing",
      pageUrl,
      query: null,
      recoverableClicks: 0,
      reason: "I have no searched-query data for this page yet, so I cannot tell you what a change here would do.",
    };
  }

  const scope = `"${best.query}" showed up in Google ${num(best.impressions)} times over the last 90 days and got ${num(best.clicks)} clicks at about position ${best.position.toFixed(1)}`;
  const rates = `Pages at that spot usually get ${pct(best.expectedCtr)} of the clicks and this one gets ${pct(best.actualCtr)}`;
  const clears =
    best.impressions >= MIN_QUERY_IMPRESSIONS
    && best.deficit >= MIN_CTR_DEFICIT
    && best.recoverableClicks >= MIN_RECOVERABLE_CLICKS;

  if (clears && pageBeatsCurve) {
    return {
      action: "watch",
      pageUrl,
      query: best.query,
      recoverableClicks: Math.max(0, best.recoverableClicks),
      reason: `${scope}. ${rates}, but this page\u0027s ${gaps.length} measured searches earn ${num(earned)} clicks against the ${num(predicted)} their positions predict, so I am watching that one search instead of rewriting a page that is winning.`,
    };
  }

  if (clears) {
    // The gap is real and big enough. It still does not say WHAT to change, so the
    // evidence I hold decides whether this is an action or an investigation.
    const readiness = readinessOf(page, best, index);
    const modeled = `This search earns about ${num(Math.max(0, best.recoverableClicks))} fewer clicks than pages at a similar position usually get`;
    if (!readyForAction(readiness)) {
      return {
        action: "research_needed",
        pageUrl,
        query: best.query,
        recoverableClicks: Math.max(0, best.recoverableClicks),
        readiness,
        reason: `${scope}. ${rates}. ${modeled}, and that gap is big enough to look into. ${missingSentence(readiness)}`,
      };
    }
    // Diagnosed: I hold the numbers, the page's own copy, and the live results page
    // for this exact search, so I may name the lever the evidence supports. When the
    // copy already carries the searcher's words, the words are not the problem: the
    // page ranks and gives nobody a reason to click, and the title is the lever.
    const field = fieldForGap(page, best.query);
    const cause = field
      ? `The ${fieldLabel(field)} does not carry what this search asks for`
      : "The title already carries those words, so the words are not the problem: it is not giving anyone a reason to click";
    return {
      action: "act_existing_page",
      gap: "ctr_deficit",
      pageUrl,
      query: best.query,
      recoverableClicks: best.recoverableClicks,
      readiness,
      reason: `${scope}. ${rates}. ${modeled}. ${cause}, and I have read the live results page for it, so a sharper ${fieldLabel(field ?? "title")} is the strongest supported explanation I have.`,
    };
  }

  if (best.deficit > 0) {
    const missed = best.impressions < MIN_QUERY_IMPRESSIONS
      ? `that is too little search to act on yet (I want ${num(MIN_QUERY_IMPRESSIONS)} impressions on one query)`
      : best.deficit < MIN_CTR_DEFICIT
        ? `that gap is ${pct(best.deficit)}, under the ${pct(MIN_CTR_DEFICIT)} I act on`
        : `that is only about ${num(Math.max(0, best.recoverableClicks))} clicks, under the ${MIN_RECOVERABLE_CLICKS} I act on`;
    return {
      action: "watch",
      pageUrl,
      query: best.query,
      recoverableClicks: Math.max(0, best.recoverableClicks),
      reason: `${scope}. ${rates}, and ${missed}. I am watching it instead of making you work.`,
    };
  }

  return {
    action: "do_nothing",
    pageUrl,
    query: best.query,
    recoverableClicks: 0,
    reason: `${scope}. ${rates}, so this page is already beating what its position usually earns. Leave it alone.`,
  };
}

/** The gap a new-page topic answers, from the same basis its label comes from. */
function newPageGap(basis: NewPageOpportunity["basis"]): DecisionCandidate["gap"] {
  return basis === "search_volume" ? "serp_mismatch" : "ai_gap";
}

/**
 * THE diagnosis: what the evidence justifies, page by page and topic by topic.
 * Only the two `act_` outcomes may become a proposal; the rest are the honest
 * answer and belong in the run receipt. PURE.
 */
export function compileCandidates(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): QualifiedCandidate[] {
  const expectedCtrAt = opts.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  const index = indexResearch(snapshot);
  const pages = snapshot.ownedPages.map((page) => candidateForPage(page, expectedCtrAt, index));

  const owned = ownedTopicSuppressor(snapshot);
  const topics = [...snapshot.newPageOpportunities]
    .sort((a, b) => b.demandWeight - a.demandWeight || a.topic.localeCompare(b.topic))
    .map((opp): QualifiedCandidate =>
      owned(opp.topic)
        ? {
            action: "do_nothing",
            pageUrl: null,
            query: opp.topic,
            recoverableClicks: 0,
            reason: `You already have a page about "${opp.topic}", so building a second one would put your own pages against each other.`,
          }
        : {
            action: "act_new_page",
            gap: newPageGap(opp.basis),
            pageUrl: null,
            query: opp.topic,
            // No page exists, so there is no measured click history to recover:
            // never fabricate one. New pages are capped and ranked among themselves.
            recoverableClicks: 0,
            reason: newPageHint(opp),
          });

  return [...pages, ...topics];
}

// ── candidates → the kernel's ONE input shape ────────────────────────────────

/** One honest plain-English fact per act candidate: the exact query-scope
 *  numbers the candidate measured, plus AI presence when there is any. Page
 *  totals never appear here. */
function hintsFor(page: OwnedPageEvidence, candidate: DecisionCandidate): string[] {
  const hints = [candidate.reason];
  if (page.aiCitations.count > 0) {
    hints.push(`AI answers cite this page ${page.aiCitations.count} times across ${page.aiCitations.engines.join(", ") || "AI engines"}.`);
  }
  return hints;
}

/** Build the one existing-page edit input a candidate earned, or null when the
 *  page has no copy to ground a rewrite. */
function existingEditInput(
  snapshot: EvidenceSnapshot,
  page: OwnedPageEvidence,
  candidate: DecisionCandidate,
): EvidenceInput | null {
  const content = page.content;
  const query = candidate.query ?? "";
  const field = fieldForGap(page, query);
  if (!field || !content) return null;

  return {
    tenantId: snapshot.scope.tenantId,
    page: {
      path: pathOf(page.url),
      url: absoluteUrl(page.url),
      label: content.h1 ?? content.title ?? page.url,
    },
    opportunity: {
      query,
      kind: "existing_edit",
      // A modeled gap, never a promised recovery: the label names the lever only.
      opportunityType: `Sharpen the ${fieldLabel(field)}`,
      field,
      currentValue: field === "title" ? content.title : content.metaDescription,
      intent: intentOf(query),
    },
    evidence: {
      hints: hintsFor(page, candidate),
      pageBodyText: null,
      outline: content.outline ?? [],
    },
    sizing: {
      // The ONE value scalar: the modeled click shortfall, never gross traffic.
      impactScore: candidate.recoverableClicks,
      upsidePerMonth: null,
      hasSerpVerdict: false,
    },
  };
}

/** The headline claim for a new page, matched to the receipts behind it. Never
 *  says both sources when only one produced evidence: an AI-attention topic has
 *  no measured search volume, and a volume-only topic has no AI question. */
function newPageLabel(basis: NewPageOpportunity["basis"]): string {
  if (basis === "ai_attention") return "Build a page AI keeps asking about";
  if (basis === "search_volume") return "Build a page people search for";
  return "Build a page people search for and AI asks about";
}

/** The one demand fact behind a new page, from the same basis as its label. */
function newPageHint(opp: NewPageOpportunity): string {
  if (opp.basis === "ai_attention") {
    return `AI answers keep surfacing "${opp.topic}" and competitors get cited for it while you have no page on it.`;
  }
  if (opp.basis === "search_volume") {
    return `There is real search demand for "${opp.topic}" and you have no page that answers it directly.`;
  }
  return `People search for "${opp.topic}" and AI gets asked about it too, and you have no page that answers it.`;
}

/** Build one new-page input from a NewPageOpportunity. */
function newPageInput(snapshot: EvidenceSnapshot, opp: NewPageOpportunity): EvidenceInput {
  return {
    tenantId: snapshot.scope.tenantId,
    page: { path: null, url: null, label: opp.topic },
    opportunity: {
      query: opp.topic,
      kind: "new_page",
      opportunityType: newPageLabel(opp.basis),
      intent: intentOf(opp.topic),
    },
    evidence: {
      hints: [newPageHint(opp)],
      competitorPages: opp.competitorUrls,
      fanoutQueries: opp.fanoutSeeds,
    },
    sizing: {
      // Nothing measured to recover on a page that does not exist yet.
      impactScore: 0,
      upsidePerMonth: null,
      hasSerpVerdict: opp.basis === "mixed",
    },
  };
}

/** Never propose building a page the tenant already owns. A topic that matches an
 *  owned page's own words is that page's job, and emitting a new_page as well would
 *  recommend competing with yourself for the same searches. Same relevance rule the
 *  rest of the product uses: an anchored GATE with the original 0.6 score threshold,
 *  so the account's own ubiquitous word can never be the whole overlap while a pair
 *  that DOES share a strong token keeps the calibration the threshold was tuned on.
 *  Under MIN_ANCHOR_CORPUS phrases the weak set is empty and behavior is unchanged. */
function ownedTopicSuppressor(snapshot: EvidenceSnapshot): (topic: string) => boolean {
  const ownedTopicText = snapshot.ownedPages
    .map((p) => [p.content?.title, p.content?.h1].filter(Boolean).join(" ").trim())
    .filter((t) => t.length > 0);
  const corpus = [...new Set([...ownedTopicText, ...snapshot.newPageOpportunities.map((o) => o.topic.trim())].filter(Boolean))];
  const weak = corpus.length < MIN_ANCHOR_CORPUS ? new Set<string>() : weakAnchorTokens(corpus);
  return (topic: string) =>
    ownedTopicText.some((text) => {
      if (!anchoredTopicMatch(topic, text, weak).relevant) return false;
      const v = scoreTopicMatch(topic, text);
      return v.relevant && v.score >= 0.6;
    });
}

function pathOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/";
  } catch {
    return url.startsWith("/") ? url : null;
  }
}

function absoluteUrl(url: string): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

/**
 * Map the candidates that EARNED an action onto the kernel's one input shape.
 * Nothing else is drafted: a watch, a do_nothing, or a research_needed never
 * becomes work. Existing-page edits come first, strongest recoverable clicks
 * first; new pages follow in demand order. Deterministic.
 */
export function candidatesToEvidenceInputs(
  snapshot: EvidenceSnapshot,
  candidates: readonly DecisionCandidate[],
): EvidenceInput[] {
  const pageByUrl = new Map(snapshot.ownedPages.map((p) => [absoluteUrl(p.url) ?? p.url, p]));
  const oppByTopic = new Map(snapshot.newPageOpportunities.map((o) => [o.topic.trim().toLowerCase(), o]));

  const existing = candidates
    .filter((c) => c.action === "act_existing_page")
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))
    .map((c) => {
      const page = pageByUrl.get(c.pageUrl ?? "");
      return page ? existingEditInput(snapshot, page, c) : null;
    })
    .filter((i): i is EvidenceInput => i != null);

  const fresh = candidates
    .filter((c) => c.action === "act_new_page")
    .map((c) => oppByTopic.get((c.query ?? "").trim().toLowerCase()))
    .filter((o): o is NewPageOpportunity => o != null)
    .map((o) => newPageInput(snapshot, o));

  return [...existing, ...fresh];
}

/**
 * Diagnose, then map: the ONE call a caller makes when it only wants the work.
 * `compileCandidates` is the call to make when the honest answer matters too.
 */
export function snapshotToEvidenceInputs(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): EvidenceInput[] {
  return candidatesToEvidenceInputs(snapshot, compileCandidates(snapshot, opts));
}

/** Which proposal path an input routes to (re-export for callers/logging). */
export function inputKind(input: EvidenceInput): ProposalKind {
  return input.opportunity.kind;
}
