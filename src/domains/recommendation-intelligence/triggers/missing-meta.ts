/**
 * 2026-05-19 — Slice 4.5.B.α₀ trigger predicate: `missing_meta`.
 *
 * Fires when `snapshot.meta_description` is null or whitespace-only.
 * Emits an `edit_meta` candidate with `confidence: "high"`.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { missingMetaCopy } from "../customer-copy-templates";

export type MissingMetaInput = {
  tenantId: string;
  snapshot: PageSnapshot;
};

export function missingMeta(
  input: MissingMetaInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot } = input;
  const meta = snapshot.meta_description;
  if (meta != null && meta.trim().length > 0) return [];

  const actionType = "edit_meta" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Meta description";
  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_meta",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: "meta_description field is null or empty",
        },
      ],
      confidence: "high",
      impact_estimate: "medium",
      customer_copy: missingMetaCopy(),
      operator_evidence:
        "PageSnapshot.meta_description is " +
        (meta == null ? "null" : "empty / whitespace-only"),
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
