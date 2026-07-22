/**
 * move-router (2026-06-25, P2 - the debate engine) - take a Move's evidence and
 * the team's SpecialistOpinions and DECIDE one action, transparently. The router
 * is deterministic (no LLM, no magic): it seeds from the demand graph's own gap
 * classification, tallies the specialists' weighted votes, applies vetoes
 * (DataForSEO "you can't outrank this SERP" / "you already rank"), applies the
 * Google+AI overlap boost, applies downgrades (friction, not-pushable, off-topic,
 * unproven demand), and adjusts the score with a bounded, visible multiplier.
 *
 * It NEVER mutates the pure scorer - `baseScore` comes straight from the demand
 * graph and `adjustedScore` is a transparent post-multiplier (the same discipline
 * the learning loop will use later). The output records who supported the winner,
 * which objections fired, and why the alternatives lost - so a card can show the
 * whole debate, not a black box.
 *
 * BEACON_500 item 70 (2026-07-02) - learned per-specialist vote weights: an OPTIONAL
 * `specialistWeight` lookup (RouteInput.specialistWeight) resolves each opinion's
 * bounded reliability weight (src/domains/team-scoreboard/specialist-weights.ts,
 * itself built from the team scoreboard's settled won/lost record per specialist and
 * lever family) and multiplies it into that opinion's vote-tally weight - a specialist
 * that has actually called more winners in this family gets a bit more say. This
 * module stays a leaf: it takes the resolved weight through a plain callback rather
 * than importing team-scoreboard, exactly the pattern src/domains/learning/
 * experiment-prior.ts's `resolvePrior` uses for its own optional `globalLookup`. NO
 * caller is required to pass it; when omitted every weight defaults to 1.0 and
 * behavior is byte-identical to before item 70 (pinned by move-router.test.ts).
 *
 * N6 (2026-07-02) - the query-intent veto: routeMove now also runs
 * intent-veto.ts's `checkIntentVeto` against the action as decided so far
 * (seed or vote-elected), feeding its Objection through the SAME veto/downgrade
 * paths above (no new machinery). This turns the existing answer-intent
 * classifier (src/domains/experiments/answer-intent.ts) from a drafting hint
 * into a hard router veto: a lever whose answer shape cannot serve the
 * dominant intent behind the Move's queries (e.g. a definition answering a
 * date question) is blocked or downgraded, never silently shipped. Runs by
 * default (it is a pure, $0 check); `intentVeto: { enabled: false }` opts a
 * call site out entirely for byte-identical pre-N6 behavior. Abstains (no
 * objection) whenever the classifier itself abstains or no rule finds a clear
 * mismatch - pinned by move-router.test.ts and intent-veto.test.ts.
 *
 * PURE / deterministic / no I/O. Pinned by move-router.test.ts.
 */

import type { EvidencePacket } from "./evidence-packet";
import type { GapKind, MoveCandidate, ConfidenceLevel } from "./build-graph";
import { actionFamilyOf } from "@/domains/proof-gsc/change-family";
import { checkIntentVeto } from "./intent-veto";
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
  /** Opinions for OTHER actions + objections that didn't win - surfaced for honesty. */
  dissenting: SpecialistOpinion[];
  /** One-liners on why the runner-up actions lost (when meaningful). */
  whyNotAlternatives: string[];
  /** Earliest staleAt across the supporting opinions (when to recompute). */
  staleAt: string | null;
  /** BEACON_500 item 49 - who actually decided the action: the demand graph's own gap
   *  classification ("seed", the default), or the team's normalized vote tally beating the
   *  seed by more than the margin threshold ("vote"). Vetoes can still override either. */
  electedBy: "seed" | "vote";
  /** BEACON_500 item 49 - the winning vote's share of total vote weight minus the seed
   *  action's share, i.e. how decisively the team outvoted the default (0 when electedBy
   *  is "seed" or there were no votes to compare). */
  margin: number;
  /** BEACON_500 item 70 - the specialists whose vote weight was actually learned (non-neutral)
   *  for this Move, with the plain-English tag explaining the tilt. Empty when no
   *  `specialistWeight` lookup was passed, or every resolved weight was neutral (1.0) - the
   *  common case until the team scoreboard has enough settled history. */
  appliedWeights: AppliedSpecialistWeight[];
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

