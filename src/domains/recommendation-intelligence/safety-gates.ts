/**
 * 2026-05-20 — Slice 4.5.D.α₀a.3a — promotion safety-gates (pure).
 *
 * `applyPromotionSafetyGates(candidate, ctx)` runs a 13-step
 * ordered ladder over a `RecommendationCandidateRow`. The first
 * failing step wins (single binding suppression). All steps are
 * pure; no I/O; no mutation.
 *
 * The orchestrator (`promote-to-queue.ts`, α₀a.3b) layers
 * batch-level cap rules on top. Those caps are NOT here — keep
 * the per-row gate set self-contained.
 *
 * Imports stay on the local-types path (`@/domains/recommendation-
 * intelligence/dedupe-cooldown` for `PromotionEditAnchor` +
 * `PromotionResponseAnchor` + cooldown primitives). NO import
 * from `recommended-edits-persistence` or `recommendation-
 * response-store` (operator-locked α₀a contract).
 */

import type { ActionType } from "@/domains/recommendations/action-types";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

import {
  eligibilityForTrigger,
  type EligibilityTier,
} from "@/domains/recommendation-intelligence/promotion-eligibility";
import {
  buildPromotionCooldownKey,
  buildPromotionDedupeKey,
  isInCooldown,
  promotionEditStatus,
  type PromotionEditAnchor,
  type PromotionResponseAnchor,
} from "@/domains/recommendation-intelligence/dedupe-cooldown";

// ---------------------------------------------------------------------------
// Locked sets
// ---------------------------------------------------------------------------

/** Content-edit families subject to gates 7–9 (target_url +
 *  page-type requirements). `fix_*` families BYPASS those gates
 *  — operators may repair sitemap / robots / status / canonical
 *  on any URL kind (utility pages included). */
const CONTENT_EDIT_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "edit_title",
  "edit_meta",
  "change_h1",
  "add_h2_section",
  "add_faq",
  "add_schema",
  "add_internal_link",
]);

/** Page types where content-edit promotion is suppressed.
 *  Mirrors the upstream `recommendation-triggers-page-classifier-
 *  applied` invariant at the promotion boundary. */
const CONTENT_EDIT_SKIP_PAGE_TYPES: ReadonlySet<PageType> =
  new Set<PageType>(["utility", "technical_asset", "other"]);

/** First-party Google Search demand signals (Insight Graph). Each
 *  only emits above a real per-query impressions floor, so its
 *  presence is ground truth that the target is a trafficked content
 *  page — enough to override the page-classifier's AMBIGUOUS "other"
 *  verdict at Gate 9 (the "couldn't place it" bucket), but NEVER the
 *  positive "utility" / "technical_asset" verdicts. Pivot 2026-06-13:
 *  first-party search demand is hierarchy tier 2; a page Google ranks
 *  for queries is not a throwaway page, and its demand-driven title /
 *  meta rewrite must reach the queue even when `contentSiteMode` was
 *  never configured for the tenant. */
const GSC_DEMAND_SIGNALS: ReadonlySet<string> = new Set<string>([
  "gsc_low_ctr",
  "gsc_striking_distance",
]);

const SIGNAL_STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Operator-readable suppression reasons. Pinned by the 5
 *  α₀a.3a architecture invariants. The cap reasons
 *  (`max_rows_per_page` / `max_rows_per_family`) belong to the
 *  orchestrator's result type (α₀a.3b), NOT this union. */
export type SuppressionReason =
  | "blocked_tier"
  | "diagnostic_only_tier"
  | "low_confidence"
  | "safety_flags_set"
  | "no_evidence"
  | "missing_target_url"
  | "missing_target_page_type"
  | "skip_page_type"
  | "in_cooldown"
  | "accepted_ancestor_exists"
  | "signal_stale"
  | "prerequisite_unresolved";

export type SafetyGateContext = {
  tenantId: string;
  /** Caller-computed page type (e.g., via `classifyPageType`).
   *  Null means "page type unknown for this URL" — content-edit
   *  families suppress; fix_* families bypass. */
  targetPageType: PageType | null;
  recommendedEdits: ReadonlyArray<PromotionEditAnchor>;
  recommendationResponses: ReadonlyArray<PromotionResponseAnchor>;
  /** Forward-compat: candidate row has no `prerequisite_key`
   *  today; the orchestrator defaults this to `true` until a
   *  future slice introduces prerequisite tracking. */
  prerequisiteResolved: boolean;
  now: Date;
};

export type SafetyGateOutcome = {
  eligible: boolean;
  tier: EligibilityTier;
  suppression_reason: SuppressionReason | null;
  /** Populated by Gate 10 (in_cooldown) with the binding
   *  cooldown's ISO expiry; null otherwise. */
  cooldown_expires_at: string | null;
};

// ---------------------------------------------------------------------------
// Gate ladder
// ---------------------------------------------------------------------------

const ACCEPTED_ANCESTOR_STATUSES = new Set([
  "accepted",
  "verified_live",
  "verified_live_modified",
  "partially_implemented",
]);

