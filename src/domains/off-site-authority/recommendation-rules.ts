/**
 * Section 7 C7c (2026-05-16) — Off-Site Recommendation Rules.
 *
 * Pure decision-tree layer. Maps an `OffSitePresenceSnapshot` (C7a)
 * into operator-facing candidate actions. The 7 off-site action
 * types referenced here were registered in C7b with
 * `generatorActive: false` — i.e. the LLM never produces them.
 *
 * Locked posture:
 *   • Pure compute only. NO imports of `getRepository`,
 *     `getBusinessConfig`, connector-store, local-reviews-store,
 *     tenant-context, persistence/repositories, connectors, or any
 *     HTTP / LLM provider module. All inputs flow in as arguments
 *     via the snapshot.
 *   • NO persistence. C7c writes zero `recommended_edits` rows.
 *     The candidates output is consumed by the operator-only
 *     diagnostic preview only.
 *   • Operator surfaces only. Customer surfaces (C7d/C7e) remain
 *     BLOCKED by the existing `off-site-authority-multi-tenant-
 *     prerequisite` catalog row.
 *   • Every candidate carries `manual_only: true` as a LITERAL
 *     type. A future drive-by that wants to automate any of the
 *     7 action types would have to widen the type AND the
 *     architecture invariant.
 *
 * Decision rules (deterministic — see test file for the truth
 * table):
 *   1. `is_local_service === false` → all 7 channels emit silent
 *      `not_local_service`; candidates is empty.
 *   2. GBP / Yelp emit candidates per locked thresholds.
 *   3. Houzz / Angi / BBB / industry_directory / local_press always
 *      emit silent `detection_not_implemented` because C7g detection
 *      hasn't shipped.
 *   4. `pursue_local_pr` is registered (C7b) but no rule fires for
 *      it in C7c — local press detection arrives in C7g.
 *
 * Customer-safe copy: no causal claims about AI citation, ranking,
 * revenue, or visibility. Operator-preview phrasing nudges manual
 * follow-up. Architecture invariant
 * `off-site-recommendation-rules-customer-copy.test.ts` pins the
 * forbidden vocabulary list.
 */

import type { ActionType } from "@/domains/recommendations/action-types";
import type {
  OffSitePresenceChannel,
  OffSitePresenceSnapshot,
} from "./types";

// ─────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────

export type OffSiteCandidateSilenceReason =
  | "not_local_service"
  | "detection_not_implemented"
  | "insufficient_signal"
  | "channel_healthy"
  | "policy_risk_manual_only";

export type OffSiteCandidateConfidence = "high" | "medium" | "low";

export type OffSiteCandidateAction = {
  /** Stable id: `${channel}:${actionType}`. */
  id: string;
  actionType: ActionType;
  channel: OffSitePresenceChannel;
  /** Operator-preview title. Customer-safe phrasing. */
  title: string;
  /** Operator-preview rationale (≤ 2 short sentences). Customer-safe. */
  rationale: string;
  /**
   * Rule's own confidence in the decision. Decoupled from C7a's
   * channel confidence so a `low` channel signal can still produce a
   * `medium` rule confidence when the rule fires deterministically.
   */
  confidence: OffSiteCandidateConfidence;
  /** C7a channel source carried through for the operator's audit trail. */
  source_note: string;
  /**
   * LITERAL `true` on every candidate. Off-site actions are
   * recommendations Beacon GIVES, never actions Beacon PERFORMS.
   * A future automation drive-by would have to widen this type AND
   * the architecture invariant.
   */
  manual_only: true;
  /**
   * `true` for action types that carry a policy / automation risk:
   *   • `request_gbp_reviews` — review-solicitation policy
   *   • `pursue_local_pr` — PR-outreach policy (not fired in C7c)
   * Operator surfaces these with an extra warning badge.
   */
  policy_risk: boolean;
};

export type OffSiteChannelDecision =
  | {
      kind: "candidate";
      channel: OffSitePresenceChannel;
      candidate: OffSiteCandidateAction;
    }
  | {
      kind: "silent";
      channel: OffSitePresenceChannel;
      reason: OffSiteCandidateSilenceReason;
    };