/** BEACON_500 item 49 - a vote winner must beat the seeded action by more than this share of
 *  the total vote weight before it takes the decision. Below this margin the seed wins (the
 *  existing "seed wins when close" behavior is preserved on purpose - a narrow vote plurality
 *  is not a mandate). Documented constant so the threshold is visible and tunable in one place. */
export const VOTE_ELECTION_MARGIN = 0.25;

/** BEACON_500 item 49 - election also requires a genuine TEAM consensus, not one loud voice: at
 *  least this many distinct specialists must back the winning action. A single specialist's
 *  opinion (e.g. Clarity's friction reading, which is a deliberate downgrade-not-veto in Sprint
 *  1) can clear the margin threshold alone but must never unilaterally out-vote the graph's own
 *  seed - the debate is supposed to decide together, not let one teammate override by default. */
export const VOTE_ELECTION_MIN_VOICES = 2;

/** Plain-word phrasing for every routable action - the ONE map any surface should
 *  route an action key through before showing it to the operator (never a raw
 *  snake_case key). Exported (Wave 4, G9) so the /changes "What else I considered"
 *  panel (alternatives-panel.ts) can name a rejected alternative in the same words
 *  the in-card debate line already uses, instead of inventing a second phrasing. */
export const ACTION_PLAIN_FOR_DEBATE: Record<MoveRouterAction, string> = {
  create_page: "a new page", edit_existing_page: "an edit to the existing page",
  add_answer_block: "an answer block", add_schema: "structured data",
  change_title_meta: "a title change", add_internal_links: "an internal link",
  build_tool: "a tool", build_calculator: "a calculator", create_asset: "a new asset",
  fix_ux: "fixing the experience first", get_backlinks: "backlink outreach",
  local_seo_update: "a local SEO update", improve_image_seo: "image SEO",
  optimize_product_page: "a product page update", wait: "waiting",
};

/** BEACON_500 item 70 - one resolved specialist reliability weight, threaded in by the caller
 *  rather than imported so this module stays a leaf (see the module doc). Matches the shape
 *  src/domains/team-scoreboard/specialist-weights.ts's ReliabilityWeight already returns; only the
 *  two fields the router needs are declared here to avoid a type-only import across the domain
 *  boundary. */
export type SpecialistVoteWeight = {
  /** Bounded [0.85, 1.15], 1.0 when neutral (no proven record yet). */
  weight: number;
  /** Plain-English explainable line ("Search demand has called 8 of its last 11 winners here, so
   *  its vote counts a bit more."), or null when neutral. */
  tag: string | null;
};

/** BEACON_500 item 70 - resolves ONE specialist's vote weight for ONE lever family (the
 *  MoveRouterAction it is voting for, mapped through actionFamilyOf so it lines up with the same
 *  family keys the team scoreboard already tallies by). Optional: omitted entirely, every opinion's
 *  weight is 1.0 and routeMove is byte-identical to its pre-item-70 behavior. */
export type SpecialistWeightLookup = (specialist: string, family: string) => SpecialistVoteWeight | null | undefined;

type RouteInput = {
  packet: EvidencePacket;
  opinions: SpecialistOpinion[];
  /** The full MoveCandidate when the caller has it (richer than packet.move). */
  move?: MoveCandidate | null;
  /** BEACON_500 item 70 - the caller's resolved specialist-weight table lookup (typically
   *  specialist-weights.ts's SpecialistWeightTable.get, bound). Omitted by default; every existing
   *  call site keeps its current, unweighted behavior until it opts in. */
  specialistWeight?: SpecialistWeightLookup;
  /** N6 (2026-07-02) - options for the query-intent veto (intent-veto.ts). Omitted entirely ⇒
   *  the veto still runs (it is a pure, $0, deterministic check with no downside) but with
   *  `tenantHasNoTransactionalSurface` unset, so the transactional-surface rule abstains.
   *  `enabled: false` fully disables the check for a byte-identical-to-pre-N6 call site (e.g. a
   *  pinned regression test that must never see the new objection kind). */
  intentVeto?: { enabled?: boolean; tenantHasNoTransactionalSurface?: boolean };
};

