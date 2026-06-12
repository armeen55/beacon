/**
 * Source-ledger slice (2026-06-12 night shift) — trigger predicate:
 * `uncited_content`. A substantive CONTENT page that cites zero
 * external sources is leaving AI citations on the table:
 *
 *   • The GEO study (Aggarwal et al., KDD 2024) measured that adding
 *     citations to credible sources is among the strongest levers for
 *     generative-engine visibility (~30-40% relative lift vs
 *     keyword-stuffing baselines).
 *   • Google's E-E-A-T / helpful-content guidance treats verifiable
 *     sourcing as a trust signal for informational content.
 *
 * Definition (deliberately narrow):
 *   • pageType === "content" ONLY — the encyclopedia/article page
 *     type that exists exclusively when the tenant's
 *     `contentSiteMode === true` (config-driven; a roofing service
 *     page is never told to add an academic bibliography);
 *   • word_count ≥ 600 (substantive, long-form);
 *   • external_link_count === 0 (zero outbound references — the
 *     crawler counts them per snapshot);
 *   • healthy HTML (status < 400, not a technical asset).
 *
 * Emits `add_proof_section` at confidence medium with a DIRECTIVE
 * draft downstream (draft-enrichment names what to add — sources for
 * the page's checkable claims — but never fabricates the sources
 * themselves; that's the owner's editorial judgment).
 *
 * PURE FUNCTION — pinned by `recommendation-trigger-predicates-purity`
 * + `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { uncitedContentCopy } from "../customer-copy-templates";
import { classifyPageType, isNonHtmlAsset } from "../page-classifier";

export type UncitedContentInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  businessConfig: BusinessConfig;
};

export const UNCITED_MIN_WORD_COUNT = 600;

export function uncitedContent(
  input: UncitedContentInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, businessConfig } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (snapshot.http_status >= 400) return [];
  if (classifyPageType(snapshot.url, businessConfig) !== "content") return [];
  if ((snapshot.word_count ?? 0) < UNCITED_MIN_WORD_COUNT) return [];
  if ((snapshot.external_link_count ?? 0) !== 0) return [];

  const actionType = "add_proof_section" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = "Sources & references";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "uncited_content",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "uncited_content word_count=" +
            (snapshot.word_count ?? 0) +
            "; external_link_count=0; page_type=content",
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: uncitedContentCopy(),
      operator_evidence:
        "signal=uncited_content; word_count=" +
        (snapshot.word_count ?? 0) +
        "; external_links=0; play=add_sources_section (GEO: cited sources are a top generative-visibility lever; sourcing is an E-E-A-T trust signal)",
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
