/**
 * fix_schema slice (2026-06-12) — trigger predicate: `invalid_schema`.
 *
 * Per-snapshot predicate. The scanner already validates every JSON-LD
 * block on every crawled page (`schema-validator.ts`) and persists the
 * results on `PageSnapshot.schema_validation_warnings` — but nothing
 * consumed them: pages with PRESENT-but-BROKEN schema produced
 * `schema_invalid` scan findings and zero recommendation candidates.
 * On the live content tenant (a Wix encyclopedia) this was the
 * dominant untouched signal: 132 snapshots carry validation warnings
 * (mostly store pages whose Product block is missing its offers).
 *
 * Fires when the snapshot carries actionable validation output —
 * lines prefixed `schema_critical:` (the type is malformed enough to
 * be rejected) or `schema_warning:` (required/expected property
 * missing — rich results won't fire). `schema_info:` lines are
 * informational and never drive emission.
 *
 * Confidence "medium" (routes to the main candidates queue): the
 * evidence is the scanner's OWN validator output for THIS page — the
 * exact failing type + property, no industry-tuned expectation
 * involved, any vertical/language. Impact derives from severity:
 * any critical → "high", warnings only → "medium".
 *
 * One candidate per page (all warnings listed in evidence), mirroring
 * the missing-schema shape. PURE FUNCTION — pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { fixSchemaCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type InvalidSchemaInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

const CRITICAL_PREFIX = "schema_critical:";
const WARNING_PREFIX = "schema_warning:";

/** Validator lines that justify a repair card. `schema_info:` lines
 *  are advisory and never drive emission. */
export function actionableSchemaWarnings(
  warnings: ReadonlyArray<string> | null | undefined,
): string[] {
  return (warnings ?? []).filter(
    (w) => w.startsWith(CRITICAL_PREFIX) || w.startsWith(WARNING_PREFIX),
  );
}

export function invalidSchema(
  input: InvalidSchemaInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, businessConfig } = input;

  if (isNonHtmlAsset(snapshot.url)) return [];

  // Safety guard: skip when extraction confidence is uncertain — a
  // mis-parsed JSON-LD block could produce false validation output.
  if (snapshot.extraction_certainty === "uncertain") return [];

  const actionable = actionableSchemaWarnings(
    snapshot.schema_validation_warnings,
  );
  if (actionable.length === 0) return [];

  const pageType = classifyPageType(snapshot.url, businessConfig);
  const hasCritical = actionable.some((w) => w.startsWith(CRITICAL_PREFIX));

  const actionType = "fix_schema" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Structured data";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "invalid_schema",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "validator_issues=" +
            actionable.length +
            (hasCritical ? " (has critical)" : "") +
            "; first=" +
            (actionable[0] ?? ""),
        },
      ],
      confidence: "medium",
      impact_estimate: hasCritical ? "high" : "medium",
      customer_copy: fixSchemaCopy(),
      operator_evidence:
        "page_type=" +
        pageType +
        "; schema_types=[" +
        (snapshot.schema_types.length > 0
          ? snapshot.schema_types.join(", ")
          : "") +
        "]; validation_warnings=[" +
        actionable.join(" | ") +
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
