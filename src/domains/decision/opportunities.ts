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
 * missing, so nothing is ever drafted for a search I have never looked at.
 *
 * AND HOLDING A RESULTS PAGE IS NOT READING IT. Completeness is a precondition, so
 * every complete candidate then goes through decision/diagnose, which reads what that
 * page actually SAYS: where this page is displayed on it, worded how, and what recurs
 * across the results beating it. Only a named cause with a competing explanation
 * ruled out becomes work, and the cause names the field, so the old token-containment
 * pick ("the search words are not in the title, so rewrite the title") is gone.
 *
 * MODELED OPPORTUNITY, NEVER PROMISED LIFT. `recoverableClicks` is the distance to
 * a generalized curve, so the copy says "this search earns about N fewer clicks
 * than pages at a similar position usually get", never "a sharper title is worth N
 * clicks". Only a diagnosed action may name the edit as the strongest explanation.
 *
 * PURE + deterministic. No I/O, no LLM.
 */

import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { MIN_CTR_DEFICIT, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, evidenceComplete, readyForAction,
  type ActionDiagnosis, type DecisionCandidate, type EvidenceInput, type EvidenceReadiness } from "./contracts";
import { diagnoseCandidate, type DisplayedResult } from "./diagnose";
import { diagnoseCauses, noProblemFinding, type CauseFinding } from "./diagnosis";
import type { DecidedTopic } from "./coverage-pass";

/** How small a soft search must be, against the clicks the page already earns, to
 *  be watched rather than acted on when the page beats its curve overall. */
const PARITY_MINOR_SHARE = 0.1;

/** The curve the gap is measured against. Defaults to the industry curve this
 *  repo already ships; a tenant-fitted curve is passed in when one exists. */
type CompileOptions = {
  curve?: Pick<TenantCtrCurve, "expectedCtrAt">;
  /** The ONE topic this pass decided, when it decided one. It carries the settled kind of page, what
   *  people searching it want, and the reading of what the winning pages share, so the cause ladder can
   *  ask those questions of the page that verdict NAMES. Absent, those causes are simply not considered. */
  coverage?: DecidedTopic | null;
  /** The pages already carrying a change under measurement. The ladder reads exactly this fact, so a page
   *  whose last edit is still being read is watched rather than handed a second change to stack on it. */
  measuringPagePaths?: readonly (string | null)[];
};

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

// ── evidence readiness (a gap opens an investigation, evidence closes it) ─────

/** A candidate carrying what evidence the decision HOLDS and what it concluded from
 *  it. Structurally a DecisionCandidate (contracts.ts stays frozen); the extra
 *  fields are read only inside Decision, to gate drafting and to set confidence. */
export type QualifiedCandidate = DecisionCandidate & {
  readiness?: EvidenceReadiness; diagnosis?: ActionDiagnosis;
  /** THE named cause, what it beat, what would disprove it, and every cause whose evidence is not on
   *  file. Required: a page this pass judged always says WHY, even when the why is "nothing is wrong". */
  cause: CauseFinding;
};

/** What research this snapshot holds, indexed once per pass. A live results page
 *  counts for a query only under EXACT/canonical identity: a neighbouring search
 *  never vouches for the one that is losing clicks. The results themselves are
 *  carried, not just the fact that a page was bought: holding a results page is not
 *  knowing what it says, and the diagnosis has to READ it. */
type ResearchIndex = { serpByQuery: Map<string, readonly DisplayedResult[]>; winnersByQuery: Map<string, number> };
function indexResearch(snapshot: EvidenceSnapshot): ResearchIndex {
  const research = snapshot.research;
  const serpByQuery = new Map<string, readonly DisplayedResult[]>();
  for (const e of [...(research?.serpEvidence ?? [])].sort((a, b) => a.query.localeCompare(b.query))) {
    const key = canonicalQueryKey(e.query);
    if (key && !serpByQuery.has(key)) serpByQuery.set(key, e.organic);
  }
  const winnersByQuery = new Map<string, number>();
  for (const page of research?.winningPages ?? []) {
    // A page I never READ vouches for nothing: only a fetched extract says WHY it
    // wins. Counting bare appearances bought High confidence on unread pages.
    if (!page.extract) continue;
    const keys = new Set(page.appearances.map((a) => canonicalQueryKey(a.query)).filter(Boolean));
    for (const k of keys) winnersByQuery.set(k, (winnersByQuery.get(k) ?? 0) + 1);
  }
  return { serpByQuery, winnersByQuery };
}

