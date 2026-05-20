/**
 * 2026-05-20 — Slice 4.5.C.α₁ trigger predicate: `bad_http_status`.
 *
 * Fires when verdict is `bad_status_code` (`http_status >= 400` or
 * `in {301, 302, 307, 308}` per `computeIndexability` precedence
 * rule 2). Applies to every HTML page type. Skips `technical_asset`.
 *
 * Emits `fix_status_code` (high confidence, high impact). PURE
 * FUNCTION. Pinned by `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixStatusCodeCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type BadHttpStatusInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 307, 308]);

export function badHttpStatus(
  input: BadHttpStatusInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];

  if (indexability.composite_verdict !== "bad_status_code") return [];

  const pageType = classifyPageType(snapshot.url, businessConfig);

  const actionType = "fix_status_code" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "HTTP status code";
  const pageSnap = indexability.signals.page_snapshot;
  const status = pageSnap?.http_status ?? null;
  const isRedirect = status != null && REDIRECT_STATUSES.has(status);
  const canonicalUrlLabel = pageSnap?.canonical_url ?? "null";
  const evidenceDetail =
    "composite_verdict=bad_status_code; http_status=" +
    String(status) +
    "; canonical_url=" +
    canonicalUrlLabel;
  const operatorEvidence =
    "page_snapshot.http_status=" +
    String(status) +
    "; redirect=" +
    String(isRedirect) +
    "; page_type=" +
    pageType +
    "; fetched_at=" +
    (pageSnap?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "bad_http_status",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail: evidenceDetail,
        },
      ],
      confidence: "high",
      impact_estimate: "high",
      customer_copy: fixStatusCodeCopy(),
      operator_evidence: operatorEvidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
