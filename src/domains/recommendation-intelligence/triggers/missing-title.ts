/**
 * 2026-05-19 — Slice 4.5.B.α₀ trigger predicate: `missing_title`.
 *
 * Fires when `snapshot.title` is null or whitespace-only.
 * Emits an `edit_title` candidate with `confidence: "high"`.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { missingTitleCopy } from "../customer-copy-templates";

export type MissingTitleInput = {
  tenantId: string;
  snapshot: PageSnapshot;
};

export function missingTitle(
  input: MissingTitleInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot } = input;
  const title = snapshot.title;
  if (title != null && title.trim().length > 0) return [];

  const actionType = "edit_title" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Page title";
  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_title",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: "title field is null or empty",
        },
      ],
      confidence: "high",
      impact_estimate: "high",
      customer_copy: missingTitleCopy(),
      operator_evidence:
        "PageSnapshot.title is " +
        (title == null ? "null" : "empty / whitespace-only"),
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
