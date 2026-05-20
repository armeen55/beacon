/**
 * 2026-05-19 — Slice 4.5.B.α₁ + α₂.2 trigger predicate:
 * `missing_h1`.
 *
 * Fires when `snapshot.h1` is null or whitespace-only AND the URL
 * is an HTML page (not a `.txt` / `.xml` / `.json` / `.pdf` /
 * image / etc. technical asset). Emits a `change_h1` candidate
 * with `confidence: "high"`.
 *
 * α₂.2 (2026-05-19) added the `isNonHtmlAsset` gate.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { missingH1Copy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";

export type MissingH1Input = {
  tenantId: string;
  snapshot: PageSnapshot;
};

export function missingH1(
  input: MissingH1Input,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot } = input;
  // α₂.2: skip technical assets.
  if (isNonHtmlAsset(snapshot.url)) return [];
  const h1 = snapshot.h1;
  if (h1 != null && h1.trim().length > 0) return [];

  const actionType = "change_h1" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "H1 heading";
  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_h1",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: "h1 field is null or empty",
        },
      ],
      confidence: "high",
      impact_estimate: "high",
      customer_copy: missingH1Copy(),
      operator_evidence:
        "PageSnapshot.h1 is " +
        (h1 == null ? "null" : "empty / whitespace-only"),
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