/** BEACON_500 item 70 - one specialist's resolved vote weight as applied to a routed decision,
 *  attached for a scoreboard/roundtable surface to explain "why this vote counted more/less".
 *  Only opinions with a non-neutral (weight !== 1) resolution are included - a neutral weight has
 *  nothing to explain. */
export type AppliedSpecialistWeight = {
  specialist: string;
  family: string;
  weight: number;
  tag: string;
};

/**
 * Debate the opinions into one decision. Deterministic. Degrades gracefully: with
 * NO opinions it reproduces the demand graph's own gap classification + score, so
 * wiring it in can never regress today's behavior.
 */
export function routeMove(input: RouteInput): MoveRouterDecision {
  const { packet, opinions, specialistWeight } = input;
  const gap = input.move?.gap ?? packet.move.gapType;
  const baseScore = input.move?.score ?? packet.move.score;
  const baseConfidence =
    CONF_LEVEL_TO_NUM[input.move?.confidence ?? packet.move.confidence] ?? 0.5;

  // 1) Seed from the graph's honest first-pass classification.
  const seedAction: MoveRouterAction = GAP_TO_ACTION[gap] ?? "wait";
  let action: MoveRouterAction = seedAction;
  let rationale = packet.move.label
    ? `Demand graph routed "${packet.move.label}" to ${action.replace(/_/g, " ")}.`
    : `Routed to ${action.replace(/_/g, " ")}.`;

  // 2) Tally weighted votes - ONE vote per specialist, split evenly across its suggestedMoveTypes
  //    (item 49). A voice listing two actions (e.g. ["add_answer_block", "add_schema"]) casts
  //    0.5 confidence-weight to each instead of its full confidence to both, so a single opinion
  //    can never out-vote two opinions that each committed to one action.
  //
  //    Item 70 - BEFORE splitting, each action's share of an opinion's confidence is multiplied by
  //    that specialist's learned reliability weight for the LEVER FAMILY the action belongs to
  //    (actionFamilyOf), when a `specialistWeight` lookup was passed. A specialist proven to call
  //    more winners in that family gets a bit more say; the reverse for a chronically-missed or
  //    overconfident one. With no lookup (the default), every weight is 1 and the tally below is
  //    numerically identical to before item 70 - pinned by move-router.test.ts.
  const votes = new Map<MoveRouterAction, number>();
  const appliedWeights: AppliedSpecialistWeight[] = [];
  const seenWeightKeys = new Set<string>();
  let totalVoteWeight = 0;
  for (const o of opinions) {
    const n = o.suggestedMoveTypes.length;
    if (n === 0) continue;
    const baseShare = o.confidence / n;
    let opinionWeightSum = 0;
    for (const a of o.suggestedMoveTypes) {
      const family = actionFamilyOf(a);
      const resolved = specialistWeight?.(o.specialist, family);
      const w = resolved?.weight ?? 1;
      votes.set(a, (votes.get(a) ?? 0) + baseShare * w);
      opinionWeightSum += w;
      const dedupeKey = `${o.specialist}::${family}`;
      if (resolved && resolved.tag && w !== 1 && !seenWeightKeys.has(dedupeKey)) {
        seenWeightKeys.add(dedupeKey);
        appliedWeights.push({ specialist: o.specialist, family, weight: w, tag: resolved.tag });
      }
    }
    // The opinion's contribution to totalVoteWeight also reflects the (average, across its
    // suggested actions) learned weight, so a decisively up-weighted or down-weighted specialist
    // moves its real share of the team's total voice, not just its own action's tally.
    totalVoteWeight += o.confidence * (opinionWeightSum / n);
  }

  // 2b) ELECT the winner from the tally when it clearly beats the seed (item 49). The sorted
  //     tally used to feed whyNot lines only; now a decisive plurality can take the decision.
  //     Margin = (topVoteWeight - seedVoteWeight) / totalVoteWeight, so it reads as "how much of
  //     the team's total voice backs the alternative over the default". Ties and narrow leads
  //     keep the seed (the pre-existing "seed wins when close" behavior), so this can only ADD
  //     confidence to a genuinely lopsided debate, never destabilize an ordinary one.
  let electedBy: "seed" | "vote" = "seed";
  let margin = 0;
  if (totalVoteWeight > 0) {
    const sortedVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [topAction, topWeight] = sortedVotes[0] ?? [seedAction, 0];
    const seedWeight = votes.get(seedAction) ?? 0;
    const computedMargin = (topWeight - seedWeight) / totalVoteWeight;
    const voiceCount = opinions.filter((o) => o.suggestedMoveTypes.includes(topAction)).length;
    if (topAction !== seedAction && computedMargin > VOTE_ELECTION_MARGIN && voiceCount >= VOTE_ELECTION_MIN_VOICES) {
      action = topAction;
      electedBy = "vote";
      margin = computedMargin;
      rationale =
        `The team outvoted the default here: ${voiceCount} voices back ` +
        `${ACTION_PLAIN_FOR_DEBATE[topAction] ?? topAction.replace(/_/g, " ")} over ` +
        `${ACTION_PLAIN_FOR_DEBATE[seedAction] ?? seedAction.replace(/_/g, " ")} ` +
        `(${Math.round(computedMargin * 100)}% margin).`;
    }
  }

  const appliedObjections: Objection[] = [];
  const whyNot: string[] = [];

  // N6 (2026-07-02) - the query-intent veto (intent-veto.ts). Runs against the
  // action as decided so far (seed or vote-elected), same timing as the other
  // vetoes/downgrades below. `checkIntentVeto` is a pure function this module
  // owns the call site for - it returns null when the classifier abstains (no
  // query/fanout signal) or no rule finds a mismatch, so a caller that never
  // exercises the mismatch path gets byte-identical behavior to before N6.
  const intentObjection = input.intentVeto?.enabled === false
    ? null
    : checkIntentVeto({
        packet,
        action,
        tenantHasNoTransactionalSurface: input.intentVeto?.tenantHasNoTransactionalSurface,
      });

  // 3) Apply VETOes - they override the action. Checked against the seed AND the (possibly
  //    vote-elected) current action, so a veto aimed at the graph's original classification
  //    still fires even when the vote already moved the decision away from it (item 49: vetoes
  //    still apply after election).
  const vetoes = opinions.flatMap((o) => o.objections).filter((ob) => ob.severity === "veto");
  if (intentObjection?.severity === "veto") vetoes.push(intentObjection);
  for (const v of vetoes) {
    const hitsCurrent = v.against.length === 0 || v.against.includes(action) || v.against.includes(seedAction);
    if (!hitsCurrent) continue;
    if (v.kind === "already_ranks") {
      action = "edit_existing_page";
      rationale = `DataForSEO: you already rank - routed to an edit, not a new page. ${v.detail}`;
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
    } else if (v.kind === "wrong_lever_for_intent") {
      // N6 - the intent veto has no single "right" fallback lever the way
      // already_ranks (→ edit) or fix_ux_first (→ fix_ux) do: the honest move
      // when a lever cannot serve the dominant intent is to hold, not to guess
      // a replacement action. `wait` is a first-class recommendation here.
      action = "wait";
      rationale = v.detail;
      appliedObjections.push(v);
      whyNot.push(`${v.against[0]?.replace(/_/g, " ") ?? "the lever"} vetoed: wrong for the dominant search intent.`);
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
  if (hasGsc && hasProfound && overlapMult > 1) {
    confidence = clamp01(confidence * 1.3);
    scoreMult *= overlapMult;
    rationale += " Google + AI both confirm this demand (double-confirmed).";
  }

  // 5) Apply DOWNGRADES - they cut confidence + score but don't change the action.
  const downgrades = opinions.flatMap((o) => o.objections).filter((ob) => ob.severity === "downgrade");
  if (intentObjection?.severity === "downgrade") downgrades.push(intentObjection);
  for (const d of downgrades) {
    const hitsCurrent = d.against.length === 0 || d.against.includes(action);
    if (!hitsCurrent) continue;
    confidence *= 0.75;
    scoreMult *= 0.85;
    appliedObjections.push(d);
  }
  // Any specialist asking for a flat score cut (e.g. Wix not-pushable) applies too -
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
      whyNot.push(`Considered ${a.replace(/_/g, " ")} (support ${w.toFixed(1)}) - ${action.replace(/_/g, " ")} ranked higher.`);
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
    electedBy,
    margin,
    appliedWeights,
  };
}
