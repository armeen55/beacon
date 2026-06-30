/**
 * build-daily-candidates (2026-06-30) — turns Beacon's cached signals into eligible, exact,
 * one-variable daily-experiment candidates. PURE core (the live-page-facts fetch is the
 * caller's job, passed in as `facts`). Deterministic proposers only — NO LLM, NO generic
 * title templates, NO invented value props: a title proposal is a query-first REORDER of the
 * page's OWN title (drop filler), an H1 proposal aligns the H1 to the query it ranks for, a
 * meta proposal fires only when meta is genuinely MISSING (built from the on-page H1). If
 * nothing is materially better, the page yields no candidate (honest — never forces weak work).
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
import { pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import { proposeSafeMeta } from "./safe-meta";
import { proposeSafeInternalLink, type LinkDestination, type InternalLinkProposal } from "./safe-internal-link";

export type PageFacts = {
  title: string | null;
  meta: string | null;
  h1: string | null;
  /** The page's first substantive paragraph — the factual source for a safe meta. */
  openingParagraph?: string | null;
  /** Full body_paragraph_sample — the exact-text source for the safe internal-link lever. */
  bodyParagraphs?: string[];
  /** Normalized paths this page ALREADY links to (the internal-link duplicate guard). */
  internalLinkPaths?: string[];
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
  leverField: "title" | "meta" | "h1" | "internal_link";
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
};

const CTR_CURVE: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025 };
function expectedCtr(pos: number): number {
  const p = Math.round(pos);
  if (p <= 0) return 0.28;
  if (p <= 10) return CTR_CURVE[p];
  if (p <= 15) return 0.018;
  if (p <= 20) return 0.012;
  return 0.006;
}

// "verb + the" is consumed TOGETHER ("Discover the Most Popular X" → "Most Popular X", never the
// broken "the Most Popular X"). A BARE leading article ("The Best Restaurants in Florida") is NOT
// filler — stripping it isn't materially better and risks grammar — so it's deliberately absent.
const FILLER_LEAD = /^(meet the|meet|discover the|discover|explore the|explore|learn all about the|learn all about|learn about the|learn about|all about the|all about|guide to the|guide to|complete guide to|your guide to)\s+/i;

/** Drop a filler lead only when the remainder is a clean, capitalized, query-first phrase. This is
 *  unambiguously materially-better (query-first, no info loss, reversible). We deliberately do NOT
 *  prepend a synonym query (would change the page's subject — "Mongol Empire Flag" must not become
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
  leverField: "title" | "meta" | "h1" | "internal_link";
  actionType: string;
  proposed: string;
  current: string;
  source?: string;
  link?: InternalLinkProposal;
};
function chooseProposal(facts: PageFacts, query: string, sourcePath: string, destinations: LinkDestination[]): Proposal | null {
  // Lever priority: META (highest-yield, factual) → INTERNAL LINK (exact, reversible) → filler-drop
  // title/H1 (clean last resort). Different pages naturally take different levers → a real mix.
  const m = proposeSafeMeta({ currentMeta: facts.meta, openingParagraph: facts.openingParagraph, query });
  if (m) return { leverField: "meta", actionType: "edit_meta", proposed: m.proposed, current: facts.meta ?? "(none)", source: m.source };
  if (destinations.length > 0 && (facts.bodyParagraphs?.length ?? 0) > 0) {
    const link = proposeSafeInternalLink({
      sourcePath, sourceParagraphs: facts.bodyParagraphs ?? [],
      sourceLinkedPaths: new Set(facts.internalLinkPaths ?? []), destinations,
    });
    if (link) return { leverField: "internal_link", actionType: "add_internal_link", proposed: link.exactReplacementText, current: link.exactSourceText, link };
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

export function buildDailyCandidates(input: {
  tenantId: string;
  pages: GscPageInput[];
  facts: Map<string, PageFacts>;
  proofLedger: ShippedChangeRecord[];
  /** Eligible link destinations (caller marks protected/active pages ineligible). Omit to disable
   *  the internal-link lever (meta-only). */
  linkDestinations?: LinkDestination[];
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
    const proposal = chooseProposal(facts, p.topQuery, sourcePath, linkDestinations);
    if (!proposal) continue; // nothing materially better → no candidate (honest)

    const actionFamily = actionFamilyOf(proposal.actionType);
    // Source-query ownership only gates TEXT edits (meta/title/H1 must own the query they target).
    // An internal link's ownership is the DESTINATION owning the ANCHOR — already proven by the
    // proposer — so the source's query share is irrelevant; don't suppress valid links with it.
    const isLink = proposal.leverField === "internal_link";
    const baseExternal = { ownershipUncertain: !isLink && p.ownership < 0.12, highRisk: false };
    const baseElig = assessEligibility({ url: p.url, family: actionFamily, states, external: baseExternal });
    if (!baseElig.eligible) {
      out.push(buildCandidate(p, proposal, actionFamily, baseElig, [], baseExternal));
      continue; // kept for the planner to report as excluded
    }

    // controls: same family first, untreated, not this page, similar scale/position.
    const controls = cleanPool
      .filter((c) => c.url !== p.url)
      .map((c) => scoreControl(p, c))
      .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
      .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
      .slice(0, 5);
    // A measurable experiment NEEDS a control anchor — re-assess so <MIN_CONTROLS excludes from
    // selection (insufficient_controls) rather than silently shipping an unmeasurable change.
    const external = { ...baseExternal, insufficientControls: controls.length < MIN_CONTROLS };
    const elig = assessEligibility({ url: p.url, family: actionFamily, states, external });
    out.push(buildCandidate(p, proposal, actionFamily, elig, controls, external));
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
): BuiltCandidate {
  const ctrOpportunityClicks = Math.max(0, expectedCtr(p.topQueryPosition) - p.topQueryCtr) * p.topQueryImpressions;
  const link = proposal.link;
  const whyNow = link
    ? `Body mentions "${link.anchorText}" (owned by ${link.destinationLabel}) without linking it — a ${link.relationship.replace(/_/g, " ")} internal link. Source ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}".`
    : `Ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}" (${p.topQueryImpressions} impr) at ${(p.topQueryCtr * 100).toFixed(1)}% CTR — ${proposal.leverField} is the weak link.`;
  return {
    url: p.url,
    pageLabel: p.pageLabel,
    pageFamily: pageFamilyOf(p.url),
    actionFamily,
    targetQuery: p.topQuery,
    impressions: p.impressions,
    position: p.topQueryPosition,
    ctr: p.topQueryCtr,
    ownership: p.ownership,
    ctrOpportunityClicks,
    effortMinutes: link ? 3 : 1,
    external,
    leverField: proposal.leverField,
    currentText: proposal.current,
    proposedText: proposal.proposed,
    whyNow,
    rollbackText: proposal.current,
    eligibility: elig,
    suggestedControls: controls,
    enoughControls: controls.length >= MIN_CONTROLS,
    influencedUrls: link ? [link.destinationPath] : undefined,
    linkDetail: link,
  };
}
