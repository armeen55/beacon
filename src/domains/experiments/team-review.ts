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
import { attachOpinions, type SpecialistExtras } from "@/domains/demand-graph/specialist-opinions";
import { routeMove, type SpecialistWeightLookup } from "@/domains/demand-graph/move-router";
import { summarizeSpecialistDebate, computeAgreement, devilsAdvocateLine } from "@/domains/demand-graph/debate-summary";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

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
  /** The strongest road NOT taken, in plain words ("Considered a new page: you already rank"). */
  whyNot?: string;
  /** Item 37 - when fewer than 3 voices spoke, say WHY the silent teammates abstained
   *  (they abstain rather than guess - that is a feature, and it should read like one). */
  silent?: string;
  /** P5 item 387 - one honest line on how much of the team agreed on the winning action
   *  ("4 of 5 teammates agreed on this. The odd one out worried about competition."). Absent
   *  when only one teammate could weigh in (one voice is not a team agreeing on anything). */
  agreement?: string;
  /** P5 item 231/314 - the strongest case AGAINST this move, stated plainly so every card shows
   *  the counter-argument and not just agreement ("The skeptic's take: ..."). Absent when no
   *  teammate argued against it. */
  devilsAdvocate?: string;
  /** P5 item 312 - what would prove this move wrong, in the team's own first-person auto-retract
   *  voice, from the proof plan's own window + metric ("If clicks do not rise within 4 weeks,
   *  this was the wrong call and I will retract it."). Absent when there is no proof plan. */
  falsifier?: string;
  /** P5 item 163 - the quorum flag: TRUE when exactly one teammate could pick an action and no
   *  other teammate corroborated it, so the card frames this as "worth a look" rather than a
   *  confident, team-backed pick. Absent/false for a corroborated Move (the normal case). */
  worthALook?: boolean;
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

/** Item 37 - plain reason each data teammate abstains (no data = no guess). Internal synthesis
 *  roles (strategist, commerce) are not listed; their silence is not a data gap. */
const SILENT_REASON: Record<string, string> = {
  gsc: "Search demand had no Google data for this page",
  ga4: "Revenue saw no conversion signal here",
  clarity: "Visitor behavior has no session data for this page",
  profound: "AI citations found no answers mentioning this topic",
  dataforseo: "Live Google results have not been checked for this search yet",
  wix: "Publishing has no field mapping for this page",
};

/** P5 item 312 - the plain, first-person metric name for the falsifier line, from the proof plan's
 *  own primary metric, tagged with its grammatical number so the verb agrees ("clicks do not rise"
 *  vs "the click rate does not rise"). Falls back to plural "clicks" so the sentence always reads
 *  cleanly. */
const FALSIFIER_METRIC_PLAIN: Array<[RegExp, { name: string; plural: boolean }]> = [
  [/citation/i, { name: "AI citations", plural: true }],
  [/ctr/i, { name: "the click rate", plural: false }],
  [/click/i, { name: "clicks", plural: true }],
  [/position|rank/i, { name: "the ranking", plural: false }],
  [/conversion/i, { name: "conversions", plural: true }],
  [/session|engage/i, { name: "engagement", plural: false }],
];

function falsifierMetricPlain(metrics: string[] | undefined): { name: string; plural: boolean } {
  const primary = metrics?.[0] ?? "";
  for (const [re, plain] of FALSIFIER_METRIC_PLAIN) if (re.test(primary)) return plain;
  return { name: "clicks", plural: true };
}

/** P5 item 312 - the falsifier: what would prove this move wrong, in the team's own voice, tied
 *  to the proof plan's longest window (usually 28 days = 4 weeks) and primary metric. This is the
 *  honest auto-retract commitment the debate closes on. Returns null (self-hides) when there is
 *  no proof plan to falsify against. The verb is direction-aware: an experience fix should cut
 *  friction, so "do not fall"; every other lever should raise its metric, so "do not rise". PURE. */