/** What I hold for ONE page and ONE exact query. Never inferred from a neighbour. */
function readinessOf(page: OwnedPageEvidence, gap: QueryGap, index: ResearchIndex): EvidenceReadiness {
  const content = page.content;
  const key = canonicalQueryKey(gap.query);
  return {
    gsc: gap.impressions > 0 && Number.isFinite(gap.position),
    ownedCopy: !!content && !!((content.title ?? "").trim() || (content.metaDescription ?? "").trim()),
    serp: !!key && index.serpByQuery.has(key),
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
function candidateForPage(page: OwnedPageEvidence, expectedCtrAt: (position: number) => number, index: ResearchIndex,
  snapshot: EvidenceSnapshot, opts: CompileOptions): QualifiedCandidate {
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
      cause: noProblemFinding("I hold no exact search numbers for this page, so there is nothing here for me to explain yet.",
        "I hold no exact search numbers for this page, so nothing accuses its wording"),
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
      cause: noProblemFinding(`Every measured search on this page earns more clicks than its position predicts, so one soft search is not a problem with the page.`,
        "this page already earns more of the clicks than its positions predict, so its wording is costing you nothing"),
      reason: `${scope}. ${rates}, but this page\u0027s ${gaps.length} measured searches earn ${num(earned)} clicks against the ${num(predicted)} their positions predict, so I am watching that one search instead of rewriting a page that is winning.`,
    };
  }

  if (clears) {
    // The gap is real and big enough. It still does not say WHAT to change, so THE CAUSE LADDER is asked:
    // every cause of a lost click, in one fixed order, each answering for itself or not considered at all.
    const readiness = readinessOf(page, best, index);
    const modeled = `This search earns about ${num(Math.max(0, best.recoverableClicks))} fewer clicks than pages at a similar position usually get`;
    // WHAT THE RESULTS PAGE ACTUALLY SAYS, asked even when I have never looked at one: its own honest "I
    // have not looked yet" is a reading, and the ladder holds causes that need no results page at all.
    // Gating this call on complete evidence hid every one of them behind "I cannot tell you what to change".
    const diagnosis = diagnoseCandidate({
      query: best.query, ownedUrl: pageUrl,
      organic: index.serpByQuery.get(canonicalQueryKey(best.query)) ?? null, body: readiness.body,
      gscPosition: best.position,
    });
    const cause = diagnoseCauses({ snapshot, page, query: best.query, serpRead: diagnosis,
      coverage: opts.coverage ?? null, measuringPagePaths: opts.measuringPagePaths });
    const common = { pageUrl, query: best.query, readiness, diagnosis, cause,
      recoverableClicks: Math.max(0, best.recoverableClicks) };
    const opening = `${scope}. ${rates}. ${modeled}`;
    // ONLY the wording cause names an edit this kernel can write, and only with the evidence that draft is
    // checked against actually in hand. Every other named cause is real work that is not a copy rewrite.
    if (cause.action === "title" && evidenceComplete(readiness) && readyForAction(diagnosis)) {
      return { action: "act_existing_page", gap: "ctr_deficit", ...common, recoverableClicks: best.recoverableClicks,
        reason: `${opening}. ${cause.explanation}` };
    }
    if (cause.action === "consolidate") return { action: "consolidate", ...common, reason: `${opening}. ${cause.explanation}` };
    // A NAMED CAUSE WITH NO EDIT BEHIND IT IS STILL AN ANSWER. It is watched, and the operator reads the
    // cause rather than "I am looking into it", which is the sentence this whole ladder exists to retire.
    if (cause.cause !== "no_problem") return { action: "watch", ...common, reason: `${opening}. ${cause.explanation}` };
    return { action: "research_needed", ...common,
      reason: `${opening}, and that gap is big enough to look into. ${evidenceComplete(readiness) ? diagnosis.explanation : missingSentence(readiness)}` };
  }

  // A GAP UNDER MY CLICK FLOORS IS NOT SILENCE ABOUT THE PAGE. Those floors size a REWRITE, and an engine
  // that answered around this page, a comparison that named it, and two of my own pages splitting its search
  // are none of them measured in clicks. The ladder is pure and costs nothing, so it is asked here too: the
  // page is still only WATCHED, and naming its cause is what lets the deep read open on that cause's own door.
  const quiet = diagnoseCauses({ snapshot, page, query: best.query, coverage: opts.coverage ?? null, measuringPagePaths: opts.measuringPagePaths,
    serpRead: diagnoseCandidate({ query: best.query, ownedUrl: pageUrl, body: false, gscPosition: best.position,
      organic: index.serpByQuery.get(canonicalQueryKey(best.query)) ?? null }) });
  const watched = (fallback: CauseFinding, reason: string): QualifiedCandidate => ({ action: "watch", pageUrl, query: best.query,
    recoverableClicks: Math.max(0, best.recoverableClicks), cause: quiet.cause === "no_problem" ? fallback : quiet,
    reason: quiet.cause === "no_problem" ? reason : `${reason} ${quiet.explanation}` });

  if (best.deficit > 0) {
    const missed = best.impressions < MIN_QUERY_IMPRESSIONS
      ? `that is too little search to act on yet (I want ${num(MIN_QUERY_IMPRESSIONS)} impressions on one query)`
      : best.deficit < MIN_CTR_DEFICIT
        ? `that gap is ${pct(best.deficit)}, under the ${pct(MIN_CTR_DEFICIT)} I act on`
        : `that is only about ${num(Math.max(0, best.recoverableClicks))} clicks, under the ${MIN_RECOVERABLE_CLICKS} I act on`;
    return watched(noProblemFinding("The gap on that search is real and smaller than the size I act on, so I am not naming a cause for it yet.",
      "the gap is under the size where changing this page's wording would be worth your morning"),
    `${scope}. ${rates}, and ${missed}. I am watching it instead of making you work.`);
  }

  const beats = noProblemFinding("This page already earns more of the clicks than pages at its position usually get.",
    "this page already beats what its position usually earns, so its wording is costing you nothing");
  const leave = `${scope}. ${rates}, so this page is already beating what its position usually earns. Leave it alone.`;
  // Beating the curve settles the WORDING and nothing else, so a page an engine skips is still named here.
  return quiet.cause === "no_problem"
    ? { action: "do_nothing", pageUrl, query: best.query, recoverableClicks: 0, cause: beats, reason: leave }
    : watched(beats, leave);
}

