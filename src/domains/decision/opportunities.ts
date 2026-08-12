/**
 * decision/opportunities: the ONE diagnosis. It answers "what does the evidence actually justify for this page"
 * BEFORE a single word is drafted, and DOING NOTHING IS THE DEFAULT ANSWER. A page is not a problem because it
 * is big: only its EXACT query rows are measured against the one click curve this repo owns, and a page earns
 * `act_existing_page` only when its best query clears all three floors in contracts.ts. Everything else is
 * `watch` (a real but sub-floor gap) or `do_nothing` (it already beats the curve), carried with the exact numbers. `recoverableClicks` is the only value scalar that leaves this module.
 *
 * A GAP IS NOT AN ACTION. A click gap proves something is wrong and never WHAT TO CHANGE, so every page that
 * clears the floors is also asked what evidence I HOLD for it (EvidenceReadiness): the exact query rows, this
 * page's current copy, and a results page observed for THAT EXACT search. AND HOLDING A RESULTS PAGE IS NOT
 * READING IT: every complete candidate goes through decision/diagnose, and only a named cause with a competing explanation ruled out becomes work.
 *
 * MODELED OPPORTUNITY, NEVER PROMISED LIFT: `recoverableClicks` is the distance to a generalized curve, so the copy never says "a sharper title is worth N clicks". PURE + deterministic. No I/O, no LLM.
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
  const impressions = Number(q.impressions), clicks = Number(q.clicks), position = q.position;
  if (!Number.isFinite(impressions) || impressions <= 0 || !Number.isFinite(clicks) || clicks < 0) return null;
  if (position == null || !Number.isFinite(position) || position <= 0) return null;
  const expectedCtr = expectedCtrAt(position), actualCtr = Math.min(1, clicks / impressions), deficit = expectedCtr - actualCtr;
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

/** What research this snapshot holds, indexed once per pass. A live results page counts for a query only under
 *  EXACT identity: a neighbouring search never vouches for the one that is losing clicks. The results
 *  themselves are carried, because holding a results page is not knowing what it says. */
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
    // A page I never READ vouches for nothing: only a fetched extract says WHY it wins. Counting bare appearances bought High confidence on unread pages.
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
    // FALSE until a page-body store exists. An outline is a list of headings, not the page's words: produce-bundle holds PAGE_BODY_TEXT = null and every receipt says
    // so, and one contract read two ways always inflated in the same direction.
    body: false,
  };
}

/** Name exactly what is missing, in the operator's words. Never a lab word. */
function missingSentence(r: EvidenceReadiness): string {
  const missing: string[] = [];
  if (!r.serp) missing.push("the live results page for that search has not been read yet");
  if (!r.ownedCopy) missing.push("this page's current title and description are not on file");
  if (!r.gsc) missing.push("there are no trustworthy search numbers for that exact search");
  return `The gap is measured but ${missing.join(", and ")}. That search is next in line for research, and a best guess now beats nothing.`;
}

