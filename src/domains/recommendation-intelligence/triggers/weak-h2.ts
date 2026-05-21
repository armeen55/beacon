/**
 * Slice 4.5.E.α₁a (2026-05-21) — trigger predicate: `weak_h2`.
 *
 * Mirrors the α₁ + α₂.2 `weak-h1` pattern with two intentional
 * deltas:
 *   • Emits `action_type: "rewrite_h2"` (which carries
 *     `requiresProposedText: true` → drafted text comes from the
 *     LLM gateway in a future α₁b+ slice).
 *   • Emits `generator_kind: "llm_assisted"` (NOT `"deterministic"`
 *     like weak-h1). The deterministic LAYER detects the weak H2;
 *     the LLM LAYER drafts the replacement copy in α₁b.
 *
 * Page-type-gated via the shared `page-classifier`. Fires only on
 * `city` and `service` detail pages when at least one H2 in the
 * `h2_list` lacks the corresponding modifier dimension (city →
 * location term; service → service term). Skips every other page
 * type (homepage, project, hub, utility, technical_asset, other)
 * AND skips when the relevant business-config dimension is empty.
 *
 * Per-page candidate emission (NOT per-H2): a page with multiple
 * weak H2s emits exactly ONE candidate, carrying ALL the weak H2s
 * in `operator_evidence` (text + index + missing dimension) so a
 * later α₁b packet builder can choose which one to rewrite.
 *
 * Emits at `confidence: "low"` → routes to `diagnostic_only` via
 * `applyQueueRules` → caught by the α₀a.3a safety-gate Gate 2
 * (`diagnostic_only_tier`) → NEVER reaches the customer queue.
 * The promotion-eligibility-pin invariant locks this routing.
 *
 * Operator-locked α₁a contract: NO env flag, NO LLM call from
 * this predicate, NO server action — the predicate is the pure
 * detection layer; the gateway invocation lives in α₁b.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied` +
 * `recommendation-intelligence-no-llm-decides` (auto-discovers
 * the `action_type: "rewrite_h2"` literal below).
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { rewriteH2Copy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type WeakH2Input = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

type WeakH2Hit = {
  index: number;
  text: string;
};

function containsAnyTerm(h2: string, terms: ReadonlyArray<string>): boolean {
  const lowered = h2.toLowerCase();
  for (const raw of terms) {
    const term = raw.toLowerCase().trim();
    if (term.length === 0) continue;
    if (lowered.includes(term)) return true;
  }
  return false;
}

export function weakH2(
  input: WeakH2Input,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, businessConfig } = input;

  // Defensive skip for non-HTML assets — same convention as weak-h1.
  if (isNonHtmlAsset(snapshot.url)) return [];

  // Skip uncertain extractions to keep false-positive rate low.
  if (snapshot.extraction_certainty === "uncertain") return [];

  // Skip pages with no H2 to rewrite.
  if (snapshot.h2_list == null || snapshot.h2_list.length === 0) {
    return [];
  }

  // Page-type gate — city / service detail pages only (mirrors weak-h1).
  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (pageType !== "city" && pageType !== "service") return [];

  // Per-dimension term resolution — same `*Terms` fallback to base
  // lists used by weak-h1.
  const locationTerms =
    businessConfig.locationTerms.length > 0
      ? businessConfig.locationTerms
      : businessConfig.locations;
  const serviceTerms =
    businessConfig.serviceTerms.length > 0
      ? businessConfig.serviceTerms
      : businessConfig.services;

  let dimensionMissing: "location" | "service";
  let dimensionTerms: ReadonlyArray<string>;
  if (pageType === "city") {
    if (locationTerms.length === 0) return [];
    dimensionMissing = "location";
    dimensionTerms = locationTerms;
  } else {
    // pageType === "service"
    if (serviceTerms.length === 0) return [];
    dimensionMissing = "service";
    dimensionTerms = serviceTerms;
  }

  // Collect every weak H2 on the page (no modifier overlap with the
  // relevant dimension). Empty/blank H2 entries are skipped.
  const weakHits: WeakH2Hit[] = [];
  for (let i = 0; i < snapshot.h2_list.length; i++) {
    const text = snapshot.h2_list[i] ?? "";
    if (text.trim().length === 0) continue;
    if (containsAnyTerm(text, dimensionTerms)) continue;
    weakHits.push({ index: i, text });
  }
  if (weakHits.length === 0) return [];

  const actionType = "rewrite_h2" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "H2 heading";

  // Encode every weak H2 into operator_evidence so a future α₁b
  // packet builder can pick which one to draft a replacement for.
  // Format: `h2[<index>]=<text>` separated by ` | ` for stability.
  const evidenceTrail = weakHits
    .map((hit) => `h2[${hit.index}]=${JSON.stringify(hit.text)}`)
    .join(" | ");

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "weak_h2",
      action_type: actionType,
      generator_kind: "llm_assisted",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "h2 on " +
            pageType +
            " page lacks any " +
            dimensionMissing +
            " term (" +
            String(weakHits.length) +
            " weak h2" +
            (weakHits.length === 1 ? "" : "s") +
            ")",
        },
        {
          kind: "business_config",
          ref: businessConfig.domain,
          detail:
            (dimensionMissing === "location" ? "locations" : "services") +
            "=" +
            String(dimensionTerms.length),
        },
      ],
      confidence: "low",
      impact_estimate: "medium",
      customer_copy: rewriteH2Copy(),
      operator_evidence:
        "page_type=" +
        pageType +
        "; missing_dimension=" +
        dimensionMissing +
        "; weak_h2_count=" +
        String(weakHits.length) +
        "; " +
        evidenceTrail,
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
