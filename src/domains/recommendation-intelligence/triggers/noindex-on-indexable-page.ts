/**
 * 2026-05-20 — Slice 4.5.C.α₂ Tier-2 sensitive trigger predicate:
 * `noindex_on_indexable_page`.
 *
 * Fires when verdict is `noindex_meta` AND page type is in the
 * "should be indexable" allowlist (homepage / city / service /
 * project) AND the page is not a paginated/duplicate variant
 * (no canonical mismatch) AND the page snapshot was extracted
 * with confidence (`extraction_certainty !== "uncertain"`).
 * Skips hub, utility, other, technical_asset.
 *
 * Emits `fix_noindex` at `confidence: "low"` so `applyQueueRules`
 * routes the candidate to `diagnostic_only` (NOT the customer
 * queue). Operator validates on the diagnostic page; promotion to
 * higher confidence (or customer-queue surfacing) is deferred
 * until false-positive rate is calibrated against production data.
 *
 * Sensitivity rationale: noindex on staging / draft / preview /
 * thank-you / search-result / paginated pages is INTENTIONAL.
 * The three safety guards (page-type allowlist, extraction
 * certainty, co-occurring canonical mismatch) eliminate the
 * highest-frequency false-positive patterns; the `low` confidence
 * is the final safety net for everything else.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixNoindexCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type NoindexOnIndexablePageInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

export function noindexOnIndexablePage(
  input: NoindexOnIndexablePageInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];
  if (indexability.composite_verdict !== "noindex_meta") return [];

  // Guard 1 — page-type allowlist.
  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (
    pageType !== "homepage" &&
    pageType !== "city" &&
    pageType !== "service" &&
    pageType !== "project"
  ) {
    return [];
  }

  const pageSnap = indexability.signals.page_snapshot;

  // Guard 2 — extraction certainty. When the raw fetch may have
  // missed or hallucinated the noindex tag, the verdict isn't
  // trustworthy enough to surface even as low-confidence.
  if (pageSnap?.extraction_certainty === "uncertain") return [];

  // Guard 3 — co-occurring canonical mismatch. Noindex + canonical
  // elsewhere is the signature of a paginated/duplicate page
  // deliberately deindexed in favor of a canonical primary. The
  // verdict precedence in `computeIndexability` means `noindex_meta`
  // wins over `canonical_elsewhere`, so we read the raw signal here
  // rather than the verdict.
  if (pageSnap?.has_canonical_mismatch === true) return [];

  const actionType = "fix_noindex" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Indexability — noindex meta";
  const robotsMetaLabel = pageSnap?.robots_meta ?? "null";
  const extractionCertaintyLabel = pageSnap?.extraction_certainty ?? "null";
  const evidenceDetail =
    "composite_verdict=noindex_meta; noindex_detected=true; robots_meta=" +
    robotsMetaLabel +
    "; extraction_certainty=" +
    extractionCertaintyLabel +
    "; has_canonical_mismatch=" +
    String(pageSnap?.has_canonical_mismatch ?? null) +
    "; page_type=" +
    pageType;
  const operatorEvidence =
    "page_snapshot.robots_meta=" +
    robotsMetaLabel +
    "; noindex_detected=true; extraction_certainty=" +
    extractionCertaintyLabel +
    "; has_canonical_mismatch=" +
    String(pageSnap?.has_canonical_mismatch ?? null) +
    "; page_type=" +
    pageType +
    "; fetched_at=" +
    (pageSnap?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "noindex_on_indexable_page",
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
      // Slice 4.5.C.α₂ — Tier-2 SAFETY: low confidence routes to
      // `diagnostic_only` via `applyQueueRules`. NEVER promote to
      // candidates without operator-validated calibration.
      confidence: "low",
      impact_estimate: "high",
      customer_copy: fixNoindexCopy(),
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
