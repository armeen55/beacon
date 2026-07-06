/**
 * service-area-page (RANK-5, 2026-07-06) - the local-service create_page Move.
 *
 * THE PLAY: a local business serves a set of cities and offers a set of services,
 * but has no page for a given service in a given city. It cannot rank for
 * "{service} in {city}" without a page for it. This emits a create_page Move for
 * each missing city x service pairing in a market the tenant should compete in.
 *
 * GENERIC + config-driven: the city x service gaps are pre-assembled in the
 * LOADER from the tenant's OWN config (locations x services) and the geo coverage
 * matrix. This predicate never reads config, coverage, or does any I/O (predicate
 * purity invariant) - it only shapes the ready gaps into create_page directives.
 * NO city, NO trade, NO vertical is hardcoded anywhere.
 *
 * EMPTY-SAFE: an empty gap list -> [] (byte-identical to before this trigger
 * existed). A tenant with NO locations/services config produces no gaps in the
 * loader, so a content tenant (an encyclopedia) is a complete no-op here.
 *
 * Anchored on the site root because the target page does not exist yet (queue
 * rules require a URL); the owner builds the city x service page. Every gap
 * carries needsDemandValidation from the factory - no search volume is invented;
 * the create-page demand verdict confirms it before anything publishes. Deduped
 * by cooldown_key (site root + the slug fragment) so the same pairing never
 * emits twice, and deduped against existing create_page Moves by the loader.
 *
 * Never says a lab word. No em or en dashes anywhere. PURE FUNCTION.
 */

import type { ServiceAreaGap } from "@/domains/local-seo/service-area-gaps";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { serviceAreaPageCopy } from "../customer-copy-templates";

export type ServiceAreaPageInput = {
  tenantId: string;
  /** Pre-assembled, config-driven city x service gaps (built in the loader). */
  gaps: ReadonlyArray<ServiceAreaGap>;
  /** Site root the create_page directive anchors on (target does not exist). */
  siteRootUrl: string | null;
  signalAt: string;
  maxEmissions?: number;
};

const DEFAULT_MAX_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes pre-assembled, config-driven city x service
 * gaps (built in the loader from the tenant's own locations x services + the geo
 * coverage matrix). The anchor is the site root, not an existing owned page, so
 * there is no per-page type to classify here.
 */
export function serviceAreaPage(
  input: ServiceAreaPageInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, siteRootUrl, signalAt } = input;
  // Global emptiness guard: no gaps (no config, or every pairing already owned)
  // -> nothing to say. Byte-identical to before this trigger existed.
  if (gaps.length === 0 || !siteRootUrl) return [];
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  const out: RecommendationCandidateRow[] = [];
  const seenSlugs = new Set<string>();
  for (const gap of gaps.slice(0, max)) {
    const slugKey = gap.slug.toLowerCase();
    if (seenSlugs.has(slugKey)) continue;
    seenSlugs.add(slugKey);

    const actionType = "create_page" as const;
    const topicClusterLabel = gap.title;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "service_area_page",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: siteRootUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "business_config",
          ref: "service_area",
          detail:
            "service_area_page service=" +
            gap.service +
            "; city=" +
            gap.city +
            "; competitor_pages=" +
            String(gap.competitorPages) +
            "; coverage_status=" +
            (gap.coverageStatus ?? "unknown") +
            "; relevance=" +
            String(gap.relevance),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: serviceAreaPageCopy(gap.service, gap.city, gap.competitorPages),
      operator_evidence:
        "signal=service_area_page; service=" +
        gap.service +
        "; city=" +
        gap.city +
        "; slug=" +
        gap.slug +
        "; competitor_pages=" +
        String(gap.competitorPages) +
        "; coverage_status=" +
        (gap.coverageStatus ?? "unknown") +
        "; relevance=" +
        String(gap.relevance) +
        "; needs_demand_validation=" +
        String(gap.needsDemandValidation) +
        "; play=own_city_service_page",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl: siteRootUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType,
        targetUrl: siteRootUrl + "#service-area:" + slugKey,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
