/**
 * move-router (2026-06-25, P2 — the debate engine) — take a Move's evidence and
 * the team's SpecialistOpinions and DECIDE one action, transparently. The router
 * is deterministic (no LLM, no magic): it seeds from the demand graph's own gap
 * classification, tallies the specialists' weighted votes, applies vetoes
 * (DataForSEO "you can't outrank this SERP" / "you already rank"), applies the
 * Google+AI overlap boost, applies downgrades (friction, not-pushable, off-topic,
 * unproven demand), and adjusts the score with a bounded, visible multiplier.
 *
 * It NEVER mutates the pure scorer — `baseScore` comes straight from the demand
 * graph and `adjustedScore` is a transparent post-multiplier (the same discipline
 * the learning loop will use later). The output records who supported the winner,
 * which objections fired, and why the alternatives lost — so a card can show the
 * whole debate, not a black box.
 *
 * PURE / deterministic / no I/O. Pinned by move-router.test.ts.
 */

import type { EvidencePacket } from "./evidence-packet";
import type { GapKind, MoveCandidate, ConfidenceLevel } from "./build-graph";
import type {
  MoveRouterAction,
  Objection,
  SpecialistOpinion,
} from "./specialist-opinions";

/** Parent grouping for a Move action (the strategic family it belongs to). */
export type MoveParentType =
  | "content_move"
  | "aeo_move"
  | "technical_seo_move"
  | "cro_move"
  | "commerce_move"
  | "asset_move"
  | "local_move"
  | "link_authority_move"
  | "proof_move"
  | "wait";

export type MoveRouterDecision = {
  action: MoveRouterAction;
  parentType: MoveParentType;
  /** 0..1, after boosts + downgrades. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** The demand graph's score, untouched. */
  baseScore: number;
  /** baseScore × the bounded, visible adjustment from the debate. */
  adjustedScore: number;
  /** The single sentence explaining why this action won. */
  rationale: string;
  /** Opinions whose suggestedMoveTypes included the winning action. */
  supporting: SpecialistOpinion[];
  /** Vetoes/downgrades that actually changed the outcome or score. */
  appliedObjections: Objection[];
  /** Opinions for OTHER actions + objections that didn't win — surfaced for honesty. */
  dissenting: SpecialistOpinion[];
  /** One-liners on why the runner-up actions lost (when meaningful). */
  whyNotAlternatives: string[];
  /** Earliest staleAt across the supporting opinions (when to recompute). */
  staleAt: string | null;
};

export const GAP_TO_ACTION: Record<GapKind, MoveRouterAction> = {
  create_page: "create_page",
  edit_page: "change_title_meta",
  answer_block: "add_answer_block",
  fix_experience: "fix_ux",
  healthy: "wait",
  low_demand: "wait",
};

const ACTION_PARENT: Record<MoveRouterAction, MoveParentType> = {
  create_page: "content_move",
  edit_existing_page: "content_move",
  add_answer_block: "aeo_move",
  add_schema: "technical_seo_move",
  change_title_meta: "content_move",
  add_internal_links: "technical_seo_move",
  build_tool: "asset_move",
  build_calculator: "asset_move",
  create_asset: "asset_move",
  fix_ux: "cro_move",
  get_backlinks: "link_authority_move",
  local_seo_update: "local_move",
  improve_image_seo: "technical_seo_move",
  optimize_product_page: "commerce_move",
  wait: "wait",
};

export function parentTypeForAction(action: MoveRouterAction): MoveParentType {
  return ACTION_PARENT[action] ?? "content_move";
}

