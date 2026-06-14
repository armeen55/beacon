/**
 * 2026-05-20 — Slice 4.5.D.α₀a.2 — promotion dedupe + cooldown
 * primitives. Pure module. No imports from persistence stores.
 *
 * Local minimal anchor types are structurally compatible with
 * `RecommendedEditRow` + `RecommendationResponse` so callers pass
 * real rows through TS structural typing without an adapter.
 *
 * α₀a.2 ships these primitives ONLY. Safety gates + the
 * `selectPromotableCandidates` orchestrator land in α₀a.3.
 */

import { createHash } from "node:crypto";

import type { ActionType } from "@/domains/recommendations/action-types";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * The 9 `ImplementationStatus` values that exist in
 * `recommended_edits` today. Re-declared locally to keep this
 * module independent of `recommended-edits-persistence`.
 *
 * `verified_live_decay_refire` is NOT a real status (operator
 * decision Q2, 2026-05-20). Do not add fake/future statuses.
 */
export type PromotionEditStatus =
  | "recommended"
  | "accepted"
  /** §push (2026-06-10): Beacon published the approved edit itself.
   *  Cooldown = verified_live (the change is live; don't re-fire). */
  | "pushed"
  /** §push: adapter failed; card still actionable → accepted-like. */
  | "push_failed"
  | "verified_live"
  | "verified_live_modified"
  | "needs_review"
  | "wrong_page"
  | "partially_implemented"
  | "not_found_after_7d"
  /** Night-shift #114 (2026-06-11): auto-expired by the nightly queue
   *  sweeper (TTL / queue-cap overflow). Machine hygiene, not operator
   *  rejection. */
  | "expired"
  | "dismissed";

/** Minimal anchor shape for `isInCooldown` reads. */
export type PromotionEditAnchor = {
  tenant_id: string;
  action_type: ActionType;
  target_url: string | null;
  target_element_key?: string | null;
  implementation_status?: PromotionEditStatus;
  live_at?: string | null;
  updated_at?: string;
  created_at?: string;
};

/** Minimal response shape. α₀a.2 only honors `dismissed` with a
 *  non-null `targetPageUrl` (operator decision Q3, 2026-05-20). */
export type PromotionResponseAnchor = {
  recId: string;
  status: "accepted" | "dismissed" | "deferred";
  respondedAt: string;
  deferUntil?: string | null;
  targetPageUrl?: string | null;
  patternId?: string | null;
};

export type CooldownResult = {
  in_cooldown: boolean;
  /** Operator-readable trace, e.g. `cooldown_dismissed_recommended_edits`. */
  reason: string | null;
  /** ISO timestamp at which the binding cooldown clears. */
  expires_at: string | null;
};

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

export type PromotionDedupeKeyInput = {
  tenantId: string;
  actionType: ActionType;
  targetUrl: string | null;
  targetElementKey: string | null;
  topicClusterLabel: string | null;
};

/**
 * 5-part sha1 `tenant::action::url|no_url::elementKey|no_key::topic|no_topic`.
 * Distinct from the emitter 4-part dedupe key — promotion adds
 * `target_element_key` precision. Pinned by
 * `recommendation-intelligence-dedupe-key-formula`.
 */
export function buildPromotionDedupeKey(
  input: PromotionDedupeKeyInput,
): string {
  const canonical = [
    input.tenantId,
    input.actionType,
    input.targetUrl ?? "no_url",
    input.targetElementKey ?? "no_key",
    input.topicClusterLabel ?? "no_topic",
  ].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}

export type PromotionCooldownKeyInput = {
  tenantId: string;
  actionType: ActionType;
  targetUrl: string | null;
};

/**
 * 3-part sha1 `tenant::action::url|no_url`. Coarser than
 * promotion dedupe — survives across `target_element_key` +
 * `topic_cluster_label` variants so cooldown is per (page ×
 * action). Pinned by `recommendation-intelligence-dedupe-key-formula`.
 */
