/**
 * Broken-competitor opportunity trigger (BEACON_500 P9 v1 250+259, 2026-07-03)
 * - predicate `broken_competitor`.
 *
 * THE GAP: the shipped SERP reflexes react to the tenant's OWN movement
 * (displacement_check: you fell; featured_snippet_capture: someone owns your
 * answer box). None notice when a RIVAL vacates a spot the tenant could take.
 * `broken-competitor.ts` (src/domains/serp) does the deterministic diff off-
 * predicate: over the already-persisted dataforseo_serp_history rows it finds a
 * competitor domain that ranked in Google's top results for a tracked query in
 * an earlier capture and is simply gone in the latest one. This predicate is a
 * thin, PURE wrapper that turns each already-computed BrokenCompetitorFinding
 * into a RecommendationCandidateRow - it does no diff math and no Supabase read
 * itself (the trigger-predicate purity invariant forbids I/O here; the loader
 * does the bounded read via serp-history.ts).
 *
 * ACTION: `create_page` - a vacated top spot on a live-demand search is a
 * make-something-here opportunity, not an edit to an existing page. Same
 * non-pushable, generatorActive:false DIRECTIVE convention as the other
 * opportunity-shaped triggers; the operator decides what to build. Anchored on
 * the site root (the finding is a query/topic-level opening, not tied to one
 * owned page - same site-root anchoring convention citation_loss_alert /
 * sov_drop_alert use for their own topic-level signals).
 *
 * DEDUPE VS displacement_check: displacement fires on a query where the TENANT
 * fell and a rival rose; this fires on a query where a rival DROPPED OFF. The
 * two describe opposite motions, but to be safe a broken-competitor finding for
 * a query whose (tenant, create_page, root) cooldown a displacement card already
 * claimed this run is skipped by the loader's shared cooldown-dedupe pass (same
 * mechanism every late trigger uses), so one query never yields two cards.
 *
 * ONE emission per finding, biggest vacated spot (lowest rank held) first,
 * capped so a busy week does not flood the plan.
 *
 * PURE FUNCTION over pre-loaded findings. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { brokenCompetitorCopy } from "../customer-copy-templates";
import {
  MAX_BROKEN_COMPETITOR_CANDIDATES,
  type BrokenCompetitorFinding,
} from "@/domains/serp/broken-competitor";

export type BrokenCompetitorAlertInput = {
  tenantId: string;
  /** Pre-computed broken-competitor findings from broken-competitor.ts (empty
   *  when nothing dropped, or the history has no diff-able captures yet). */
  findings: ReadonlyArray<BrokenCompetitorFinding>;
  /** Site-root URL to anchor the card on, same convention as
   *  citation_loss_alert / sov_drop_alert. Null when no configured domain -
   *  the predicate then abstains (queue rules require a URL for this action). */
  siteRootUrl: string | null;
  /** ISO timestamp the findings were computed at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many findings feed the candidate builder per run. Defaults to
   *  MAX_BROKEN_COMPETITOR_CANDIDATES. */
  maxCandidates?: number;
};

/**
 * @no-classifier-required: the unit is a (query, dropped-competitor) opening,
 * not a crawled owned page. Emission anchors to the always-HTML site root;
 * neither `classifyPageType` nor `isNonHtmlAsset` applies. (Sanctioned opt-out
 * per the page-classifier architecture invariant, same opt-out
 * citation_loss_alert / sov_drop_alert use for their topic-level anchors.)
 */
export function brokenCompetitorAlert(
  input: BrokenCompetitorAlertInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (findings.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? MAX_BROKEN_COMPETITOR_CANDIDATES;
  // Biggest vacated spot (lowest rank held) first - findings arrive pre-sorted
  // that way, but re-sort defensively so the cap keeps the sharpest openings.
  const ranked = [...findings]
    .sort((a, b) => a.bestRankWhilePresent - b.bestRankWhilePresent || a.query.localeCompare(b.query))
    .slice(0, maxCandidates);

  const actionType = "create_page" as const;
  const targetUrl = siteRootUrl;

  return ranked.map((finding) => {
    // The query is the dedupe anchor - the same still-vacant query collapses
    // onto one row across re-runs; a different query is a fresh opening.
    const topicClusterLabel = `broken_competitor:${finding.query}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "broken_competitor",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: `broken_competitor:${finding.query}`,
          detail:
            "broken_competitor query=" +
            finding.query +
            "; dropped_domain=" +
            finding.domain +
            "; best_rank_while_present=" +
            String(finding.bestRankWhilePresent) +
            "; last_url=" +
            finding.lastUrl +
            "; last_seen_at=" +
            finding.lastSeenAt +
            "; dropped_by_at=" +
            finding.droppedByAt,
        },
      ],
      confidence: "medium",
      // A rival that held #1 or #2 leaving is a bigger opening than one that
      // held #7 - reflect that in the impact estimate.
      impact_estimate: finding.bestRankWhilePresent <= 3 ? "high" : "medium",
      customer_copy: brokenCompetitorCopy(finding.query, finding.domain, finding.bestRankWhilePresent),
      operator_evidence:
        "signal=broken_competitor; " +
        finding.domain +
        " held #" +
        String(finding.bestRankWhilePresent) +
        ' for "' +
        finding.query +
        '" (last seen ' +
        finding.lastSeenAt +
        "), gone by " +
        finding.droppedByAt,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