export function applyPromotionSafetyGates(
  candidate: RecommendationCandidateRow,
  ctx: SafetyGateContext,
): SafetyGateOutcome {
  const tier = eligibilityForTrigger(
    candidate.trigger_signal,
    candidate.action_type,
  );

  // Gates 1–3 — eligibility tier check.
  if (tier === "blocked") return suppress(tier, "blocked_tier");
  if (tier === "diagnostic-only") return suppress(tier, "diagnostic_only_tier");
  // operator-review-only auto-suppressed until α₂'s approve-to-
  // promote affordance (operator-locked α₀a.2 decision U4).
  if (tier === "operator-review-only") {
    return suppress(tier, "diagnostic_only_tier");
  }

  // Gate 4 — confidence ≠ low.
  if (candidate.confidence === "low") return suppress(tier, "low_confidence");

  // Gate 5 — no safety flags.
  if (candidate.safety_flags.length > 0) {
    return suppress(tier, "safety_flags_set");
  }

  // Gate 6 — evidence ≥ 1.
  if (candidate.evidence.length === 0) return suppress(tier, "no_evidence");

  // Gates 7–9 — content-edit family checks (fix_* bypass).
  const isContentEdit = CONTENT_EDIT_ACTION_TYPES.has(candidate.action_type);
  if (isContentEdit) {
    if (candidate.target_url == null) {
      return suppress(tier, "missing_target_url");
    }
    if (ctx.targetPageType == null) {
      return suppress(tier, "missing_target_page_type");
    }
    if (CONTENT_EDIT_SKIP_PAGE_TYPES.has(ctx.targetPageType)) {
      // First-party Google Search demand overrides the classifier's
      // ambiguous "other" verdict (see GSC_DEMAND_SIGNALS). Hard-skip
      // on "utility" / "technical_asset" is NOT relaxed — those are
      // positive classifications, not the unknown bucket.
      const gscDemandOverridesOther =
        ctx.targetPageType === "other" &&
        GSC_DEMAND_SIGNALS.has(candidate.trigger_signal);
      if (!gscDemandOverridesOther) {
        return suppress(tier, "skip_page_type");
      }
    }
  }

  // Gate 10 — cooldown via α₀a.2's isInCooldown.
  const cooldownKey = buildPromotionCooldownKey({
    tenantId: candidate.tenant_id,
    actionType: candidate.action_type,
    targetUrl: candidate.target_url,
  });
  const cooldown = isInCooldown({
    cooldownKey,
    tenantId: candidate.tenant_id,
    actionType: candidate.action_type,
    targetUrl: candidate.target_url,
    recommendedEdits: ctx.recommendedEdits,
    recommendationResponses: ctx.recommendationResponses,
    now: ctx.now,
  });
  if (cooldown.in_cooldown) {
    return {
      eligible: false,
      tier,
      suppression_reason: "in_cooldown",
      cooldown_expires_at: cooldown.expires_at,
    };
  }

  // Gate 11 — accepted ancestor at the SAME promotion dedupe key.
  // Candidate has no target_element_key today (forward-compat
  // slot); use null on both sides so the dedupe-key match is
  // coarse-but-correct for α₀a.3a.
  const candidateDedupe = buildPromotionDedupeKey({
    tenantId: candidate.tenant_id,
    actionType: candidate.action_type,
    targetUrl: candidate.target_url,
    targetElementKey: null,
    topicClusterLabel: candidate.topic_cluster_label,
  });
  for (const row of ctx.recommendedEdits) {
    if (row.tenant_id !== candidate.tenant_id) continue;
    if (row.action_type !== candidate.action_type) continue;
    if ((row.target_url ?? null) !== (candidate.target_url ?? null)) continue;
    const rowDedupe = buildPromotionDedupeKey({
      tenantId: row.tenant_id,
      actionType: row.action_type,
      targetUrl: row.target_url ?? null,
      targetElementKey: row.target_element_key ?? null,
      topicClusterLabel: candidate.topic_cluster_label,
    });
    if (rowDedupe !== candidateDedupe) continue;
    const status = promotionEditStatus(row);
    if (ACCEPTED_ANCESTOR_STATUSES.has(status)) {
      return suppress(tier, "accepted_ancestor_exists");
    }
  }

  // Gate 12 — signal_stale.
  const signalAt = new Date(candidate.created_from_signal_at);
  if (Number.isNaN(signalAt.getTime())) {
    return suppress(tier, "signal_stale");
  }
  if (ctx.now.getTime() - signalAt.getTime() > SIGNAL_STALE_DAYS * DAY_MS) {
    return suppress(tier, "signal_stale");
  }

  // Gate 13 — prerequisite resolved.
  if (!ctx.prerequisiteResolved) {
    return suppress(tier, "prerequisite_unresolved");
  }

  return {
    eligible: true,
    tier,
    suppression_reason: null,
    cooldown_expires_at: null,
  };
}

function suppress(
  tier: EligibilityTier,
  reason: SuppressionReason,
): SafetyGateOutcome {
  return {
    eligible: false,
    tier,
    suppression_reason: reason,
    cooldown_expires_at: null,
  };
}