export function buildPromotionCooldownKey(
  input: PromotionCooldownKeyInput,
): string {
  const canonical = [
    input.tenantId,
    input.actionType,
    input.targetUrl ?? "no_url",
  ].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Window table + helpers (operator-locked Section 4.5.O6)
// ---------------------------------------------------------------------------

/**
 * Operator-locked cooldown windows in DAYS.
 * `no_prior` is a sentinel; never used in branching (the
 * empty-array short-circuit handles it).
 * `not_found_after_7d = 0` per operator Q1 — system verification
 * state, not user rejection; re-fire freely.
 * Pinned by `recommendation-intelligence-cooldown-windows`.
 */
export const COOLDOWN_WINDOW_DAYS: Readonly<
  Record<PromotionEditStatus | "no_prior", number>
> = {
  dismissed: 90,
  accepted: 30,
  pushed: 180,
  push_failed: 30,
  verified_live: 180,
  verified_live_modified: 180,
  wrong_page: 14,
  partially_implemented: 60,
  needs_review: 14,
  recommended: 0,
  not_found_after_7d: 0,
  // Night-shift #114 (2026-06-11): auto-expiry is machine hygiene, not
  // operator rejection — a 30d window lets a still-firing trigger
  // re-promote the move a month later (vs dismissed: 90).
  expired: 30,
  no_prior: 0,
} as const;

export function getCooldownWindowForStatus(
  status: PromotionEditStatus | "no_prior",
): number {
  return COOLDOWN_WINDOW_DAYS[status];
}

/** Legacy-row fallback: missing status defaults to `recommended`. */
export function promotionEditStatus(
  row: Pick<PromotionEditAnchor, "implementation_status">,
): PromotionEditStatus {
  return row.implementation_status ?? "recommended";
}

// ---------------------------------------------------------------------------
// Cooldown check
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISSED_RESPONSE_WINDOW_DAYS = 90;

export type IsInCooldownInput = {
  cooldownKey: string;
  tenantId: string;
  actionType: ActionType;
  targetUrl: string | null;
  recommendedEdits: ReadonlyArray<PromotionEditAnchor>;
  recommendationResponses: ReadonlyArray<PromotionResponseAnchor>;
  now: Date;
};

/**
 * Walks priors for the same cooldown_key; picks the
 * LATEST-EXPIRING binding window (the constraint the operator
 * must wait past). Anchor preference per row:
 * `live_at > updated_at > created_at`. Rows with no usable
 * anchor or window=0 are skipped. Cross-tenant rows ignored.
 * `recommendationResponses`: only `dismissed` whose `recId` matches
 * this candidate's `promotion-<cooldownKey[0:16]>` — i.e. the SAME
 * (page × action), not the whole URL — honored (90-day window).
 * Pure; no I/O.
 */
export function isInCooldown(args: IsInCooldownInput): CooldownResult {
  type Candidate = {
    status: PromotionEditStatus | "no_prior";
    anchorAt: Date;
    source: "recommended_edits" | "recommendation_responses";
  };

  const candidates: Candidate[] = [];

  for (const row of args.recommendedEdits) {
    if (row.tenant_id !== args.tenantId) continue;
    if (row.action_type !== args.actionType) continue;
    const rowKey = buildPromotionCooldownKey({
      tenantId: row.tenant_id,
      actionType: row.action_type,
      targetUrl: row.target_url ?? null,
    });
    if (rowKey !== args.cooldownKey) continue;
    const status = promotionEditStatus(row);
    const anchorIso =
      row.live_at ?? row.updated_at ?? row.created_at ?? null;
    if (anchorIso == null) continue;
    const anchorAt = new Date(anchorIso);
    if (Number.isNaN(anchorAt.getTime())) continue;
    candidates.push({ status, anchorAt, source: "recommended_edits" });
  }

  if (args.targetUrl != null) {
    // wave-4 (2026-06-14): scope the dismissed-response cooldown to the SAME
    // (page × action), NOT the whole URL. The recommended_edits branch above
    // already scopes by action_type + cooldownKey; this branch previously
    // matched on targetPageUrl ALONE, so dismissing ONE card on page P (e.g.
    // a cosmetic edit_title) silently put EVERY other action on P — including
    // an urgent bad_http_status::fix_status_code — into a 90-day customer-
    // queue cooldown. A promotion rec's id is `promotion-<sha1(tenant::
    // action::url).slice(0,16)>`, so the dismissed response's recId uniquely
    // encodes (tenant × action × url); matching it confines the suppression
    // to the exact card the operator rejected. (RecommendationResponse has no
    // action_type field, so recId is the available action-scoping signal.)
    const expectedRecId = `promotion-${args.cooldownKey.slice(0, 16)}`;
    for (const resp of args.recommendationResponses) {
      if (resp.status !== "dismissed") continue;
      if (resp.recId !== expectedRecId) continue;
      const anchorAt = new Date(resp.respondedAt);
      if (Number.isNaN(anchorAt.getTime())) continue;
      candidates.push({
        status: "dismissed",
        anchorAt,
        source: "recommendation_responses",
      });
    }
  }

  if (candidates.length === 0) {
    return { in_cooldown: false, reason: null, expires_at: null };
  }

  let binding: Candidate | null = null;
  let bindingExpiresAt: Date | null = null;
  for (const c of candidates) {
    const windowDays =
      c.source === "recommendation_responses"
        ? DISMISSED_RESPONSE_WINDOW_DAYS
        : getCooldownWindowForStatus(c.status);
    if (windowDays <= 0) continue;
    const expiresAt = new Date(c.anchorAt.getTime() + windowDays * DAY_MS);
    if (bindingExpiresAt == null || expiresAt > bindingExpiresAt) {
      binding = c;
      bindingExpiresAt = expiresAt;
    }
  }

  if (binding == null || bindingExpiresAt == null) {
    return { in_cooldown: false, reason: null, expires_at: null };
  }

  if (args.now < bindingExpiresAt) {
    return {
      in_cooldown: true,
      reason: `cooldown_${binding.status}_${binding.source}`,
      expires_at: bindingExpiresAt.toISOString(),
    };
  }

  return { in_cooldown: false, reason: null, expires_at: null };
}
