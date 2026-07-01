/**
 * team-review (2026-07-01, dream-state R1) - the FULL specialist team reviews every daily-experiment
 * candidate before the planner picks tonight's batch. PURE (no I/O, no LLM): the caller passes the
 * page's EvidencePacket (the canonical fused evidence object); this module runs the eight specialist
 * emitters, debates them through the move-router, and returns:
 *   - a render-ready TeamReview (named voices, objections, verdict) the card can show verbatim
 *   - a bounded score multiplier the planner folds into its deterministic score (visible, never
 *     replacing the pure scorer - the same discipline the router itself uses)
 *   - a veto flag when the team argues the page should NOT take a content change right now
 *     (fix the experience first / hold) - those candidates leave the batch with an honest reason.
 *
 * A page with no packet (or a silent team) is returned untouched: the team ABSTAINS, it never
 * fabricates. Pinned by team-review.test.ts.
 */

import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import { attachOpinions } from "@/domains/demand-graph/specialist-opinions";
import { routeMove } from "@/domains/demand-graph/move-router";
import { summarizeSpecialistDebate } from "@/domains/demand-graph/debate-summary";

/** Self-contained render-ready debate (persisted on the plan record, so no type imports leak). */
export type TeamReview = {
  /** One plain-language line: why the team backs (or redirected) this move. */
  verdict: string;
  /** e.g. "5 specialists weighed in, 1 raised a concern". */
  headline: string;
  /** Average conviction of the supporting voices, 0..100. */
  consensusPct: number;
  voices: Array<{ specialist: string; label: string; claim: string; confidencePct: number }>;
  objections: Array<{ label: string; reason: string; severity: "veto" | "downgrade"; detail: string }>;
};

export type TeamReviewResult = {
  review: TeamReview | null;
  /** Bounded 0.5..1.5 multiplier for the planner's score (1 = neutral / team silent). */
  scoreMultiplier: number;
  /** True when the team routed the page AWAY from content work (fix_ux / wait via a veto). */
  vetoed: boolean;
  /** Plain reason when vetoed (for the plan's excluded ledger). */
  vetoReason: string | null;
};

const clampMult = (n: number): number => Math.max(0.5, Math.min(1.5, n));

/** Plain words for the router's action, for the card verdict (never raw enum keys). */
const ACTION_PLAIN: Record<string, string> = {
  create_page: "a new page",
  edit_existing_page: "a page edit",
  add_answer_block: "a direct answer at the top of the page",
  add_schema: "structured data",
  change_title_meta: "a sharper title and description",
  add_internal_links: "internal links",
  build_tool: "an interactive tool",
  build_calculator: "a calculator",
  create_asset: "a new asset",
  fix_ux: "fixing the page experience first",
  get_backlinks: "earning links",
  local_seo_update: "a local visibility update",
  improve_image_seo: "better image descriptions",
  optimize_product_page: "a product page improvement",
  wait: "holding this page for now",
};

/** Run the full team over one candidate page. PURE. Null packet -> honest abstain. */
export function reviewCandidateWithTeam(
  packet: EvidencePacket | null | undefined,
  nowIso: string,
): TeamReviewResult {
  if (!packet) return { review: null, scoreMultiplier: 1, vetoed: false, vetoReason: null };

  const opinions = attachOpinions(packet, { nowIso });
  if (opinions.length === 0) return { review: null, scoreMultiplier: 1, vetoed: false, vetoReason: null };

  const decision = routeMove({ packet, opinions });
  const summary = summarizeSpecialistDebate(opinions);

  // Card verdict in operator language. The router's raw rationale carries graph-internal phrasing
  // ("Demand graph routed ...") and may name a BIGGER play than tonight's safe lever - say that
  // honestly instead of leaking the machinery. Vetoes keep the router's own explanation.
  const vetoFiredEarly = decision.appliedObjections.some((o) => o.severity === "veto");
  const doubleConfirmed = decision.rationale.includes("double-confirmed");
  const verdict = vetoFiredEarly
    ? decision.rationale
    : `Biggest opportunity the team sees on this page: ${ACTION_PLAIN[decision.action] ?? decision.action.replace(/_/g, " ")}.${doubleConfirmed ? " Google and AI results both confirm this demand." : ""}`;

  const review: TeamReview = {
    verdict,
    headline: summary.headline,
    consensusPct: summary.consensusPct,
    voices: summary.voices.map((v) => ({
      specialist: v.specialist,
      label: v.label,
      claim: v.claim,
      confidencePct: v.confidencePct,
    })),
    objections: summary.objections.map((o) => ({
      label: o.label,
      reason: o.reason,
      severity: o.severity,
      detail: o.detail,
    })),
  };

  // A veto that ROUTED the page off content work entirely (fix the experience first, or hold
  // until the search is winnable) removes the candidate from tonight's batch. Vetoes that merely
  // re-route WITHIN content work (e.g. "you already rank -> edit, don't create") keep the
  // candidate: the daily levers are already edits.
  const vetoFired = decision.appliedObjections.some((o) => o.severity === "veto");
  const routedOffContent = decision.action === "fix_ux" || decision.action === "wait";
  const vetoed = vetoFired && routedOffContent;

  const base = decision.baseScore > 0 ? decision.adjustedScore / decision.baseScore : 1;
  return {
    review,
    scoreMultiplier: clampMult(Number.isFinite(base) && base > 0 ? base : 1),
    vetoed,
    vetoReason: vetoed ? decision.rationale : null,
  };
}