const CONF_LEVEL_TO_NUM: Record<ConfidenceLevel, number> = { high: 0.85, medium: 0.6, low: 0.35 };
function numToLevel(n: number): ConfidenceLevel {
  return n >= 0.75 ? "high" : n >= 0.5 ? "medium" : "low";
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

type RouteInput = {
  packet: EvidencePacket;
  opinions: SpecialistOpinion[];
  /** The full MoveCandidate when the caller has it (richer than packet.move). */
  move?: MoveCandidate | null;
};

/**
 * Debate the opinions into one decision. Deterministic. Degrades gracefully: with
 * NO opinions it reproduces the demand graph's own gap classification + score, so
 * wiring it in can never regress today's behavior.
 */
export function routeMove(input: RouteInput): MoveRouterDecision {
  const { packet, opinions } = input;
  const gap = input.move?.gap ?? packet.move.gapType;
  const baseScore = input.move?.score ?? packet.move.score;
  const baseConfidence =
    CONF_LEVEL_TO_NUM[input.move?.confidence ?? packet.move.confidence] ?? 0.5;

  // 1) Seed from the graph's honest first-pass classification.
  let action: MoveRouterAction = GAP_TO_ACTION[gap] ?? "wait";
  let rationale = packet.move.label
    ? `Demand graph routed "${packet.move.label}" to ${action.replace(/_/g, " ")}.`
    : `Routed to ${action.replace(/_/g, " ")}.`;

  // 2) Tally weighted votes (confidence-weighted) for each suggested action.
  const votes = new Map<MoveRouterAction, number>();
  for (const o of opinions) {
    for (const a of o.suggestedMoveTypes) {
      votes.set(a, (votes.get(a) ?? 0) + o.confidence);
    }
  }

  const appliedObjections: Objection[] = [];
  const whyNot: string[] = [];

  // 3) Apply VETOes — they override the action.
  const vetoes = opinions.flatMap((o) => o.objections).filter((ob) => ob.severity === "veto");
  for (const v of vetoes) {
    const hitsCurrent = v.against.length === 0 || v.against.includes(action);
    if (!hitsCurrent) continue;
    if (v.kind === "already_ranks") {
      action = "edit_existing_page";
      rationale = `DataForSEO: you already rank — routed to an edit, not a new page. ${v.detail}`;
      appliedObjections.push(v);
      whyNot.push("create_page vetoed: you already rank for this.");
    } else if (v.kind === "cant_outrank_serp") {
      action = "wait";
      rationale = `DataForSEO: ${v.detail} Holding until a winnable angle appears.`;
      appliedObjections.push(v);
      whyNot.push("create_page vetoed: marketplace/UGC SERP a content page can't win.");
    } else if (v.kind === "fix_ux_first") {
      action = "fix_ux";
      rationale = `Clarity: ${v.detail}`;
      appliedObjections.push(v);
      whyNot.push("content move deferred: fix the experience first.");
    }
  }

  // 4) Google + AI overlap boost: GSC demand AND Profound citation AND a DataForSEO
  //    overlap multiplier all present → the strongest signal a Move can carry.
  const hasGsc = opinions.some((o) => o.specialist === "gsc");
  const hasProfound = opinions.some((o) => o.specialist === "profound");
  const overlapMult =
    opinions.find((o) => o.specialist === "dataforseo")?.scoreContribution.scoreMultiplier ?? 1;
  let confidence = baseConfidence;
  let scoreMult = 1;
  let overlapBoosted = false;
  if (hasGsc && hasProfound && overlapMult > 1) {
    confidence = clamp01(confidence * 1.3);
    scoreMult *= overlapMult;
    overlapBoosted = true;
    rationale += " Google + AI both confirm this demand (double-confirmed).";
  }

  // 5) Apply DOWNGRADES — they cut confidence + score but don't change the action.
  const downgrades = opinions.flatMap((o) => o.objections).filter((ob) => ob.severity === "downgrade");
  for (const d of downgrades) {
    const hitsCurrent = d.against.length === 0 || d.against.includes(action);
    if (!hitsCurrent) continue;
    confidence *= 0.75;
    scoreMult *= 0.85;
    appliedObjections.push(d);
  }
  // Any specialist asking for a flat score cut (e.g. Wix not-pushable) applies too —
  // but never to a "wait" decision, where a CMS/pushability penalty is meaningless.
  if (action !== "wait") {
    for (const o of opinions) {
      const m = o.scoreContribution.scoreMultiplier;
      if (m != null && m < 1) scoreMult *= m;
    }
  }

  // NOTE (Sprint 1): only scoreContribution.scoreMultiplier feeds the score here.
  // The additive deltas (demand / winnabilityDelta / visibilityGapDelta / dollarValue /
  // friction) are carried on the opinions for the later P6 score-fold + learning
  // reweight; folding them in is deferred so the pure scorer stays the source of truth.
  confidence = clamp01(confidence);
  const adjustedScore = Math.max(0, Math.round(baseScore * scoreMult));

  // 6) Partition opinions for the debate view.
  const supporting = opinions.filter((o) => o.suggestedMoveTypes.includes(action));
  const dissenting = opinions.filter(
    (o) =>
      !o.suggestedMoveTypes.includes(action) &&
      (o.suggestedMoveTypes.length > 0 || o.objections.length > 0),
  );

  // Note other strongly-voted actions we didn't take (transparency).
  for (const [a, w] of [...votes.entries()].sort((x, y) => y[1] - x[1])) {
    if (a !== action && w >= 1 && whyNot.length < 4) {
      whyNot.push(`Considered ${a.replace(/_/g, " ")} (support ${w.toFixed(1)}) — ${action.replace(/_/g, " ")} ranked higher.`);
    }
  }

  const staleCandidates = supporting
    .map((o) => Date.parse(o.staleAt))
    .filter((n) => Number.isFinite(n));
  const staleAt = staleCandidates.length ? new Date(Math.min(...staleCandidates)).toISOString() : null;

  return {
    action,
    parentType: parentTypeForAction(action),
    confidence,
    confidenceLevel: numToLevel(confidence),
    baseScore,
    adjustedScore,
    rationale,
    supporting,
    appliedObjections,
    dissenting,
    whyNotAlternatives: whyNot,
    staleAt,
  };
}