/**
 * THE diagnosis: what the evidence justifies, page by page. Only
 * `act_existing_page` may become a proposal; the rest are the honest answer and
 * belong in the run receipt. PURE.
 */
export function compileCandidates(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): QualifiedCandidate[] {
  const expectedCtrAt = opts.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  const index = indexResearch(snapshot);
  // A row I hold NOTHING about is not a page I judged. 175 of this account's 398 owned
  // rows are bare path fragments with no copy and no search data (a crawl frontier
  // artifact), and counting each one as "do nothing" reported 175 judgments I never
  // made. Silence about an unknown row is honest; a tally that includes it is not.
  return snapshot.ownedPages
    .filter((p) => !!p.content || (p.search?.topQueries ?? []).length > 0 || (p.search?.impressions90d ?? 0) > 0)
    .map((page) => candidateForPage(page, expectedCtrAt, index, snapshot, opts));
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

/** Build the one existing-page edit input a DIAGNOSED candidate earned, or null.
 *  The diagnosis names the field, so no drafter is ever paid to rewrite something
 *  the evidence never accused: a candidate carrying no diagnosed edit yields null
 *  and stays an investigation. */
function existingEditInput(
  snapshot: EvidenceSnapshot,
  page: OwnedPageEvidence,
  candidate: QualifiedCandidate,
): EvidenceInput | null {
  const content = page.content;
  const query = candidate.query ?? "";
  const diagnosis = candidate.diagnosis;
  if (!content || !diagnosis || !readyForAction(diagnosis) || diagnosis.action !== "title") return null;

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
      opportunityType: "Sharpen the title",
      field: "title",
      currentValue: content.title,
      intent: intentOf(query),
    },
    evidence: {
      hints: hintsFor(page, candidate),
      pageBodyText: null,
      outline: content.outline ?? [],
      diagnosis,
    },
    sizing: {
      // The ONE value scalar: the modeled click shortfall, never gross traffic.
      impactScore: candidate.recoverableClicks,
      upsidePerMonth: null,
    },
  };
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
 * becomes work. Strongest recoverable clicks first. Deterministic.
 */
export function candidatesToEvidenceInputs(
  snapshot: EvidenceSnapshot,
  candidates: readonly QualifiedCandidate[],
): EvidenceInput[] {
  const pageByUrl = new Map(snapshot.ownedPages.map((p) => [absoluteUrl(p.url) ?? p.url, p]));
  return candidates
    .filter((c) => c.action === "act_existing_page")
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))
    .map((c) => {
      const page = pageByUrl.get(c.pageUrl ?? "");
      return page ? existingEditInput(snapshot, page, c) : null;
    })
    .filter((i): i is EvidenceInput => i != null);
}

/**
 * Diagnose, then map: the ONE call a caller makes when it only wants the work.
 * `compileCandidates` is the call to make when the honest answer matters too.
 */
export function snapshotToEvidenceInputs(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): EvidenceInput[] {
  return candidatesToEvidenceInputs(snapshot, compileCandidates(snapshot, opts));
}