export type OffSiteRecommendationCandidates = {
  tenant_id: string;
  is_local_service: boolean;
  /**
   * Exactly one decision per channel, in the same order as
   * `snapshot.channels`. For C7a's fixed order this is:
   * gbp, yelp, houzz, angi, bbb, industry_directory, local_press.
   */
  decisions: OffSiteChannelDecision[];
  /**
   * Subset of `decisions` where `kind === "candidate"`. Stable order
   * (same as decisions).
   */
  candidates: OffSiteCandidateAction[];
  /** Mirrors snapshot.data_sources_note verbatim — preserves the
   *  multi-tenant disclosure on the operator preview. */
  data_sources_note: string[];
  /** Mirrors snapshot.generated_at — no separate clock. */
  generated_at: string;
};

// ─────────────────────────────────────────────────────────────────────
// Locked copy
// ─────────────────────────────────────────────────────────────────────

// Operator-preview titles + rationales. No causal claim about AI
// citation, ranking, revenue, or visibility. Customer-safe
// vocabulary (forbidden-vocab invariant pins the scan).

const GBP_CLAIM_TITLE = "Claim your Google Business Profile";
const GBP_CLAIM_RATIONALE =
  "Beacon did not find a confirmed Google Business Profile connection. Consider manually reviewing whether the listing is claimed and complete.";

const GBP_OPTIMIZE_TITLE = "Review your Google Business Profile details";
const GBP_OPTIMIZE_RATIONALE =
  "Your Google Business Profile is connected, but no review data has been ingested yet. Manual follow-up: confirm hours, services, photos, and profile details are current.";

const GBP_REQUEST_REVIEWS_TITLE = "Encourage new Google reviews";
const GBP_REQUEST_REVIEWS_RATIONALE =
  "Your Google Business Profile has fewer than 11 reviews ingested. Consider encouraging satisfied customers to leave a review — never automate or gate this; follow Google's review policy.";

const YELP_CLAIM_TITLE = "Claim or improve your Yelp profile";
const YELP_CLAIM_RATIONALE_NOT_CLAIMED =
  "Beacon did not find a confirmed Yelp connection. Consider manually reviewing whether the listing is claimed and complete.";
const YELP_CLAIM_RATIONALE_CLAIMED_THIN =
  "Your Yelp profile is connected, but no review data has been ingested yet. Manual follow-up: confirm business hours, photos, and category accuracy.";

// ─────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────

function candidate(
  channel: OffSitePresenceChannel,
  actionType: ActionType,
  title: string,
  rationale: string,
  confidence: OffSiteCandidateConfidence,
  source_note: string,
  policy_risk: boolean,
): OffSiteChannelDecision {
  return {
    kind: "candidate",
    channel,
    candidate: {
      id: `${channel}:${actionType}`,
      actionType,
      channel,
      title,
      rationale,
      confidence,
      source_note,
      manual_only: true,
      policy_risk,
    },
  };
}

function silent(
  channel: OffSitePresenceChannel,
  reason: OffSiteCandidateSilenceReason,
): OffSiteChannelDecision {
  return { kind: "silent", channel, reason };
}

