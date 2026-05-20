/**
 * 2026-05-20 — Slice 4.5.C.α₁ trigger predicate: `sitemap_missing`.
 *
 * Fires when verdict is `not_in_sitemap` AND page type is homepage
 * / city / service / project / hub. Skips utility / other (may be
 * intentionally excluded) and technical_asset (non-HTML).
 *
 * Emits `fix_sitemap` (high confidence, medium impact). PURE
 * FUNCTION; receives `OwnedUrlIndexability` as passed-in input.
 * Pinned by `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixSitemapCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type SitemapMissingInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  indexability: OwnedUrlIndexability;
  businessConfig: BusinessConfig;
};

export function sitemapMissing(
  input: SitemapMissingInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, indexability, businessConfig } = input;

  // α₂.2: skip technical assets (e.g. `.xml`, `.json`, `.pdf`).
  if (isNonHtmlAsset(snapshot.url)) return [];

  // Verdict match: 1:1 with `not_in_sitemap`. The decision
  // precedence in `computeIndexability` guarantees this verdict
  // only fires when every higher-severity check (bad_status,
  // noindex, canonical, robots) has passed — so emitting here
  // never overlaps with the other Tier-1 predicates.
  if (indexability.composite_verdict !== "not_in_sitemap") return [];

  // α₂.2 page-type allowlist: homepage, city, service, project,
  // hub. Skip utility / other / technical_asset (technical_asset
  // already filtered above).
  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (
    pageType !== "homepage" &&
    pageType !== "city" &&
    pageType !== "service" &&
    pageType !== "project" &&
    pageType !== "hub"
  ) {
    return [];
  }

  const actionType = "fix_sitemap" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Sitemap inclusion";
  const sitemap = indexability.signals.sitemap_membership;
  const sitemapUrlLabel = sitemap.sitemap_url ?? "null";
  const evidenceDetail =
    "composite_verdict=not_in_sitemap; in_sitemap=" +
    String(sitemap.in_sitemap) +
    "; sitemap_url=" +
    sitemapUrlLabel;
  const operatorEvidence =
    "OwnedUrlIndexability.signals.sitemap_membership.in_sitemap === false; page_type=" +
    pageType +
    "; canonical_verdict=" +
    indexability.composite_verdict +
    "; fetched_at=" +
    (indexability.signals.page_snapshot?.fetched_at ?? "null");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "sitemap_missing",
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
      impact_estimate: "medium",
      customer_copy: fixSitemapCopy(),
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
