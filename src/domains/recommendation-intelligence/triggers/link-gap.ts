/**
 * link-gap trigger (RANK-7, 2026-07-06) - predicate `link_gap`.
 *
 * THE PLAY (the "#1 ranking" half): for a query where a competitor RANKS and
 * their page has far more links from other sites (referring domains) than yours,
 * you likely cannot outrank them by editing the page alone. The honest Move is
 * to build authority first - earn a few strong links to the topic - before
 * pouring more effort into page copy Google's link math already caps. This is
 * the deterministic detection layer that turns the existing backlink reads +
 * winnability arithmetic into a directive, and it also feeds the outreach
 * pipeline the digital-PR targets it was starved of (see mine-leads.ts).
 *
 * ACTION TYPE: `pursue_local_pr` - an off-site authority directive (Section 7
 * C7b). It is `generatorActive: false` and `signalType: "off_page_seo"`, so
 * applyQueueRules routes it to `diagnostic_only` and promotion-eligibility marks
 * it `blocked` - correct: "build authority first" is a MANUAL play the owner
 * performs, never a page edit Beacon pushes. The card carries its own
 * deterministic copy (linkGapCopy), the same directive-card convention as
 * broken_competitor / content_lifecycle - the LLM is never asked to draft it.
 *
 * CONSERVATIVE FIRING (all pre-computed in load-link-gaps.ts, $0):
 *   - the competitor genuinely ranks (rank <= 20),
 *   - you do not already win it (ownRank absent or > 10),
 *   - BOTH referring-domain reads are present (never a call to fire this), AND
 *   - the referring-domain multiple exceeds the reject threshold while Google's
 *     difficulty is not low enough to keep it winnable on merit.
 * ONE emission per query, worst gap first (the loader already sorted + bounded).
 *
 * EMPTY-SAFE: an empty gap list -> [] (byte-identical to before RANK-7). A
 * content tenant with no warmed backlink cache produces no gaps in the loader,
 * so this is a complete no-op there.
 *
 * PURE FUNCTION - the gaps + site-root URL are pre-loaded pure inputs
 * (load-link-gaps.ts does the I/O). Pinned by
 * `recommendation-trigger-predicates-purity`. No lab words. No em or en dashes.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { linkGapCopy } from "../customer-copy-templates";
import type { LinkGap } from "@/domains/link-authority/link-gap";

export type LinkGapInput = {
  tenantId: string;
  /** Pre-loaded, sorted, bounded link gaps (empty when no warmed backlink
   *  cache / no gap run). load-link-gaps.ts does the $0 reads + the join. */
  gaps: ReadonlyArray<LinkGap>;
  /** Site-root URL to anchor the directive on (queue rules require a URL). Null
   *  when the tenant has no configured domain - the predicate then abstains. */
  siteRootUrl: string | null;
  /** ISO timestamp the signal was read at (created_from_signal_at). */
  signalAt: string;
  /** Max cards to emit in one run (worst gaps first). */
  maxEmissions?: number;
};

const DEFAULT_MAX_EMISSIONS = 3;

/**
 * @no-classifier-required: query/topic-level authority gap, not page-scoped. The
 * unit is a demand query a competitor's link authority wins, not a crawled owned
 * page; emission anchors to the always-HTML site root, so neither
 * `classifyPageType` nor `isNonHtmlAsset` applies. (Sanctioned opt-out per the
 * page-classifier architecture invariant.)
 */
export function linkGap(input: LinkGapInput): RecommendationCandidateRow[] {
  const { tenantId, gaps, siteRootUrl, signalAt } = input;
  // Queue rules require a non-null target_url; with no configured domain there
  // is no page to anchor the directive on. Also the global emptiness guard.
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (gaps.length === 0) return [];
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  const out: RecommendationCandidateRow[] = [];
  const seen = new Set<string>();
  for (const gap of gaps.slice(0, max)) {
    const key = gap.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const actionType = "pursue_local_pr" as const;
    const targetUrl = siteRootUrl;
    // The query is the unit + dedupe anchor - a different query later produces a
    // fresh directive without colliding with this one.
    const topicClusterLabel = "link_gap:" + key;

    out.push({
      tenant_id: tenantId,
      trigger_signal: "link_gap",
      action_type: actionType,
      generator_kind: "human_task",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "business_config",
          ref: "link_gap:" + key,
          detail:
            "link_gap query=" +
            gap.keyword +
            "; competitor=" +
            gap.competitorDomain +
            "; competitor_rank=" +
            String(gap.competitorRank) +
            "; own_rank=" +
            String(gap.ownRank ?? "absent") +
            "; their_referring_domains=" +
            String(gap.competitorReferringDomains) +
            "; own_referring_domains=" +
            String(gap.ownReferringDomains) +
            "; multiple=" +
            String(gap.referringDomainMultiple) +
            "x",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: linkGapCopy(
        gap.keyword,
        gap.competitorDomain,
        gap.referringDomainMultiple,
        gap.competitorReferringDomains,
        gap.ownReferringDomains,
      ),
      operator_evidence:
        "signal=link_gap; query=" +
        gap.keyword +
        "; competitor=" +
        gap.competitorDomain +
        " (ranks " +
        String(gap.competitorRank) +
        "); own_rank=" +
        String(gap.ownRank ?? "absent") +
        "; referring_domains=" +
        String(gap.competitorReferringDomains) +
        " vs your " +
        String(gap.ownReferringDomains) +
        " (" +
        String(gap.referringDomainMultiple) +
        "x); volume=" +
        String(gap.volume ?? "unknown") +
        "; play=build_authority_before_more_content_edits",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType,
        targetUrl: targetUrl + "#link-gap:" + key,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