function sourceNote(
  channel: OffSitePresenceChannel,
  channelSource: string,
  channelConfidence: string,
): string {
  return `Channel "${channel}" (source: ${channelSource}, confidence: ${channelConfidence}).`;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function computeOffSiteRecommendationCandidates(
  snapshot: OffSitePresenceSnapshot,
): OffSiteRecommendationCandidates {
  const decisions: OffSiteChannelDecision[] = [];

  // 1. Local-service gate.
  if (!snapshot.is_local_service) {
    for (const ch of snapshot.channels) {
      decisions.push(silent(ch.channel, "not_local_service"));
    }
    return {
      tenant_id: snapshot.tenant_id,
      is_local_service: false,
      decisions,
      candidates: [],
      data_sources_note: [...snapshot.data_sources_note],
      generated_at: snapshot.generated_at,
    };
  }

  // 2. Per-channel rules (decisions preserve snapshot channel order).
  for (const ch of snapshot.channels) {
    const note = sourceNote(ch.channel, ch.source, ch.confidence);

    if (ch.channel === "gbp") {
      if (ch.claimed === false) {
        decisions.push(
          candidate(
            "gbp",
            "claim_gbp",
            GBP_CLAIM_TITLE,
            GBP_CLAIM_RATIONALE,
            "medium",
            note,
            false,
          ),
        );
      } else if (ch.claimed === true && ch.review_count == null) {
        decisions.push(
          candidate(
            "gbp",
            "optimize_gbp_profile",
            GBP_OPTIMIZE_TITLE,
            GBP_OPTIMIZE_RATIONALE,
            "low",
            note,
            false,
          ),
        );
      } else if (
        ch.claimed === true &&
        ch.review_count != null &&
        ch.review_count >= 1 &&
        ch.review_count <= 10
      ) {
        decisions.push(
          candidate(
            "gbp",
            "request_gbp_reviews",
            GBP_REQUEST_REVIEWS_TITLE,
            GBP_REQUEST_REVIEWS_RATIONALE,
            "low",
            note,
            true,
          ),
        );
      } else if (
        ch.claimed === true &&
        ch.review_count != null &&
        ch.review_count >= 11 &&
        ch.rating != null &&
        ch.rating >= 4.0
      ) {
        decisions.push(silent("gbp", "channel_healthy"));
      } else if (
        ch.claimed === true &&
        ch.review_count != null &&
        ch.review_count >= 11 &&
        ch.rating != null &&
        ch.rating < 4.0
      ) {
        decisions.push(silent("gbp", "insufficient_signal"));
      } else {
        // Defensive fallback: claimed null, or any unmodeled combo.
        decisions.push(silent("gbp", "insufficient_signal"));
      }
      continue;
    }

    if (ch.channel === "yelp") {
      if (ch.claimed === false) {
        decisions.push(
          candidate(
            "yelp",
            "claim_or_optimize_yelp",
            YELP_CLAIM_TITLE,
            YELP_CLAIM_RATIONALE_NOT_CLAIMED,
            "medium",
            note,
            false,
          ),
        );
      } else if (ch.claimed === true && ch.review_count == null) {
        decisions.push(
          candidate(
            "yelp",
            "claim_or_optimize_yelp",
            YELP_CLAIM_TITLE,
            YELP_CLAIM_RATIONALE_CLAIMED_THIN,
            "low",
            note,
            false,
          ),
        );
      } else if (
        ch.claimed === true &&
        ch.review_count != null &&
        ch.review_count >= 1 &&
        ch.rating != null &&
        ch.rating >= 4.0
      ) {
        decisions.push(silent("yelp", "channel_healthy"));
      } else if (
        ch.claimed === true &&
        ch.review_count != null &&
        ch.review_count >= 1 &&
        ch.rating != null &&
        ch.rating < 4.0
      ) {
        decisions.push(silent("yelp", "insufficient_signal"));
      } else {
        // Defensive fallback for unmodeled combos (e.g., claimed null).
        decisions.push(silent("yelp", "insufficient_signal"));
      }
      continue;
    }

    // Section 7 C7g v1 (2026-05-16) — Houzz / Angi / BBB /
    // industry_directory: when the C7a snapshot flips to
    // `source: "business_config"` because the operator entered a
    // valid http(s) profile URL, the channel is treated as
    // operator-vouched healthy. Beacon has NOT HTTP-verified the
    // URL in v1, so the channel-healthy branch is honest: "operator
    // says this is set up; no further action recommended." No
    // candidate fires. C7g v2 (HTTP HEAD verification) will
    // re-enable candidate emission when a configured URL becomes
    // unreachable.
    if (
      (ch.channel === "houzz" ||
        ch.channel === "angi" ||
        ch.channel === "bbb" ||
        ch.channel === "industry_directory") &&
      ch.claimed === true &&
      ch.source === "business_config"
    ) {
      decisions.push(silent(ch.channel, "channel_healthy"));
      continue;
    }

    // Houzz / Angi / BBB / industry_directory / local_press —
    // detection not implemented until configured (or, for
    // local_press, until a different detection mechanism ships).
    // No candidates fire. `pursue_local_pr` never appears in C7c
    // and stays that way in C7g v1.
    decisions.push(silent(ch.channel, "detection_not_implemented"));
  }

  const candidates: OffSiteCandidateAction[] = decisions
    .filter(
      (d): d is Extract<OffSiteChannelDecision, { kind: "candidate" }> =>
        d.kind === "candidate",
    )
    .map((d) => d.candidate);

  return {
    tenant_id: snapshot.tenant_id,
    is_local_service: true,
    decisions,
    candidates,
    data_sources_note: [...snapshot.data_sources_note],
    generated_at: snapshot.generated_at,
  };
}
