/**
 * 2026-05-19 — Slice 4.5.B.α — deterministic cooldown-key hash.
 *
 * Pure function. SHA1 over a canonical input string built from
 * `(tenant_id, action_type, target_url)`. Coarser than dedupe_key
 * — same cooldown_key survives across `topic_cluster_label`
 * variants.
 *
 * Cooldown ENFORCEMENT (looking up recent emissions of the same
 * cooldown_key and suppressing) lands in Slice 4.5.D per the
 * §4.5.15 cooldown table. Slice 4.5.B.α only ships the KEY so
 * that diagnostic rows carry the future-suppression handle, and
 * the dedupe path can collapse same-cooldown candidates onto
 * a single operator diagnostic row when needed.
 */

import { createHash } from "node:crypto";

import type { ActionType } from "@/domains/recommendations/action-types";

export type CooldownKeyInput = {
  tenantId: string;
  actionType: ActionType;
  targetUrl: string | null;
};

export function cooldownKey(input: CooldownKeyInput): string {
  const url = input.targetUrl ?? "no_url";
  const canonical = [input.tenantId, input.actionType, url].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}
