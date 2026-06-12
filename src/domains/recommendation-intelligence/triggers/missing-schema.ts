/**
 * 2026-05-20 — Slice 4.5.C.α₃b trigger predicate: `missing_schema`.
 *
 * Per-snapshot predicate. Reuses the existing pure
 * `diffSchemaCoverage()` + `EXPECTED_SCHEMA_BY_ASSET_TYPE` from
 * `src/domains/pages/expected-schema.ts` (already shipped as
 * Phase 1 substrate). Fires when the snapshot's observed
 * `schema_types` lacks one or more REQUIRED schema types per its
 * `AssetType` expectation. Recommended-only gaps are surfaced in
 * `operator_evidence` but DO NOT drive emission.
 *
 * Page-type allowlist: homepage / city / service / project / hub.
 * Skips utility / other / technical_asset.
 *
 * Industry-tuning safety: the existing schema-expectation map is
 * local-service / Ritz-tuned. A SaaS / news / e-commerce tenant
 * would false-positive on `LocalBusiness` etc. To contain risk
 * while operator validates per-tenant, this predicate emits at
 * `confidence: "low"` so `applyQueueRules` routes the candidate
 * to `diagnostic_only` (NOT the customer queue). Future per-
 * industry expectation maps are out of α₃b scope.
 *
 * IMPORTANT: this predicate does NOT use the existing
 * `classifyAssetType()` helper (Ritz-tuned with hardcoded brand
 * slugs — would violate `recommendation-triggers-page-classifier-
 * applied` rule 4). Instead, the universal `classifyPageType()`
 * is consulted and the result is inline-mapped to `AssetType`.
 *
 * One candidate emitted per page (not per missing type), mirroring
 * the existing `schema_missing_for_page_type` findings pipeline
 * shape in `detect-findings.ts`. Per-type missing list lives in
 * `operator_evidence` + customer-facing `detail`.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { AssetType } from "@/lib/constants";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { addSchemaCopy } from "../customer-copy-templates";
import {
  classifyPageType,
  isNonHtmlAsset,
  type PageType,
} from "../page-classifier";
import {
  CONTENT_PAGE_EXPECTED_SCHEMA,
  diffSchemaCoverage,
  diffSchemaCoverageForSpec,
} from "@/domains/pages/expected-schema";

export type MissingSchemaInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

/**
 * Map the universal recommendation-intelligence `PageType` to the
 * existing schema-substrate `AssetType`. Returns `null` for page
 * types that are out of α₃b scope (utility / other / technical_asset).
 *
 * Locked α₃b mapping. Do NOT use `classifyAssetType()` from
 * `@/domains/pages/classify-asset-type` — it hardcodes Ritz-
 * specific brand slugs and defaults to `service_page` for unknown
 * paths, both of which would violate the universal-pattern rule.
 */
function pageTypeToAssetType(pageType: PageType): AssetType | null {
  switch (pageType) {
    case "homepage":
      return "homepage";
    case "city":
      return "city_page";
    case "service":
      return "service_page";
    case "project":
      return "project_page";
    case "hub":
      return "hub_page";
    case "utility":
    case "other":
    case "technical_asset":
      return null;
    // Content pages are handled by the dedicated content branch in
    // `missingSchema()` (Content Schema Engine, 2026-06-12) — they
    // never reach this AssetType mapping. Kept null defensively.
    case "content":
      return null;
  }
}

/**
 * Content Schema Engine (2026-06-12) — content-page branch.
 *
 * Before this, `content` pages were OUT of scope entirely ("revisit
 * when Article/FAQPage expectations land for content sites") — so a
 * content tenant (a Wix encyclopedia in production) got ZERO schema
 * recommendations while `schema_*` findings were its dominant scan
 * signal. The Article expectation is vertical-NEUTRAL: per Google's
 * Article structured-data doc, Article has NO required properties, so
 * recommending it on an article-shaped page is correct for ANY
 * content site in any vertical/language.
 *
 * Emission contract:
 *   • trigger_signal `missing_schema_content` — its OWN eligibility
 *     row (customer-queue-ready), so the builder-tuned
 *     `missing_schema::add_schema` diagnostic-only entry is untouched.
 *   • confidence "medium" — routes to the main candidates queue via
 *     applyQueueRules (rule 4 only demotes "low").
 *   • PRODUCT GUARD: pages already carrying Product schema are store
 *     items, not articles — proposing Article there would be wrong.
 *     They are skipped here; repairing broken Product schema is the
 *     (separate) invalid-schema/fix_schema slice. Comparison is
 *     case-insensitive on the observed @type strings (derived data
 *     hygiene, not vocabulary).
 */
