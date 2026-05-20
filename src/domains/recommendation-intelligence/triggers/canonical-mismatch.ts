/**
 * 2026-05-20 — Slice 4.5.C.α₁ trigger predicate: `canonical_mismatch`.
 *
 * Fires when verdict is `canonical_elsewhere`. Applies ONLY to
 * homepage / city / service / project — detail-shape pages where
 * the canonical=self assumption is correct. Skips hub (paginated
 * indices legitimately canonical elsewhere), utility (intentional
 * variants), other (unknown intent), technical_asset.
 *
 * Emits `fix_canonical` (high confidence, high impact). PURE
 * FUNCTION. Pinned by `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixCanonicalCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type CanonicalMismatchInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

export function canonicalMismatch(
  input: CanonicalMismatchInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];

  if (indexability.composite_verdict !== "canonical_elsewhere") return [];

  // Page-type allowlist: homepage + city + service + project ONLY.
  // Hubs legitimately have non-self canonicals (pagination);
  // utility pages may have intentional variants. Operator-locked
  // per Slice 4.5.C.α₁ preflight Section D.
  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (
    pageType !== "homepage" &&
    pageType !== "city" &&
    pageType !== "service" &&
    pageType !== "project"
  ) {
    return [];
  }

  const actionType = "fix_canonical" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Canonical URL";
  const pageSnap = indexability.signals.page_snapshot;
  const canonicalUrl = pageSnap?.canonical_url ?? null;
  const evidenceDetail =
    "composite_verdict=canonical_elsewhere; canonical_url=" +
    (canonicalUrl ?? "null") +
    "; has_canonical_mismatch=" +
    String(pageSnap?.has_canonical_mismatch ?? null);
  const operatorEvidence =
    "page_snapshot.canonical_url=" +
    (canonicalUrl ?? "null") +
    "; snapshot.url=" +
    targetUrl +
    "; page_type=" +
    pageType +
    "; fetched_at=" +
    (pageSnap?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "canonical_mismatch",
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
      customer_copy: fixCanonicalCopy(),
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
