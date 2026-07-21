/**
 * build-daily-candidates (2026-06-30) - turns Beacon's cached signals into eligible, exact,
 * one-variable daily-experiment candidates. PURE core (the live-page-facts fetch is the
 * caller's job, passed in as `facts`). Deterministic proposers only - NO LLM, NO generic
 * title templates, NO invented value props: a title proposal is a query-first REORDER of the
 * page's OWN title (drop filler), an H1 proposal aligns the H1 to the query it ranks for, a
 * meta proposal fires only when meta is genuinely MISSING (built from the on-page H1). If
 * nothing is materially better, the page yields no candidate (honest - never forces weak work).
 *
 * Eligibility (active treatments / controls / no-lift / compound) comes from the proof ledger
 * via the experiment model, so the active animal batch + its 17 controls are excluded by
 * construction. Controls are scored from the same untreated page family.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  deriveExperimentStates,
  assessEligibility,
  actionFamilyOf,
  type ExperimentEligibility,
} from "./experiment-eligibility";
import { deriveMeasurementMaturity, detectMeasurementOverlaps } from "@/domains/proof-gsc/measurement-maturity";
import { isCalibratedVerdict } from "@/domains/proof-gsc/verdict-calibration";
import { pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import { proposeSafeAnswerBlock, buildWrittenAnswerProposal, type SafeAnswerBlockProposal } from "./safe-answer-block";
import type { DailyEvidenceBrief } from "./daily-evidence-brief";
import type { EngineGapNote } from "@/domains/ai-visibility/candidate-feed";
import { expectedCtrAt } from "./pick-expectations";
import { findRefreshCandidates } from "@/domains/refresh/refresh-candidates";
import type { RefreshBrief } from "@/domains/refresh/refresh-brief";
import { findSeasonalCandidates } from "@/domains/seasonal/seasonal-candidates";
import type { PeakCalendarEntry } from "@/domains/seasonal/seasonality";

export type PageFacts = {
  title: string | null;
  meta: string | null;
  h1: string | null;
  /** The page's first substantive paragraph - the factual source for a safe meta. */
  openingParagraph?: string | null;
  /** Full body_paragraph_sample (document order) - source for internal-link + answer-block levers. */
  bodyParagraphs?: string[];
  /** Normalized paths this page ALREADY links to (the internal-link duplicate guard). */
  internalLinkPaths?: string[];
  /** Snapshot crawl timestamp - recorded on the answer-block receipt for freshness traceability. */
  snapshotFetchedAt?: string;
};

export type GscPageInput = {
  url: string;
  pageLabel: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  topQuery: string;
  topQueryImpressions: number;
  topQueryPosition: number;
  topQueryCtr: number;
  ownership: number; // 0..1
};

export type SuggestedControl = {
  url: string;
  score: number;
  why: string;
  impressionsRatio: number;
  positionDifference: number;
  pageFamilyMatch: boolean;
};

export type BuiltCandidate = DailyCandidate & {
  pageLabel: string;
  leverField: "title" | "meta" | "h1" | "internal_link" | "answer_block" | "refresh" | "seasonal_prep";
  currentText: string;
  proposedText: string;
  whyNow: string;
  rollbackText: string;
  eligibility: ExperimentEligibility;
  suggestedControls: SuggestedControl[];
  enoughControls: boolean;
  /** Internal-link only: pages this experiment INFLUENCES (the destination receives authority). */
  influencedUrls?: string[];
  /** Internal-link only: the exact anchor/destination/placement receipt. */
  linkDetail?: InternalLinkProposal;
  /** Answer-block only: the exact source sentence, placement, operation + factual-safety receipt. */
  answerDetail?: SafeAnswerBlockProposal;
  /** Who wrote proposedText: the deterministic proposer, or the LLM (slice D). Defaults deterministic. */
  draftSource?: "deterministic" | "llm";
  /** LLM-only: one plain-English line on why this wording (shown as "Beacon wrote this" context). */
  llmRationale?: string;
  /** Slice E: the keyword-research evidence ("how we know") - the page's top searches + their cached
   *  DataForSEO demand. Attached by the caller (build-today-preview) from a $0 cached read; absent when
   *  no cached demand exists for the page. */
  evidenceBrief?: DailyEvidenceBrief;
  /** R1: the specialist team's debate for this pick (named voices, objections, verdict). Attached by
   *  the caller from the page's EvidencePacket; absent when the team abstained (no packet). */
  teamReview?: import("./team-review").TeamReview;
  /** Item 4 (AI engines nightly): this page already wins on one AI engine for a tracked question but
   *  not on others - the change also aims at that per-engine gap. Deterministic, from the nightly
   *  4-engine poll's diff; absent when no fresh gap touches this page. */
  engineGap?: { promptText: string; citedEngines: string[]; missingEngines: string[] };
  /** Item 51 (weekly strategy review): this week's signed lever-mix weight for this pick's
   *  action family, when the Sunday review produced a non-neutral one. Attached by the caller
   *  (build-today-preview.ts) so the card can say "this week's plan leans into answer blocks -
   *  they have been winning here." Absent when no fresh mix exists or the weight is neutral (1). */
  strategyMixTag?: { family: string; weight: number; reason: string };
  /** Item 56 (refresh production line): refresh-only - the evidence brief behind a "this page
   *  is fading, add the missing section" candidate (the new queries no H2 answers, the queries
   *  it is losing, the winner's newer section). Absent on every other lever. */
  refreshDetail?: { briefSentences: string[]; clicksLostPerMonth: number };
  /** Item 63 (seasonality engine): seasonal_prep-only - the peak calendar entry behind a
   *  "this window opens in N weeks" candidate (data-derived cluster label, confidence,
   *  peak months). Absent on every other lever. */
  seasonalDetail?: { clusterLabel: string; confidence: PeakCalendarEntry["confidence"]; peakMonths: number[]; weeksOut: number };
};