export function falsifierLine(
  proofPlan: { metrics?: string[]; windowsDays?: number[] } | null | undefined,
  action: string,
): string | null {
  if (!proofPlan) return null;
  const windows = (proofPlan.windowsDays ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const days = windows.length ? Math.max(...windows) : 28;
  const weeks = Math.max(1, Math.round(days / 7));
  const metric = falsifierMetricPlain(proofPlan.metrics);
  const verb = metric.plural ? "do not" : "does not";
  // A friction fix wins by LOWERING dead/rage clicks; content/AEO moves win by RAISING their metric.
  const fallsNotRises = action === "fix_ux" && /friction|dead|rage/i.test(proofPlan.metrics?.[0] ?? "");
  const direction = fallsNotRises ? `${metric.name} ${verb} fall` : `${metric.name} ${verb} rise`;
  return `What would prove this wrong: if ${direction} within ${weeks} week${weeks === 1 ? "" : "s"}, this was the wrong call and I will retract it.`;
}

/** One quiet sentence naming the silent teammates and why (null when 3+ voices spoke). */
export function silentTeammatesLine(spoke: ReadonlySet<string>): string | null {
  if (spoke.size >= 3) return null;
  const silent = Object.entries(SILENT_REASON).filter(([k]) => !spoke.has(k));
  if (silent.length === 0) return null;
  const parts = silent.slice(0, 3).map(([, reason]) => reason.charAt(0).toLowerCase() + reason.slice(1));
  return `Quiet this time: ${parts.join("; ")}. They abstain rather than guess.`;
}

/** Run the full team over one candidate page. PURE. Null packet -> honest abstain.
 *  `extras` (item 39) threads the few facts the packet itself doesn't carry - most notably a
 *  freshly-bought live-SERP verdict for a re-review after buy-missing-evidence.ts closes a
 *  gap. Optional and additive: every existing caller omits it and behaves exactly as before. */
export function reviewCandidateWithTeam(
  packet: EvidencePacket | null | undefined,
  nowIso: string,
  extras: SpecialistExtras = {},
  specialistWeight?: SpecialistWeightLookup,
): TeamReviewResult {
  if (!packet) return { review: null, scoreMultiplier: 1, vetoed: false, vetoReason: null };

  const opinions = attachOpinions(packet, { ...extras, nowIso });
  if (opinions.length === 0) return { review: null, scoreMultiplier: 1, vetoed: false, vetoReason: null };

  const decision = routeMove({ packet, opinions, specialistWeight });
  const summary = summarizeSpecialistDebate(opinions);

  // Card verdict in operator language. The router's raw rationale carries graph-internal phrasing
  // ("Demand graph routed ...") and may name a BIGGER play than tonight's safe lever - say that
  // honestly instead of leaking the machinery. Vetoes keep the router's own explanation.
  const vetoFiredEarly = decision.appliedObjections.some((o) => o.severity === "veto");
  const doubleConfirmed = decision.rationale.includes("double-confirmed");
  const verdict = vetoFiredEarly
    ? decision.rationale
    : `Biggest opportunity the team sees on this page: ${ACTION_PLAIN[decision.action] ?? decision.action.replace(/_/g, " ")}.${doubleConfirmed ? " Google and AI results both confirm this demand." : ""}`;

  const whyNotRaw = decision.whyNotAlternatives[0] ?? null;
  const whyNot = whyNotRaw ? whyNotRaw.replace(/_/g, " ").replace(/\s+/g, " ").trim() : undefined;

  const silent = silentTeammatesLine(new Set(summary.voices.map((v) => v.specialist))) ?? undefined;

  // P5 item 387 - how much of the team agreed on the action the router actually chose (self-hides
  // to undefined when only one teammate could weigh in). Item 231/314 - the strongest case against.
  // Item 312 - the falsifiable auto-retract commitment from the proof plan. Item 163 - the quorum
  // flag when a lone teammate picked with no corroboration. All PURE, derived from the same
  // opinions + decision the debate already produced (no new I/O, no new score logic).
  const agreementSummary = computeAgreement(opinions, decision.action);
  const agreement = agreementSummary.line ? stripBannedDashes(agreementSummary.line) : undefined;
  const devils = devilsAdvocateLine(opinions);
  const devilsAdvocate = devils ? stripBannedDashes(devils) : undefined;
  const falsifier = falsifierLine(packet.proofPlan, decision.action) ?? undefined;
  // Quorum (item 163): exactly ONE teammate weighed in at all and nobody else corroborated the
  // signal, so this is a lead to check, not a confident team-backed pick. A second opinion of any
  // kind (even a demand-signal GSC voice behind an AI-citations pick) counts as corroboration and
  // keeps the Move a normal, confident pick. A vetoed decision is a strong team signal, never a
  // lone-voice guess, so it is never demoted here.
  const worthALook = !vetoFiredEarly && opinions.length === 1 ? true : undefined;

  const review: TeamReview = {
    verdict,
    whyNot,
    silent,
    agreement,
    devilsAdvocate,
    falsifier,
    worthALook,
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
