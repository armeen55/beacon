/**
 * 2026-05-19 — Slice 4.5.B.α₁ trigger predicate: `weak_h1`.
 *
 * Page-type-gated. Fires only on city pages (when H1 lacks a
 * location term) AND on service pages (when H1 lacks a service
 * term). Skips homepage / project / other page types entirely.
 * Also skips when the corresponding business-config dimension is
 * empty — no useful signal without a term dictionary.
 *
 * Emits a `change_h1` candidate with `confidence: "medium"`.
 *
 * PURE FUNCTION. Inlines a minimal `inferPageType` mirror of
 * `src/domains/product/section-analyzer.ts:68` so the predicate
 * doesn't pull in section-analyzer's transitive deps. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { weakH1Copy } from "../customer-copy-templates";

export type WeakH1Input = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

type GatedPageType = "city" | "service" | "skip";

/** Inline-copy of `inferPageType` semantics narrowed to the 2
 *  page types that pass the gate. Everything else returns "skip". */
function classifyForGate(
  url: string,
  config: BusinessConfig,
): GatedPageType {
  const path = url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();
  if (path === "/" || path === "") return "skip";
  const patterns = config.urlPatterns;
  if (patterns?.city && path.includes(patterns.city.toLowerCase())) return "city";
  if (patterns?.service && path.includes(patterns.service.toLowerCase())) return "service";
  // Conservative fallback — only fire when the URL contains a
  // recognizably city- or service-shaped path segment. Matches
  // section-analyzer's fallback list.
  if (path.includes("/location")) return "city";
  if (path.includes("/service")) return "service";
  return "skip";
}

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
  const h1 = snapshot.h1;
  if (h1 == null || h1.trim().length === 0) return [];

  const pageType = classifyForGate(snapshot.url, businessConfig);
  if (pageType === "skip") return [];

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
    // service
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
