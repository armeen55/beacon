/**
 * move-card (2026-06-24, Step 7 bridge) — the PURE, plain-language presentation
 * of an EvidencePacket as the operator-facing Move card (§7 of the spec):
 * Move / Why / What wins / Your gap / Draft / Proof / Ship. No jargon (per the
 * plain-language campaign), no I/O, no LLM. This is the canonical shape the
 * Today / Opportunities surfaces will render — building it here keeps the
 * presentation deterministic + testable and lets Step 7 be a thin renderer.
 */

import type { EvidencePacket } from "./evidence-packet";
import type { GapKind, ConfidenceLevel } from "./build-graph";
import type { GapKindDetail } from "./evidence-packet";

export type MoveCard = {
  /** Imperative action + subject, e.g. "Create a new page: Persian Wedding". */
  move: string;
  /** Plain-English reason this matters. */
  why: string;
  /** What the winning competitor does (gated), or an honest absence note. */
  whatWins: string;
  /** The specific gaps, in plain English. */
  yourGap: string[];
  /** True when a grounded draft skeleton is ready to review. */
  draftReady: boolean;
  /** How we'll know it worked, in plain English. */
  proof: string;
  confidence: ConfidenceLevel;
  /** The one-click call to action. */
  ship: string;
};

const ACTION: Record<GapKind, string> = {
  create_page: "Create a new page",
  edit_page: "Improve your page",
  answer_block: "Add a quick answer",
  fix_experience: "Fix the page experience",
  healthy: "Keep an eye on",
  low_demand: "Consider later",
};

const GAP_PLAIN: Record<GapKindDetail, string> = {
  missing_page: "You have no page for this — the competitor does",
  missing_answer_block: "No short answer AI can quote, so AI cites others",
  missing_faq: "No common-questions section (the competitor has one)",
  thin_content: "Your page is much shorter than the one that wins",
  missing_schema: "Missing the behind-the-scenes labels that help Google/AI understand the page",
  weak_title: "Your headline isn't pulling clicks for what people search",
  weak_meta: "No search-result description to win the click",
  missing_tool: "The competitor offers an interactive tool you don't",
  ux_friction: "Visitors are hitting dead ends on the page",
};

const METRIC_PLAIN: Record<string, string> = {
  "new-page clicks": "visits to the new page",
  "Profound citations": "how often AI recommends you",
  CTR: "click rate from search",
  clicks: "clicks from search",
  position: "search ranking",
  "GA4 conversions": "leads/sales",
  "Clarity dead/rage clicks": "frustrated clicks",
  "engaged sessions": "engaged visits",
};

function plainMetric(m: string): string {
  return METRIC_PLAIN[m] ?? m;
}

export function formatMoveCard(packet: EvidencePacket): MoveCard {
  const { move, competitor, gaps, draft, proofPlan, demand } = packet;
  const subject = move.label;

  const why = (() => {
    const bits: string[] = [];
    if (competitor.domain && !competitor.looselyMatched) {
      bits.push(`AI/Google point people to ${competitor.domain} for "${subject}"`);
    } else if (demand.basis === "ai_attention") {
      bits.push(`People ask AI about "${subject}" and you're not in the answer`);
    } else {
      bits.push(`There's real search demand for "${subject}"`);
    }
    if (move.components.dollarValue > 0) bits.push("and this page can drive leads/sales");
    return `${bits.join(" ")}.`;
  })();

  const whatWins = (() => {
    // On-topic page with a real teardown → the grounded summary.
    if (competitor.facts && !competitor.looselyMatched) return competitor.whatWins;
    // No competitor at all → you can own it.
    if (!competitor.domain) return `No single strong competitor found yet — you can own this.`;
    // Off-topic citation (we DID read the page, it just doesn't fit the query).
    if (competitor.looselyMatched) {
      return `We haven't confirmed the exact page that wins yet — the AI citation looked off-topic for this query. Confirm with live search.`;
    }
    // Domain cited but the page couldn't be read (blocked/error) — NOT off-topic.
    return `${competitor.domain} is cited here, but we couldn't read its page yet — confirm with live search.`;
  })();

  return {
    move: `${ACTION[move.gapType] ?? "Update"}: ${subject}`,
    why,
    whatWins,
    yourGap: gaps.map((g) => GAP_PLAIN[g.kind] ?? g.detail),
    draftReady: !!draft.titleSuggestion || draft.outline.length > 0 || !!draft.answerBlockBrief,
    proof: `We'll watch ${proofPlan.metrics.map(plainMetric).join(", ")} over ${proofPlan.windowsDays.join("/")} days vs similar pages you didn't change.`,
    confidence: move.confidence,
    ship: draft.titleSuggestion || draft.outline.length > 0 ? "Review & ship" : "Open to plan",
  };
}