/** One page's honest outcome, measured on its exact queries only. */
function candidateForPage(page: OwnedPageEvidence, expectedCtrAt: (position: number) => number, index: ResearchIndex,
  snapshot: EvidenceSnapshot, opts: CompileOptions): QualifiedCandidate {
  const pageUrl = absoluteUrl(page.url);
  const gaps = (page.search?.topQueries ?? [])
    .map((q) => measureQuery(q, expectedCtrAt))
    .filter((g): g is QueryGap => g != null);
  // Counting the weak query too, does this page already earn more clicks than its positions predict? A title
  // is ONE lever shared by every search the page serves, so chasing one soft query bets the winning ones, and
  // on a page already ahead of its curve that trade is not worth an operator's morning: the answer is watch.
  const earned = gaps.reduce((s, g) => s + g.clicks, 0);
  const predicted = gaps.reduce((s, g) => s + g.expectedCtr * g.impressions, 0);
  const best = bestGap(gaps);
  // ...but only while the soft search is SMALL next to what the page already earns: enough winners can out-sum a genuinely broken search. Measured against the page's own scale, so no number is invented.
  const minor = !!best && best.recoverableClicks < PARITY_MINOR_SHARE * Math.max(earned, 1);
  const pageBeatsCurve = gaps.length > 1 && earned >= predicted && minor;
  if (!best) {
    return {
      action: (page.search?.impressions90d ?? 0) >= MIN_QUERY_IMPRESSIONS ? "research_needed" : "do_nothing",
      pageUrl,
      query: null,
      recoverableClicks: 0,
      cause: noProblemFinding("No exact search numbers are on file for this page, so there is nothing to explain yet.",
        "no exact search numbers are on file for this page, so nothing accuses its wording"),
      reason: "No searched-query data is on file for this page yet, so what a change here would do is unknown.",
    };
  }

  // THE RAW FIGURES ARE A STATEMENT, not a sentence spoken at somebody: labelled, listed, and left to the prose
  // that follows to argue. Everything after this line stays prose, because everything after it makes a case.
  const scope = `"${best.query}": ${num(best.impressions)} views, ${num(best.clicks)} ${best.clicks === 1 ? "click" : "clicks"}, position ${best.position.toFixed(1)} (90 days)`;
  const rates = `Pages at that position usually earn ${pct(best.expectedCtr)} of the clicks; this page earns ${pct(best.actualCtr)}`;
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
      reason: `${scope}. ${rates}, but this page\u0027s ${gaps.length} measured searches earn ${num(earned)} clicks against the ${num(predicted)} their positions predict, so that one search is watched rather than rewriting a page that is winning.`,
    };
  }

  if (clears) {
    // The gap is real and big enough. It still does not say WHAT to change, so THE CAUSE LADDER is asked: every cause of a lost click, in one fixed order, each answering for itself or not considered at all.
    const readiness = readinessOf(page, best, index);
    const modeled = `This search earns about ${num(Math.max(0, best.recoverableClicks))} fewer clicks than pages at a similar position usually get`;
    // WHAT THE RESULTS PAGE ACTUALLY SAYS, asked even when I have never looked at one: "not looked yet" is itself a reading, and the ladder holds causes that need no results page at all.
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
    // ONLY the wording cause names an edit this kernel can write, and only with the evidence that draft is checked against actually in hand. Every other named cause is real work that is not a copy rewrite.
    if (cause.action === "title" && evidenceComplete(readiness) && readyForAction(diagnosis)) {
      return { action: "act_existing_page", gap: "ctr_deficit", ...common, recoverableClicks: best.recoverableClicks,
        reason: `${opening}. ${cause.explanation}` };
    }
    if (cause.action === "consolidate") return { action: "consolidate", ...common, reason: `${opening}. ${cause.explanation}` };
    // A NAMED CAUSE WITH NO EDIT BEHIND IT IS STILL AN ANSWER. It is watched, and the operator reads the cause rather than "looking into it", which is the sentence this whole ladder exists to retire.
    if (cause.cause !== "no_problem") return { action: "watch", ...common, reason: `${opening}. ${cause.explanation}` };
    return { action: "research_needed", ...common,
      reason: `${opening}, and that gap is big enough to look into. ${evidenceComplete(readiness) ? diagnosis.explanation : missingSentence(readiness)}` };
  }

  // A GAP UNDER MY CLICK FLOORS IS NOT SILENCE ABOUT THE PAGE. Those floors size a REWRITE, and an engine that
  // answered around this page or two of my own pages splitting its search are not measured in clicks. The
  // ladder costs nothing, so it is asked here too: the page is WATCHED, and its named cause opens its own door.
  const quiet = diagnoseCauses({ snapshot, page, query: best.query, coverage: opts.coverage ?? null, measuringPagePaths: opts.measuringPagePaths,
    serpRead: diagnoseCandidate({ query: best.query, ownedUrl: pageUrl, body: false, gscPosition: best.position,
      organic: index.serpByQuery.get(canonicalQueryKey(best.query)) ?? null }) });
  const watched = (fallback: CauseFinding, reason: string): QualifiedCandidate => ({ action: "watch", pageUrl, query: best.query,
    recoverableClicks: Math.max(0, best.recoverableClicks), cause: quiet.cause === "no_problem" ? fallback : quiet,
    reason: quiet.cause === "no_problem" ? reason : `${reason} ${quiet.explanation}` });

  if (best.deficit > 0) {
    // ONE SHAPE FOR EVERY BELOW-BAR SEARCH: the bar IS all three floors at once, so the sentence says what this search is worth in the one unit an operator plans in rather than in three.
    const missed = `that search is worth about ${num(Math.max(0, best.recoverableClicks))} ${Math.max(0, best.recoverableClicks) === 1 ? "click" : "clicks"}, under the ${MIN_RECOVERABLE_CLICKS} clicks on ${num(MIN_QUERY_IMPRESSIONS)} searches that earn a change`;
    return watched(noProblemFinding("The gap on that search is real and smaller than the size worth a change, so no cause is named for it yet.",
      "the gap is under the size where changing this page's wording would be worth your morning"),
    `${scope}. ${rates}, and ${missed}. Watching it rather than asking for work.`);
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
 * THE diagnosis: what the evidence justifies, page by page. Only `act_existing_page` may become a proposal; the rest are the honest answer and belong in the run receipt. PURE.
 */
export function compileCandidates(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): QualifiedCandidate[] {
  const expectedCtrAt = opts.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  const index = indexResearch(snapshot);
  // A row I hold NOTHING about is not a page I judged: a bare path fragment with no copy and no search data is a crawl artifact, and counting it as "do nothing" reports a judgment I never made.
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
    page: { path: pathOf(page.url), url: absoluteUrl(page.url), label: content.h1 ?? content.title ?? page.url },
    // A modeled gap, never a promised recovery: the label names the lever only.
    opportunity: { query, kind: "existing_edit", opportunityType: "Sharpen the title", field: "title",
      currentValue: content.title, intent: intentOf(query) },
    evidence: { hints: hintsFor(page, candidate), pageBodyText: null, outline: content.outline ?? [], diagnosis },
    // The ONE value scalar: the modeled click shortfall, never gross traffic.
    sizing: { impactScore: candidate.recoverableClicks, upsidePerMonth: null },
  };
}

function pathOf(url: string): string | null {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"; } catch { return url.startsWith("/") ? url : null; }
}
const absoluteUrl = (url: string): string | null => (!url ? null : url.startsWith("http") ? url : `https://${url}`);

/**
 * Map the candidates that EARNED an action onto the kernel's one input shape.
 * Nothing else is drafted: a watch, a do_nothing, or a research_needed never becomes work. Strongest recoverable clicks first. Deterministic.
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
 * Diagnose, then map: the ONE call a caller makes when it only wants the work. `compileCandidates` is the call to make when the honest answer matters too.
 */
export function snapshotToEvidenceInputs(snapshot: EvidenceSnapshot, opts: CompileOptions = {}): EvidenceInput[] {
  return candidatesToEvidenceInputs(snapshot, compileCandidates(snapshot, opts));
}