function missingSchemaContent(args: {
  tenantId: string;
  snapshot: PageSnapshot;
  pageType: PageType;
}): RecommendationCandidateRow[] {
  const { tenantId, snapshot, pageType } = args;

  // Store/product pages: Article would be a mislabel — skip.
  const hasProductSchema = snapshot.schema_types.some(
    (t) => t.trim().toLowerCase() === "product",
  );
  if (hasProductSchema) return [];

  const coverage = diffSchemaCoverageForSpec(
    CONTENT_PAGE_EXPECTED_SCHEMA,
    snapshot.schema_types,
  );
  if (coverage.satisfies_all_required) return [];

  const actionType = "add_schema" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Structured data";
  const presentLabel =
    coverage.present.length > 0 ? coverage.present.join(", ") : "(none)";
  const missingReqLabel = coverage.missing_required.join(", ");
  const missingRecLabel =
    coverage.missing_recommended.length > 0
      ? coverage.missing_recommended.join(", ")
      : "(none)";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_schema_content",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "page_type=content; missing_required=" +
            missingReqLabel +
            "; present=" +
            presentLabel,
        },
      ],
      // Medium (not low): the Article expectation is universal for
      // content pages (no industry-tuned types involved), the draft
      // is composed only from the page's own extracted facts, and the
      // composer's output is pinned against the scanner's own
      // validateSchema() in tests.
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: addSchemaCopy(),
      operator_evidence:
        "page_type=" +
        pageType +
        "; schema_types=[" +
        (snapshot.schema_types.length > 0
          ? snapshot.schema_types.join(", ")
          : "") +
        "]; missing_required=[" +
        missingReqLabel +
        "]; missing_recommended=[" +
        missingRecLabel +
        "]; extraction_certainty=" +
        (snapshot.extraction_certainty ?? "null") +
        "; fetched_at=" +
        snapshot.fetched_at,
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

export function missingSchema(
  input: MissingSchemaInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];

  const pageType = classifyPageType(snapshot.url, businessConfig);

  // Safety guard: skip when extraction confidence is uncertain —
  // a missed JSON-LD block could produce a false positive.
  if (snapshot.extraction_certainty === "uncertain") return [];

  // Content Schema Engine (2026-06-12): content pages get their own
  // vertical-neutral expectation + trigger signal.
  if (pageType === "content") {
    return missingSchemaContent({ tenantId, snapshot, pageType });
  }

  const assetType = pageTypeToAssetType(pageType);
  if (assetType == null) return [];

  const coverage = diffSchemaCoverage(assetType, snapshot.schema_types);
  if (coverage.satisfies_all_required) return [];

  const actionType = "add_schema" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Structured data";
  const presentLabel =
    coverage.present.length > 0 ? coverage.present.join(", ") : "(none)";
  const missingReqLabel = coverage.missing_required.join(", ");
  const missingRecLabel =
    coverage.missing_recommended.length > 0
      ? coverage.missing_recommended.join(", ")
      : "(none)";
  const evidenceDetail =
    "asset_type=" +
    assetType +
    "; missing_required=" +
    missingReqLabel +
    "; present=" +
    presentLabel;
  const operatorEvidence =
    "page_type=" +
    pageType +
    "; asset_type=" +
    assetType +
    "; schema_types=[" +
    (snapshot.schema_types.length > 0 ? snapshot.schema_types.join(", ") : "") +
    "]; missing_required=[" +
    missingReqLabel +
    "]; missing_recommended=[" +
    missingRecLabel +
    "]; extraction_certainty=" +
    (snapshot.extraction_certainty ?? "null") +
    "; fetched_at=" +
    snapshot.fetched_at;

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_schema",
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
      // Slice 4.5.C.α₃b — Tier-2 sensitive (industry-tuning
      // safety). Confidence: "low" routes to diagnostic_only via
      // applyQueueRules. NEVER promotes to main candidates
      // without operator-validated per-tenant calibration.
      confidence: "low",
      impact_estimate: "medium",
      customer_copy: addSchemaCopy(),
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
