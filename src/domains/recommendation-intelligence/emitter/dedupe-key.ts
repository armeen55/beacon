/**
 * 2026-05-19 — Slice 4.5.B.α — deterministic dedupe-key hash.
 *
 * Pure function. SHA1 over a single canonical input string built
 * from `(tenant_id, action_type, target_url, topic_cluster_label)`.
 *
 * Two trigger predicates producing the same (tenant + action +
 * URL + topic-cluster) will produce the same dedupe_key. The
 * loader uses this to collapse duplicate candidates from
 * different predicates onto a single operator-diagnostic row.
 *
 * Hash determinism is the contract — same inputs ALWAYS yield
 * the same hex digest. The hash is opaque to the customer
 * (architecture invariant `recommendation-intelligence-customer-
 * copy-vocab` blocks the hex string from leaking into
 * `customer_copy`).
 */

import { createHash } from "node:crypto";

import type { ActionType } from "@/domains/recommendations/action-types";

export type DedupeKeyInput = {
  tenantId: string;
  actionType: ActionType;
  targetUrl: string | null;
  topicClusterLabel: string;
};

export function dedupeKey(input: DedupeKeyInput): string {
  const url = input.targetUrl ?? "no_url";
  const canonical = [
    input.tenantId,
    input.actionType,
    url,
    input.topicClusterLabel,
  ].join("::");
  return createHash("sha1").update(canonical).digest("hex");
}
