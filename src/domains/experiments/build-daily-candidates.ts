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
import { pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import { proposeSafeMeta } from "./safe-meta";
import { proposeSafeInternalLink, type LinkDestination, type InternalLinkProposal } from "./safe-internal-link";
import { proposeSafeAnswerBlock, buildWrittenAnswerProposal, type SafeAnswerBlockProposal } from "./safe-answer-block";
import type { DailyEvidenceBrief } from "./daily-evidence-brief";
import type { EngineGapNote } from "@/domains/ai-visibility/candidate-feed";
import { expectedCtrAt } from "./pick-expectations";
import { findFamilyPropagationCandidates, type FamilyPropagationCandidate } from "./family-win-propagation";

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
  leverField: "title" | "meta" | "h1" | "internal_link" | "answer_block";
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
  /** Item 29 (family win propagation): this exact lever already proved itself (a mature, positive
   *  verdict) on a sibling page in the same family, and this page is one of the bounded, ranked
   *  siblings still eligible to receive it. Absent unless a real mature win exists for this
   *  page's family + lever AND this page made the nightly cap. Deterministic, $0. */
  familyWin?: FamilyPropagationCandidate;
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

export const MIN_CONTROLS = 3;

/**
 * Item 29: which shipped records count as a real, MATURE, positive win the family-propagation
 * finder may reuse - the same honest maturity gate load-experiment-outcomes.ts uses for
 * learning eligibility (a 7/14-day early read never counts, only a settled 28-day result with
 * clean, non-overlapping attribution). No extra I/O: derived from the ledger already in hand.
 */
function matureWonRecords(records: ShippedChangeRecord[], now: Date): ShippedChangeRecord[] {
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  return records.filter((r) => {
    const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    const maturity = deriveMeasurementMaturity({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: null, // not consulted for the mature/non-mature decision
      windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: basisWin?.controlsUsed ?? 0,
      baselineImpressions: r.baseline?.impressions ?? 0,
      overlap: overlaps.get(r.id) ?? null,
      live: true,
    });
    return maturity === "mature_result" && r.verdict === "won";
  });
}

/** Item 29: every actionType already shipped per page path - the explicit "already has this
 *  lever" guard on top of the ledger's own eligibility gate. */
function shipsByPath(records: ShippedChangeRecord[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of records) {
    const p = (r.path || r.page || "").replace(/^https?:\/\/[^/]+/, "") || "/";
    const set = out.get(p) ?? new Set<string>();
    set.add(r.actionType);
    out.set(p, set);
  }
  return out;
}

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

  // Item 29 - family win propagation: a mature, positive-verdict lever on one page is a
  // near-certain follow-up on its untreated siblings. Computed ONCE over the whole batch
  // (not per-page) since it reasons about the batch's pages as a family, then looked up by
  // path below. Every input here already respects the SAME eligibility gate as the rest of
  // the batch (assessEligibility over the shared `states`), so a mid-measurement or
  // active-control sibling is excluded by construction, never re-implemented.
  const wonRecords = matureWonRecords(input.proofLedger, now);
  const recentShips = shipsByPath(input.proofLedger);
  const familyEligibility = new Map<string, ExperimentEligibility>();
  for (const p of input.pages) {
    const path = p.url.replace(/^https?:\/\/[^/]+/, "") || "/";
    // The lever this sibling would receive is the WIN's family, not whatever chooseProposal
    // happens to propose for it - a sibling can lack a family win's lever entirely today.
    const winForFamily = [...wonRecords].find((r) => pageFamilyOf(r.path || r.page) === pageFamilyOf(p.url));
    const family = winForFamily ? actionFamilyOf(winForFamily.actionType) : "other";
    familyEligibility.set(path, assessEligibility({ url: p.url, family, states }));
  }
  const familyWinsByPath = new Map<string, FamilyPropagationCandidate>();
  for (const c of findFamilyPropagationCandidates({
    wonRecords,
    familyPages: input.pages.map((p) => ({ url: p.url, pageLabel: p.pageLabel, impressions: p.impressions })),
    eligibility: familyEligibility,
    recentShips,
  })) {
    familyWinsByPath.set(c.page.replace(/^https?:\/\/[^/]+/, "") || "/", c);
  }

  const out: BuiltCandidate[] = [];
  for (const p of input.pages) {
    const facts = input.facts.get(p.url) ?? { title: null, meta: null, h1: null };
    const sourcePath = p.url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
    const proposal = chooseProposal(facts, p.topQuery, sourcePath, p.pageLabel, linkDestinations, input.writtenAnswersByUrl?.get(p.url));
    if (!proposal) continue; // nothing materially better → no candidate (honest)

    const engineGap = input.engineGapsByUrl?.get(sourcePath);
    const actionFamily = actionFamilyOf(proposal.actionType);
    // Item 29: only credit the propagation win when it actually reused the SAME lever family
    // as tonight's real, deterministic proposal for this page (never attach a mismatched claim).
    const familyWinCandidate = familyWinsByPath.get(sourcePath);
    const familyWin = familyWinCandidate && familyWinCandidate.lever === actionFamily ? familyWinCandidate : undefined;
    // Source-query ownership only gates TEXT edits (meta/title/H1 must own the query they target).
    // An internal link's ownership is the DESTINATION owning the ANCHOR - already proven by the
    // proposer - so the source's query share is irrelevant; don't suppress valid links with it.
    const isLink = proposal.leverField === "internal_link";
    const baseExternal = { ownershipUncertain: !isLink && p.ownership < 0.12, highRisk: false };
    const baseElig = assessEligibility({ url: p.url, family: actionFamily, states, external: baseExternal });
    if (!baseElig.eligible) {
      out.push(buildCandidate(p, proposal, actionFamily, baseElig, [], baseExternal, engineGap, familyWin));
      continue; // kept for the planner to report as excluded
    }

    // controls: same family first, untreated, not this page, similar scale/position.
    const controls = cleanPool
      .filter((c) => c.url !== p.url)
      .map((c) => scoreControl(p, c))
      .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
      .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
      .slice(0, 5);
    // A measurable experiment NEEDS a control anchor - re-assess so <MIN_CONTROLS excludes from
    // selection (insufficient_controls) rather than silently shipping an unmeasurable change.
    const external = { ...baseExternal, insufficientControls: controls.length < MIN_CONTROLS };
    const elig = assessEligibility({ url: p.url, family: actionFamily, states, external });
    out.push(buildCandidate(p, proposal, actionFamily, elig, controls, external, engineGap, familyWin));
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
  familyWin?: FamilyPropagationCandidate,
): BuiltCandidate {
  const ctrOpportunityClicks = Math.max(0, expectedCtr(p.topQueryPosition) - p.topQueryCtr) * p.topQueryImpressions;
  const link = proposal.link;
  const answer = proposal.answer;
  const baseWhyNow = link
    ? `This page mentions "${link.anchorText}" (a page owned by ${link.destinationLabel}) without linking to it, a ${link.relationship.replace(/_/g, " ")} link that helps both pages. This page already ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}".`
    : answer
      ? answer.operation === "add_new_text"
        ? `People search "${p.topQuery}" (${p.topQueryImpressions} searches) but this page has no direct answer at the top. Beacon wrote one for you to review before it goes live. The page ranks #${p.topQueryPosition.toFixed(1)}, so leading with the answer should win more of those clicks.`
        : `People search "${answer.question}" and this page already answers it, but the answer is buried in paragraph ${answer.paragraphIndex + 1}. Moving that exact sentence to the top is what earns the click. It ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}".`
      : `This page ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}" (${p.topQueryImpressions} searches) but only ${(p.topQueryCtr * 100).toFixed(1)}% click. The ${proposal.leverField === "meta" ? "description" : proposal.leverField} is the weak link, so a sharper one should win more of those clicks.`;
  // Item 4: when the nightly 4-engine poll found this page cited by one AI engine but
  // absent on others, the card says so - the change aims at that gap too.
  const whyEngine = engineGap ? `${baseWhyNow} ${engineGap.sentence}` : baseWhyNow;
  // Item 29: reusing a proven win on this family - the propagation sentence rides the same
  // "why now" the operator reads first, so the provenance is never buried in an expander.
  const whyNow = familyWin ? `${whyEngine} ${familyWin.sentence}` : whyEngine;
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
    familyWin,
    // Item 29: a proven-family win is a near-certain follow-up, so it starts with a visible,
    // bounded boost (team-review composes ON TOP of this multiplicatively, never overwrites it
    // to neutral - see build-today-preview.ts).
    teamScoreMultiplier: familyWin ? familyWin.boost : undefined,
  };
}