// CTR curve lives in pick-expectations (items 34/61 share it); alias keeps call sites unchanged.
const expectedCtr = expectedCtrAt;

// "verb + the" is consumed TOGETHER ("Discover the Most Popular X" → "Most Popular X", never the
// broken "the Most Popular X"). A BARE leading article ("The Best Restaurants in Florida") is NOT
// filler - stripping it isn't materially better and risks grammar - so it's deliberately absent.
const FILLER_LEAD = /^(meet the|meet|discover the|discover|explore the|explore|learn all about the|learn all about|learn about the|learn about|all about the|all about|guide to the|guide to|complete guide to|your guide to)\s+/i;

/** Drop a filler lead only when the remainder is a clean, capitalized, query-first phrase. This is
 *  unambiguously materially-better (query-first, no info loss, reversible). We deliberately do NOT
 *  prepend a synonym query (would change the page's subject - "Mongol Empire Flag" must not become
 *  "Genghis Khan Flag") nor replace a good bespoke title (would destroy "Top 20 Most Famous Iranian
 *  Directors"), nor strip a bare article. Returns null unless a clean filler-drop applies. */
function dropFillerLead(current: string | null): string | null {
  if (!current) return null;
  const stripped = current.replace(FILLER_LEAD, "").trim();
  if (stripped === current.trim() || stripped.length < 4) return null; // nothing dropped / too short
  if (!/^[A-Z0-9"'(]/.test(stripped)) return null; // must start clean (no lowercase remainder like "the Most…")
  return stripped;
}
function proposeTitle(currentTitle: string | null, _query: string): string | null {
  return dropFillerLead(currentTitle);
}
function proposeH1(currentH1: string | null, _query: string): string | null {
  return dropFillerLead(currentH1);
}


type Proposal = {
  leverField: "title" | "meta" | "h1" | "internal_link" | "answer_block";
  actionType: string;
  proposed: string;
  current: string;
  source?: string;
  link?: InternalLinkProposal;
  answer?: SafeAnswerBlockProposal;
  /** The query the change actually serves (may differ from the GSC top query - e.g. an evergreen
   *  answer block targeting "chaharshanbe suri" when GSC's top query was "chaharshanbe suri 2026"). */
  displayQuery?: string;
  /** "llm" when the proposed text was WRITTEN by the LLM (D-2 answer gaps), so the card flags it. */
  draftSource?: "deterministic" | "llm";
};
function chooseProposal(
  facts: PageFacts,
  query: string,
  sourcePath: string,
  label: string,
  destinations: LinkDestination[],
  writtenAnswer?: { text: string; question: string },
): Proposal | null {
  // Lever priority: META (highest-yield) → INTERNAL LINK (exact, reversible) → ANSWER BLOCK
  // (extractive, surfaces a buried answer) → filler-drop title/H1. Different pages naturally take
  // different levers → a real mix; answer-block is last among the safe levers (highest factual risk).
  const m = proposeSafeMeta({ currentMeta: facts.meta, openingParagraph: facts.openingParagraph, query });
  if (m) return { leverField: "meta", actionType: "edit_meta", proposed: m.proposed, current: facts.meta ?? "(none)", source: m.source };
  if (destinations.length > 0 && (facts.bodyParagraphs?.length ?? 0) > 0) {
    const link = proposeSafeInternalLink({
      sourcePath, sourceParagraphs: facts.bodyParagraphs ?? [],
      sourceLinkedPaths: new Set(facts.internalLinkPaths ?? []), destinations,
      sourceQuery: query, sourceLabel: label, // intent-fit gate: reject off-topic links
    });
    if (link) return { leverField: "internal_link", actionType: "add_internal_link", proposed: link.exactReplacementText, current: link.exactSourceText, link };
  }
  if ((facts.bodyParagraphs?.length ?? 0) > 0) {
    const a = proposeSafeAnswerBlock({ label, h1: facts.h1, topQuery: query, bodyParagraphs: facts.bodyParagraphs ?? [], fetchedAt: facts.snapshotFetchedAt });
    if (a) {
      // Year-intent fallback: an extractive evergreen answer can't carry a date the page lacks, so
      // when the GSC query has a year the answer doesn't contain, serve (+ measure) the evergreen intent.
      const yr = query.match(/\b20\d{2}\b/)?.[0];
      const displayQuery = yr && !a.answerText.includes(yr) ? query.replace(/\s*\b20\d{2}\b\s*/g, " ").replace(/\s+/g, " ").trim() : query;
      return { leverField: "answer_block", actionType: "add_answer_block", proposed: a.answerText, current: `(buried in paragraph ${a.paragraphIndex + 1})`, answer: a, displayQuery };
    }
    // D-2: no extractive answer, but the LLM WROTE one for this gap (grounded + firewalled upstream).
    // Emit an add-a-new-answer-line candidate the operator approves before it goes live.
    if (writtenAnswer) {
      const wa = buildWrittenAnswerProposal({ question: writtenAnswer.question, writtenText: writtenAnswer.text, fetchedAt: facts.snapshotFetchedAt });
      return { leverField: "answer_block", actionType: "add_answer_block", proposed: wa.answerText, current: "(no answer at the top of the page yet)", answer: wa, draftSource: "llm" };
    }
  }
  const t = proposeTitle(facts.title, query);
  if (t) return { leverField: "title", actionType: "edit_title", proposed: t, current: facts.title ?? "" };
  const h = proposeH1(facts.h1, query);
  if (h) return { leverField: "h1", actionType: "edit_h1", proposed: h, current: facts.h1 ?? "" };
  return null;
}

function scoreControl(treated: GscPageInput, control: GscPageInput): SuggestedControl {
  const impressionsRatio = treated.impressions > 0 ? control.impressions / treated.impressions : 0;
  const positionDifference = Math.abs(control.position - treated.position);
  const familyMatch = pageFamilyOf(control.url) === pageFamilyOf(treated.url);
  // 1 = perfect; penalize impression-scale mismatch + position gap; reward family match.
  const impScore = 1 - Math.min(1, Math.abs(Math.log10((control.impressions + 1) / (treated.impressions + 1))));
  const posScore = 1 - Math.min(1, positionDifference / 10);
  const score = Number(((impScore * 0.4 + posScore * 0.4 + (familyMatch ? 0.2 : 0)) || 0).toFixed(3));
  return {
    url: control.url, score, impressionsRatio: Number(impressionsRatio.toFixed(2)), positionDifference: Number(positionDifference.toFixed(1)),
    pageFamilyMatch: familyMatch,
    why: `${familyMatch ? "same family" : "cross-family"}, ~${Math.round(control.impressions)} impr, pos ${control.position.toFixed(1)}`,
  };
}

/**
 * E-39 D3 (adaptive control pools, operator-approved 2026-07-10): 2 is the
 * MINIMUM DEFENSIBLE fallback (a real diff-in-diff needs at least two comparison
 * pages - one comparator is "treated minus one arbitrary page", not a control
 * group; this mirrors measure.ts's MIN_CONTROLS_FOR_COMPUTED and
 * natural-controls.ts's minControlsForComputed). 3 comparison pages are what a
 * HIGH-confidence read requires (measure.ts MIN_CONTROLS_FOR_HIGH /
 * natural-controls.ts minControlsForHighConfidence), so the suggestion pool is
 * capped at 3 below - we STOP recording 5-control ships. Fewer than 2 defensible
 * comparison pages does NOT freeze the operator out: assessEligibility admits it
 * with an `insufficient_controls` caution and the measurement reads at a lower
 * confidence tier (weak_estimate), never a fabricated clean result.
 */
export const MIN_CONTROLS = 2;
/** E-39 D3: cap the comparison-page pool at 3 (the count a HIGH-confidence read
 *  needs). More than 3 adds no confidence and over-reserves scarce clean pages. */
export const MAX_CONTROLS = 3;

/** The conservative Google rank a seasonal prep is forecast to reach once the page is ready
 *  ahead of the wave. A seasonal prep is speculative (the page has no current rank on the
 *  seasonal query yet), so we assume a modest position-8 finish rather than a top-3 win, then
 *  read that position's CTR off the shared curve to turn the window's IMPRESSIONS into an honest
 *  CLICKS estimate for ctrOpportunityClicks. Deliberately conservative so a seasonal card never
 *  outweighs a real, currently-ranking title fix in the nightly score. */
export const SEASONAL_TARGET_POSITION = 8;

export function buildDailyCandidates(input: {
  tenantId: string;
  pages: GscPageInput[];
  facts: Map<string, PageFacts>;
  proofLedger: ShippedChangeRecord[];
  /** Eligible link destinations (caller marks protected/active pages ineligible). Omit to disable
   *  the internal-link lever (meta-only). */
  linkDestinations?: LinkDestination[];
  /** D-2: per-page LLM-written answers for pages with an answer GAP (keyed by page url). The caller
   *  (build-today-preview) computes these async; a page here emits an add-a-written-answer candidate
   *  when no extractive answer exists. Omit to disable LLM answer-writing (extractive-only). */
  writtenAnswersByUrl?: Map<string, { text: string; question: string }>;
  /** Item 4: per-page AI-engine gap notes keyed by NORMALIZED PATH (see gapPathKey in
   *  ai-visibility/candidate-feed.ts). Bounded by the caller (max 3/night). A matching page's
   *  candidate carries the gap + its "why now" gains the gap sentence. Omit to disable. */
  engineGapsByUrl?: Map<string, EngineGapNote>;
  /** Item 56: last night's ranked refresh queue (fading pages + evidence briefs, a $0 store
   *  read by the caller). Bounded to MAX_REFRESH_CANDIDATES_PER_NIGHT (2) refresh candidates
   *  per night, decayed-winners-first. Omit to disable (byte-identical batches). */
  refreshQueue?: RefreshBrief[];
  /** Item 63: the tenant's peak calendar (seasonal windows, some upgraded to 'proven' by the
   *  Labs historical-volume cross-check), a $0 store read by the caller. Bounded to
   *  MAX_SEASONAL_CANDIDATES_PER_NIGHT (2) seasonal-window candidates per night, entries whose
   *  peak opens 6-8 weeks out only. Omit to disable (byte-identical batches). */
  peakCalendar?: PeakCalendarEntry[];
  now?: Date;
}): BuiltCandidate[] {
  const now = input.now ?? new Date();
  const states = deriveExperimentStates(input.proofLedger, now);
  const linkDestinations = input.linkDestinations ?? [];

  // The untreated/uncontrolled pool that controls can be drawn from.
  const cleanPool = input.pages.filter((p) => {
    const st = states.get(p.url.replace(/^https?:\/\/[^/]+/, "") || "/");
    return !st || (st.activeTreatments.length === 0 && st.activeControlAssignments.length === 0);
  });

  const out: BuiltCandidate[] = [];
  for (const p of input.pages) {
    const facts = input.facts.get(p.url) ?? { title: null, meta: null, h1: null };
    const sourcePath = p.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
    const proposal = chooseProposal(facts, p.topQuery, sourcePath, p.pageLabel, linkDestinations, input.writtenAnswersByUrl?.get(p.url));
    if (!proposal) continue; // nothing materially better → no candidate (honest)

    const engineGap = input.engineGapsByUrl?.get(sourcePath);
    const actionFamily = actionFamilyOf(proposal.actionType);
    // Source-query ownership only gates TEXT edits (meta/title/H1 must own the query they target).
    // An internal link's ownership is the DESTINATION owning the ANCHOR - already proven by the
    // proposer - so the source's query share is irrelevant; don't suppress valid links with it.
    const isLink = proposal.leverField === "internal_link";
    const baseExternal = { ownershipUncertain: !isLink && p.ownership < 0.12, highRisk: false };
    const baseElig = assessEligibility({ url: p.url, family: actionFamily, states, external: baseExternal });
    if (!baseElig.eligible) {
      out.push(buildCandidate(p, proposal, actionFamily, baseElig, [], baseExternal, engineGap));
      continue; // kept for the planner to report as excluded
    }

    // controls: same family first, untreated, not this page, similar scale/position.
    const controls = cleanPool
      .filter((c) => c.url !== p.url)
      .map((c) => scoreControl(p, c))
      .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
      .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
      .slice(0, MAX_CONTROLS);
    // A measurable experiment NEEDS a control anchor - re-assess so <MIN_CONTROLS flags
    // insufficient_controls (E-39 D1: admitted with a lower-confidence caution, not excluded)
    // rather than silently shipping an unmeasurable change with no caution attached.
    const external = { ...baseExternal, insufficientControls: controls.length < MIN_CONTROLS };
    const elig = assessEligibility({ url: p.url, family: actionFamily, states, external });
    out.push(buildCandidate(p, proposal, actionFamily, elig, controls, external, engineGap));
  }

  // Item 56 - REFRESH PRODUCTION LINE (additive, bounded): last night's ranked refresh queue
  // (pages losing clicks quarter over quarter + their evidence briefs) becomes at most
  // MAX_REFRESH_CANDIDATES_PER_NIGHT (2) refresh candidates, decayed-winners-first. Same
  // eligibility gate (assessEligibility over the shared `states`, family "content" via
  // actionFamilyOf("refresh_content")), same control machinery (scoreControl over the same
  // clean pool), same one-card-per-page-per-night rule as everything above. A page whose
  // brief has no concrete section target is honestly skipped (never a vague "improve this").
  // No refreshQueue input -> byte-identical batches (pinned by build-daily-candidates tests).
  const refreshQueue = input.refreshQueue ?? [];
  if (refreshQueue.length > 0) {
    const refreshFamily = actionFamilyOf("refresh_content"); // -> "content"
    const refreshEligibility = new Map<string, ExperimentEligibility>();
    for (const b of refreshQueue) {
      const path = b.page.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
      refreshEligibility.set(path, assessEligibility({ url: b.page, family: refreshFamily, states }));
    }
    const alreadyProposedPaths = new Set(
      out.map((c) => c.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/"),
    );
    const inputByPath = new Map(
      input.pages.map((p) => [p.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/", p]),
    );
    for (const seed of findRefreshCandidates({ queue: refreshQueue, eligibility: refreshEligibility, alreadyProposedPaths })) {
      const seedPath = seed.page.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
      // Prefer the batch's own fresh 90d GSC numbers for this page; a decayed page that fell
      // out of the normal candidate band still gets honest quarter-window numbers from the rank.
      const known = inputByPath.get(seedPath);
      const treated: GscPageInput = known ?? {
        url: seed.page,
        pageLabel: (seedPath.split("/").filter(Boolean).at(-1) ?? "this page").replace(/[-_]+/g, " "),
        impressions: seed.currentImpressions,
        clicks: seed.currentClicks,
        ctr: seed.currentImpressions > 0 ? seed.currentClicks / seed.currentImpressions : 0,
        position: seed.currentPosition,
        topQuery: seed.targetQuery,
        topQueryImpressions: seed.currentImpressions,
        topQueryPosition: seed.currentPosition,
        topQueryCtr: seed.currentImpressions > 0 ? seed.currentClicks / seed.currentImpressions : 0,
        ownership: 1, // a refresh serves the whole page, not one query's share
      };
      const controls = cleanPool
        .filter((c) => c.url !== treated.url)
        .map((c) => scoreControl(treated, c))
        .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
        .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
        .slice(0, MAX_CONTROLS);
      const external = { highRisk: false, insufficientControls: controls.length < MIN_CONTROLS };
      const elig = assessEligibility({ url: seed.page, family: refreshFamily, states, external });
      out.push({
        url: seed.page,
        pageLabel: treated.pageLabel,
        pageFamily: pageFamilyOf(seed.page),
        actionFamily: refreshFamily,
        targetQuery: seed.targetQuery,
        impressions: treated.impressions,
        position: treated.topQueryPosition,
        ctr: treated.topQueryCtr,
        ownership: treated.ownership,
        // The refresh forecast IS the fade: winning back what the page already earned. seed.clicksLostPerMonth
        // is already a MONTHLY figure (decay-queue divides the quarter loss by 3). But the ctrOpportunityClicks
        // contract every other lever honors is a 90-DAY clicks number, which pick-expectations divides by 3 to
        // get monthly. So feed the QUARTERLY figure here (monthly x 3) and the downstream /3 restores the true
        // monthly - matching this same card's own "down about N clicks a month" line instead of undercounting it 3x.
        ctrOpportunityClicks: seed.clicksLostPerMonth * 3,
        effortMinutes: 15,
        external,
        leverField: "refresh",
        currentText: "(the page has no section answering this yet)",
        proposedText: seed.proposedHeading,
        whyNow: seed.whyNow,
        rollbackText: "Remove the new section; the page returns to its previous state.",
        eligibility: elig,
        suggestedControls: controls,
        enoughControls: controls.length >= MIN_CONTROLS,
        refreshDetail: { briefSentences: seed.briefSentences, clicksLostPerMonth: seed.clicksLostPerMonth },
      });
    }
  }

  // Item 63 - SEASONALITY ENGINE (additive, bounded): the tenant's peak calendar becomes at
  // most MAX_SEASONAL_CANDIDATES_PER_NIGHT (2) seasonal-window candidates, soonest-window-first,
  // for entries whose peak opens 6-8 weeks out (findSeasonalCandidates's own lead-window gate).
  // Same eligibility gate (assessEligibility over the shared `states`, family "content" via
  // actionFamilyOf("refresh_content") - a seasonal prep is content work like a refresh), same
  // control machinery (scoreControl over the same clean pool), same one-card-per-page-per-night
  // rule as everything above (a page the refresh queue already claimed tonight is skipped here).
  // A calendar entry with no known top page is honestly skipped (never a vague "prep for this").
  // No peakCalendar input -> byte-identical batches (pinned by build-daily-candidates tests).
  const peakCalendar = input.peakCalendar ?? [];
  if (peakCalendar.length > 0) {
    const seasonalFamily = actionFamilyOf("refresh_content"); // -> "content"
    const seasonalEligibility = new Map<string, ExperimentEligibility>();
    for (const c of peakCalendar) {
      if (!c.topPage) continue;
      const path = c.topPage.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
      seasonalEligibility.set(path, assessEligibility({ url: c.topPage, family: seasonalFamily, states }));
    }
    const alreadyProposedPaths = new Set(
      out.map((cand) => cand.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/"),
    );
    const inputByPath = new Map(
      input.pages.map((p) => [p.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/", p]),
    );
    for (const seed of findSeasonalCandidates({ calendar: peakCalendar, eligibility: seasonalEligibility, alreadyProposedPaths, now })) {
      const seedPath = seed.page.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
      const known = inputByPath.get(seedPath);
      const treated: GscPageInput = known ?? {
        url: seed.page,
        pageLabel: (seedPath.split("/").filter(Boolean).at(-1) ?? "this page").replace(/[-_]+/g, " "),
        impressions: seed.expectedImpressions,
        clicks: 0,
        ctr: 0,
        position: 0,
        topQuery: seed.targetQuery,
        topQueryImpressions: seed.expectedImpressions,
        topQueryPosition: 0,
        topQueryCtr: 0,
        ownership: 1, // a seasonal prep serves the whole page, not one query's share
      };
      const controls = cleanPool
        .filter((c) => c.url !== treated.url)
        .map((c) => scoreControl(treated, c))
        .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
        .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
        .slice(0, MAX_CONTROLS);
      const external = { highRisk: false, insufficientControls: controls.length < MIN_CONTROLS };
      const elig = assessEligibility({ url: seed.page, family: seasonalFamily, states, external });
      out.push({
        url: seed.page,
        pageLabel: treated.pageLabel,
        pageFamily: pageFamilyOf(seed.page),
        actionFamily: seasonalFamily,
        targetQuery: seed.targetQuery,
        impressions: treated.impressions,
        position: treated.topQueryPosition,
        ctr: treated.topQueryCtr,
        ownership: treated.ownership,
        // The seasonal forecast is the wave itself, stated in CLICKS not impressions. seed.expectedImpressions
        // is a raw IMPRESSIONS count for the peak window; every other lever fills ctrOpportunityClicks with a
        // real CLICKS number, and pick-expectations divides it by 3 to get monthly clicks. So convert the
        // window's impressions to an honest clicks estimate at a conservative target rank (SEASONAL_TARGET_POSITION)
        // using the same CTR-by-position curve the rest of the batch uses. This keeps the forecast a truthful
        // clicks range (not a ~1/CTR-inflated impressions count) AND keeps the score/power-check spine bounded so
        // a seasonal prep never dominates a real title fix. The raw impressions still ride the whyNow reach line,
        // where they are already labeled "impressions in that window".
        ctrOpportunityClicks: Math.round(seed.expectedImpressions * expectedCtrAt(SEASONAL_TARGET_POSITION)),
        effortMinutes: 15,
        external,
        leverField: "seasonal_prep",
        currentText: "(no change to the page yet, this is a heads-up to prep before the window)",
        proposedText: `Prep "${seed.clusterLabel}" content before the window opens in about ${seed.weeksOut} weeks.`,
        whyNow: seed.whyNow,
        rollbackText: "No page change was made yet; nothing to roll back.",
        eligibility: elig,
        suggestedControls: controls,
        enoughControls: controls.length >= MIN_CONTROLS,
        seasonalDetail: {
          clusterLabel: seed.clusterLabel,
          confidence: seed.confidence,
          peakMonths: seed.peakMonths,
          weeksOut: seed.weeksOut,
        },
      });
    }
  }
  return out;
}

function buildCandidate(
  p: GscPageInput,
  proposal: Proposal,
  actionFamily: ReturnType<typeof actionFamilyOf>,
  elig: ExperimentEligibility,
  controls: SuggestedControl[],
  external: { ownershipUncertain?: boolean; highRisk?: boolean; insufficientControls?: boolean },
  engineGap?: EngineGapNote,
): BuiltCandidate {
  const ctrOpportunityClicks = Math.max(0, expectedCtr(p.topQueryPosition) - p.topQueryCtr) * p.topQueryImpressions;
  const link = proposal.link;
  const answer = proposal.answer;
  const baseWhyNow = link
    ? `This page mentions "${link.anchorText}" (a page owned by ${link.destinationLabel}) without linking to it, a ${link.relationship.replace(/_/g, " ")} link that helps both pages. This page already ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}".`
    : answer
      ? answer.operation === "add_new_text"
        ? `Google shows this page for "${p.topQuery}" (${p.topQueryImpressions} times a month) but this page has no direct answer at the top. Beacon wrote one for you to review before it goes live. The page ranks #${p.topQueryPosition.toFixed(1)}, so leading with the answer should win more of those clicks.`
        : `People search "${answer.question}" and this page already answers it, but the answer is buried in paragraph ${answer.paragraphIndex + 1}. Moving that exact sentence to the top is what earns the click. It ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}".`
      : `This page ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}" (shown on Google ${p.topQueryImpressions} times a month) but only ${(p.topQueryCtr * 100).toFixed(1)}% click. The ${proposal.leverField === "meta" ? "description" : proposal.leverField} is the weak link, so a sharper one should win more of those clicks.`;
  // Item 4: when the nightly 4-engine poll found this page cited by one AI engine but
  // absent on others, the card says so - the change aims at that gap too.
  const whyNow = engineGap ? `${baseWhyNow} ${engineGap.sentence}` : baseWhyNow;
  return {
    url: p.url,
    pageLabel: p.pageLabel,
    pageFamily: pageFamilyOf(p.url),
    actionFamily,
    targetQuery: proposal.displayQuery ?? p.topQuery,
    impressions: p.impressions,
    position: p.topQueryPosition,
    ctr: p.topQueryCtr,
    ownership: p.ownership,
    ctrOpportunityClicks,
    effortMinutes: link || answer ? 3 : 1,
    external,
    leverField: proposal.leverField,
    currentText: proposal.current,
    proposedText: proposal.proposed,
    whyNow,
    rollbackText: answer ? answer.rollbackInstruction : proposal.current,
    eligibility: elig,
    suggestedControls: controls,
    enoughControls: controls.length >= MIN_CONTROLS,
    influencedUrls: link ? [link.destinationPath] : undefined,
    linkDetail: link,
    answerDetail: answer,
    draftSource: proposal.draftSource,
    engineGap: engineGap
      ? { promptText: engineGap.promptText, citedEngines: engineGap.citedEngines, missingEngines: engineGap.missingEngines }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Safe meta (2026-06-30; merged from safe-meta.ts 2026-07-21) - the
// highest-yield, clearly-safe daily lever. Non-animal pages mostly have good
// query-aligned TITLES but TEMPLATED/generic METAS ("Learn about the History of
// Iran Flags and the X Flag... Discover its symbolism..."). The safe meta is NOT
// invented: it's derived from the page's OWN opening paragraph, trimmed to a
// clean ~155-char snippet, and only when that paragraph actually addresses the
// target query. PURE, deterministic, no LLM, no fabrication. If the page text
// doesn't support a better meta -> emit nothing (never force).
// ---------------------------------------------------------------------------

const FILLER_META_LEAD = /^\s*(learn (all )?about|discover|explore|everything you need|all about|welcome to|read (all )?about|find out|complete guide|the complete guide|your (complete )?guide|ultimate guide)/i;
const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "with", "is", "are", "as", "at", "by", "its", "their"]);
const stem = (t: string): string => (t.length > 3 ? t.replace(/s$/, "") : t);
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t)).map(stem);
}
/** Most of the query's content tokens appear in the text (>= 60%). */
function containsQuery(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  const q = tokens(query);
  if (q.length === 0) return false;
  const t = new Set(tokens(text));
  const hit = q.filter((tok) => t.has(tok)).length;
  return hit / q.length >= 0.6;
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const MIN_META = 80;
const MAX_META = 160;

/** A meta is WEAK (worth replacing) when it's missing, too short, marketing-filler-led, or
 *  doesn't even contain the target query. A bespoke meta that already carries the query is left
 *  alone. */
export function metaIsWeak(currentMeta: string | null | undefined, query: string): boolean {
  const m = (currentMeta ?? "").trim();
  if (m.length < 40) return true;
  if (FILLER_META_LEAD.test(m)) return true;
  if (!containsQuery(m, query)) return true;
  return false;
}

/** Trim text to a clean meta: prefer ending on a sentence boundary <= MAX, else a word boundary. */
function trimToMeta(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_META) return clean;
  const window = clean.slice(0, MAX_META);
  const lastSentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentence >= MIN_META) return window.slice(0, lastSentence + 1).trim();
  const lastSpace = window.lastIndexOf(" ");
  return window.slice(0, lastSpace > MIN_META ? lastSpace : MAX_META).trim();
}

export type SafeMetaProposal = { proposed: string; sourceText: string; source: "page_opening_paragraph" };

/**
 * Propose a safe, factual meta from the page's own opening paragraph. PURE. Returns null when:
 * the current meta is already strong; there's no opening paragraph to source from; the opening
 * doesn't address the query (don't fabricate); or the result isn't materially better.
 */
export function proposeSafeMeta(input: {
  currentMeta: string | null | undefined;
  openingParagraph: string | null | undefined;
  query: string;
}): SafeMetaProposal | null {
  if (!metaIsWeak(input.currentMeta, input.query)) return null; // current meta is fine
  const opening = (input.openingParagraph ?? "").trim();
  if (opening.length < MIN_META) return null; // no usable factual source -> don't invent
  if (!containsQuery(opening, input.query)) return null; // page text doesn't address the query
  if (FILLER_META_LEAD.test(opening)) return null; // opening is itself boilerplate -> skip
  const proposed = trimToMeta(opening);
  if (proposed.length < MIN_META || proposed.length > MAX_META) return null;
  if (!containsQuery(proposed, input.query)) return null; // the trimmed snippet must still carry the query
  if (norm(proposed) === norm(input.currentMeta ?? "")) return null; // not merely-different
  return { proposed, sourceText: opening.slice(0, 240), source: "page_opening_paragraph" };
}

// ---------------------------------------------------------------------------
// Safe internal link (2026-06-30; merged from safe-internal-link.ts 2026-07-21)
// - the second safe daily lever. Proposes ONE exact, contextual, non-duplicative
// internal link, and ONLY when every safety condition is provable from Beacon's
// own crawl (page_snapshots). PURE, deterministic, $0, no LLM, no fabrication.
//
// The link wraps an EXISTING exact phrase in an EXISTING sentence (the
// destination's own entity name appearing in the source's body) - it never adds
// a sentence, never invents text, never uses a generic anchor ("click here"),
// never links a page to itself or to a page it already links. An internal link
// influences TWO pages (source receives it; destination receives authority), so
// the caller must mark protected/active destinations ineligible BEFORE calling
// buildLinkDestinations - a link is only ever proposed to a destination flagged
// `eligible`.
// ---------------------------------------------------------------------------

/** Normalize any URL (relative or absolute, www or not, trailing slash, query/hash) to a path key. */
export function toLinkPath(u: string | null | undefined): string {
  if (!u) return "";
  const noHost = u.replace(/^https?:\/\/[^/]+/i, "");
  return (noHost.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
}

const GENERIC_TOKEN = new Set([
  "iran", "iranian", "persian", "flag", "flags", "rug", "rugs", "the", "of", "and", "a", "an",
  "history", "guide", "page", "pages", "names", "food", "city", "cities", "best", "top", "list", "all",
  // site-chrome / connector filler (an H1 made only of these is navigation, not an entity)
  "related", "articles", "article", "overview", "featured", "items", "item", "additional",
  "resources", "resource", "information", "info", "content", "main", "more", "home", "about",
  "contact", "blog", "post", "posts", "news", "category", "categories", "section", "sections",
  "welcome", "explore", "discover", "shop", "store",
]);
// An anchor must not be a call-to-action phrase - those are forbidden generic anchors.
const CTA_LEAD = /^(discover|explore|learn|read|see|find|shop|click|view|visit|check|browse|get|buy)\b/i;

/** A destination's distinctive entity phrase (its own H1, else its slug label), 2-4 words, whose
 *  FIRST word is distinctive (not a generic topic token) and which isn't a CTA phrase. */
export function distinctiveAlias(h1: string | null | undefined, label: string): string | null {
  const consider = (raw: string | null | undefined): string | null => {
    const cand = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!cand) return null;
    const words = cand.split(" ");
    if (words.length < 2 || words.length > 4) return null;
    if (CTA_LEAD.test(cand)) return null;
    // at least one DISTINCTIVE token (not all generic) - "Persian Wolf" ok (via "wolf"), "Iran Flag" not
    if (words.every((w) => GENERIC_TOKEN.has(w.toLowerCase()))) return null;
    return cand;
  };
  return consider(h1) || consider(label.replace(/\b\w/g, (c) => c.toUpperCase()));
}

export type LinkDestination = {
  path: string; // normalized path key (for dedup)
  canonicalUrl: string; // full URL for the href / operator instructions
  label: string;
  family: string;
  alias: string; // the exact anchor phrase to look for
  eligible: boolean; // false when protected / active treatment / active control / reserved
  ineligibleReason?: string;
};

const linkFamilyOf = (path: string): string => path.split("/").filter(Boolean)[0] ?? "";

/** Build the destination registry from snapshots. `isProtected(path)` returns a reason string when a
 *  page must not RECEIVE a link (active treatment/control, reserved, or in the protected set). */
export function buildLinkDestinations(
  snapshots: Array<{ url?: string; page?: string; canonical_url?: string | null; h1?: string | null }>,
  isProtected: (path: string) => string | null,
): LinkDestination[] {
  const out: LinkDestination[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    const canonicalUrl = s.canonical_url || s.url || s.page || "";
    const path = toLinkPath(canonicalUrl);
    if (!path || path === "/" || seen.has(path)) continue;
    const label = (path.split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ").trim();
    const alias = distinctiveAlias(s.h1, label);
    if (!alias) continue;
    seen.add(path);
    const reason = isProtected(path);
    out.push({ path, canonicalUrl, label, family: linkFamilyOf(path), alias, eligible: !reason, ineligibleReason: reason ?? undefined });
  }
  return out;
}

/** Distinctive (non-generic, >2-char) tokens of a phrase - the relevance vocabulary. */
function distinctiveTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC_TOKEN.has(w)),
  );
}
/**
 * Intent-fit gate: a link is contextually valid only when the destination genuinely relates to the
 * SOURCE page. Same-family links (hub/child/sibling) are inherently contextual. A cross-family link
 * must share at least one distinctive token between the destination (its anchor/label) and the
 * source's target query OR page label - otherwise it's an off-topic link (e.g. a "Persian jewelry"
 * link on a t-shirt product page) and is rejected so the planner falls back to a relevant lever.
 */
function destinationIsRelevant(srcFamily: string, srcQuery: string, srcLabel: string, dest: LinkDestination): boolean {
  if (dest.family && dest.family === srcFamily) return true;
  const srcToks = distinctiveTokens(`${srcQuery} ${srcLabel}`);
  if (srcToks.size === 0) return true; // no source context supplied -> don't enforce (backward-compatible)
  const destToks = distinctiveTokens(`${dest.alias} ${dest.label}`);
  for (const t of destToks) if (srcToks.has(t)) return true;
  return false;
}

/** Whole-phrase, word-bounded, case-insensitive, Unicode-aware match. */
function phraseRegex(anchor: string): RegExp {
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})($|[^\\p{L}\\p{N}])`, "iu");
}

/** Split a paragraph into sentences (delimiters kept). */
function sentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+[.!?]+(\s|$)|\S[^.!?]*$/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph.trim()];
}

export type InternalLinkProposal = {
  destinationPath: string;
  destinationUrl: string;
  destinationLabel: string;
  destinationFamily: string;
  anchorText: string; // the exact matched substring (source casing preserved)
  exactSourceText: string; // the exact sentence as it appears now
  exactReplacementText: string; // the sentence with ONLY the anchor wrapped in <a>
  paragraphIndex: number;
  paragraphExcerpt: string;
  relationship: "child_to_hub" | "hub_to_child" | "sibling" | "contextual_related";
  ownershipReason: string;
  wixInstructions: string;
};

function relationshipOf(srcPath: string, dest: LinkDestination): InternalLinkProposal["relationship"] {
  const srcFam = linkFamilyOf(srcPath);
  const srcDepth = srcPath.split("/").filter(Boolean).length;
  const destDepth = dest.path.split("/").filter(Boolean).length;
  if (srcFam === dest.family) return srcDepth < destDepth ? "hub_to_child" : srcDepth > destDepth ? "child_to_hub" : "sibling";
  return "contextual_related";
}

/**
 * Propose ONE safe internal link from a source page. PURE. Returns null unless an EXACT, eligible,
 * non-duplicative, contextual link can be proven. Scans the source's real body paragraphs for the
 * first eligible destination whose distinctive alias appears as a whole phrase and isn't already
 * linked. The edit wraps that exact phrase in its exact sentence - nothing else changes.
 */
export function proposeSafeInternalLink(input: {
  sourcePath: string;
  sourceParagraphs: string[];
  sourceLinkedPaths: Set<string>; // normalized paths the source already links to
  destinations: LinkDestination[];
  sourceQuery?: string; // the source page's target query (intent-fit gate)
  sourceLabel?: string; // the source page's label (intent-fit gate)
}): InternalLinkProposal | null {
  const src = toLinkPath(input.sourcePath);
  const srcFamily = linkFamilyOf(src);
  const paras = input.sourceParagraphs.filter((p) => p && p.trim().length >= 40);
  // Eligible, non-self, not-already-linked, AND contextually relevant to this page (intent-fit gate);
  // then prefer same-family hub/child, then by alias length (more specific = safer).
  const candidates = input.destinations
    .filter((d) => d.eligible && d.path !== src && !input.sourceLinkedPaths.has(d.path))
    .filter((d) => destinationIsRelevant(srcFamily, input.sourceQuery ?? "", input.sourceLabel ?? "", d))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const d of candidates) {
    const re = phraseRegex(d.alias);
    for (let i = 0; i < paras.length; i++) {
      const para = paras[i];
      const m = re.exec(para);
      if (!m) continue;
      const matched = m[2]; // exact source casing
      // Find the exact sentence containing the match.
      const sent = sentences(para).find((s) => phraseRegex(d.alias).test(s));
      if (!sent) continue;
      // Wrap ONLY the first whole-phrase occurrence; everything else byte-identical.
      const sentRe = phraseRegex(d.alias);
      const sm = sentRe.exec(sent);
      if (!sm) continue;
      const before = sent.slice(0, sm.index + sm[1].length);
      const after = sent.slice(sm.index + sm[1].length + matched.length);
      const replacement = `${before}<a href="${d.canonicalUrl}">${matched}</a>${after}`;
      const rel = relationshipOf(src, d);
      return {
        destinationPath: d.path,
        destinationUrl: d.canonicalUrl,
        destinationLabel: d.label,
        destinationFamily: d.family,
        anchorText: matched,
        exactSourceText: sent,
        exactReplacementText: replacement,
        paragraphIndex: i,
        paragraphExcerpt: para.slice(0, 200),
        relationship: rel,
        ownershipReason: `Destination "${d.label}" owns the exact phrase "${matched}" (its page H1/title); the source mentions it in body copy without linking it.`,
        wixInstructions: `Wix CMS → open the source page body → find the sentence "${sent.slice(0, 90)}${sent.length > 90 ? "…" : ""}" → highlight "${matched}" → click Link → paste ${d.canonicalUrl}`,
      };
    }
  }
  return null;
}
