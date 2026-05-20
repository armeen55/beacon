/**
 * 2026-05-19 — Slice 4.5.B.α₁ + α₂.2 trigger predicate: `weak_h1`.
 *
 * Page-type-gated via the shared `page-classifier`. Fires only on
 * `city` and `service` detail pages when the H1 lacks the
 * corresponding modifier dimension. Skips every other page type
 * (homepage, project, hub, utility, technical_asset, other) AND
 * skips when the relevant business-config dimension is empty.
 *
 * α₂.2 (2026-05-19) replaced the inline `classifyForGate` helper
 * (substring `path.includes()` against `urlPatterns.city` /
 * `.service`) with the shared `classifyPageType` import. The
 * inline helper false-positive'd on hub URLs (e.g., `/locations`
 * itself matched `urlPatterns.city: "/locations/"` via
 * `.includes()` and was wrongly classified as a city page). The
 * shared classifier uses segment-bounded prefix matching and
 * distinguishes hub-vs-detail explicitly.
 *
 * Emits a `change_h1` candidate with `confidence: "medium"`.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { weakH1Copy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type WeakH1Input = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

function containsAnyTerm(h1: string, terms: ReadonlyArray<string>): boolean {
  const lowered = h1.toLowerCase();
  for (const raw of terms) {
    const term = raw.toLowerCase().trim();
    if (term.length === 0) continue;
    if (lowered.includes(term)) return true;
  }
  return false;
}

export function weakH1(
  input: WeakH1Input,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, businessConfig } = input;
  // α₂.2: skip technical assets defensively (classifier returns
  // "technical_asset" which won't be in the allowlist either, but
  // an explicit guard at the top short-circuits cheaply).
  if (isNonHtmlAsset(snapshot.url)) return [];

  const h1 = snapshot.h1;
  if (h1 == null || h1.trim().length === 0) return [];

  // α₂.2: shared page-classifier replaces the inline `classifyForGate`.
  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (pageType !== "city" && pageType !== "service") return [];

  // Per-dimension term resolution. Prefer the explicit *Terms
  // fallback to *services / *locations base lists (mirrors
  // getServiceRegex / getLocationRegex resolution from
  // business-config.ts).
  const locationTerms =
    businessConfig.locationTerms.length > 0
      ? businessConfig.locationTerms
      : businessConfig.locations;
  const serviceTerms =
    businessConfig.serviceTerms.length > 0
      ? businessConfig.serviceTerms
      : businessConfig.services;

  let dimensionMissing: "location" | "service";
  if (pageType === "city") {
    if (locationTerms.length === 0) return [];
    if (containsAnyTerm(h1, locationTerms)) return [];
    dimensionMissing = "location";
  } else {
    // pageType === "service"
    if (serviceTerms.length === 0) return [];
    if (containsAnyTerm(h1, serviceTerms)) return [];
    dimensionMissing = "service";
  }

  const actionType = "change_h1" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "H1 heading";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "weak_h1",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "h1 on " +
            pageType +
            " page lacks any " +
            dimensionMissing +
            " term",
        },
        {
          kind: "business_config",
          ref: businessConfig.domain,
          detail:
            (dimensionMissing === "location" ? "locations" : "services") +
            "=" +
            String(
              dimensionMissing === "location"
                ? locationTerms.length
                : serviceTerms.length,
            ),
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: weakH1Copy(),
      operator_evidence:
        "page_type=" +
        pageType +
        "; h1=" +
        JSON.stringify(h1) +
        "; missing_dimension=" +
        dimensionMissing,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
