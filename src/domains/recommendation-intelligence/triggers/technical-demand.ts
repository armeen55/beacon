/**
 * technical-demand (2026-07-03, BEACON_500 R19 / N21) - the trigger adapter that
 * turns the pure demand-first technical findings (noindex / broken status /
 * canonical elsewhere on a page GOOGLE ACTUALLY SENDS SEARCHES TO) into capped,
 * demand-ranked RecommendationCandidateRow[].
 *
 * PURE. The loader reads the SAME stored snapshot fields the existing
 * bad-http-status / canonical-mismatch / noindex-on-indexable-page triggers use
 * (http_status, robots_meta, has_canonical_mismatch), joins the GSC demand
 * already loaded, runs classifyTechnicalDemand per page, and passes the findings
 * here.
 *
 * ACTION TYPES reuse the registered indexability-fix types 1:1 with the finding
 * kind (fix_status_code / fix_noindex / fix_canonical). Because those share the
 * SAME (tenant, action, url) cooldown_key the page-type-driven triggers use, the
 * loader's cooldown dedupe means a page the existing trigger already claimed
 * never double-cards; this engine's UNIQUE contribution is the pages the
 * page-type allowlist skips (content-library "other" pages) that nonetheless
 * earn real Google demand, now flagged with demand-first copy.
 *
 * ROUTING: broken status emits at `confidence: "medium"` (a dead page GSC still
 * shows is unambiguous and high-impact). noindex + canonical emit at
 * `confidence: "low"` -> diagnostic_only, because they are INDEXING DIRECTIVES
 * (a wrong edit can deindex a live site) and stay operator-validated first, same
 * posture as the sensitive noindex-on-indexable-page trigger.
 *
 * DEMAND-RANKED + CAPPED like buried-page.ts. Byte-identical when no page
 * qualifies. No em or en dashes.
 */

import type {
  TechnicalDemandFinding,
  TechnicalDemandKind,
} from "@/domains/lifecycle/technical-demand";
import type { ActionType } from "@/domains/recommendations/action-types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow, CandidateConfidence } from "../emitter/candidate-row";

export type TechnicalDemandTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<TechnicalDemandFinding>;
  /** Per-page 90-day impressions (canonical URL key) - drives the demand-first
   *  ordering only; the classifier already applied its own demand gate. */
  impressionsByUrl: ReadonlyMap<string, number>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many demand-first technical cards, at most, per run - highest-demand
 *  first. */
export const MAX_TECHNICAL_DEMAND_EMISSIONS = 8;

type KindSpec = {
  actionType: ActionType;
  triggerSignal: string;
  topicClusterLabel: string;
  confidence: CandidateConfidence;
  impact: RecommendationCandidateRow["impact_estimate"];
};

const KIND_SPEC: Record<TechnicalDemandKind, KindSpec> = {
  bad_status: {
    actionType: "fix_status_code",
    triggerSignal: "technical_demand_bad_status",
    topicClusterLabel: "HTTP status code",
    // A dead page GSC still shows is unambiguous; customer-queue eligible.
    confidence: "medium",
    impact: "high",
  },
  noindex: {
    actionType: "fix_noindex",
    triggerSignal: "technical_demand_noindex",
    topicClusterLabel: "Indexability - noindex meta",
    // Indexing directive: diagnostic_only until operator-validated.
    confidence: "low",
    impact: "high",
  },
  canonical_elsewhere: {
    actionType: "fix_canonical",
    triggerSignal: "technical_demand_canonical",
    topicClusterLabel: "Canonical URL",
    // Indexing directive: diagnostic_only until operator-validated.
    confidence: "low",
    impact: "high",
  },
};

/**
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned, non-asset snapshots in the loader.
 */
export function technicalDemand(
  input: TechnicalDemandTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, impressionsByUrl, signalAt } = input;
  const max = input.maxEmissions ?? MAX_TECHNICAL_DEMAND_EMISSIONS;
  if (findings.length === 0) return [];

  // Highest demand first, then a stable (url, kind) tiebreak so a page with two
  // findings is deterministically ordered.
  const ranked = [...findings].sort((a, b) => {
    const ia = impressionsByUrl.get(a.url) ?? 0;
    const ib = impressionsByUrl.get(b.url) ?? 0;
    return ib - ia || a.url.localeCompare(b.url) || a.kind.localeCompare(b.kind);
  });

  const out: RecommendationCandidateRow[] = [];
  for (const f of ranked.slice(0, max)) {
    const spec = KIND_SPEC[f.kind];
    const targetUrl = f.url;
    out.push({
      tenant_id: tenantId,
      trigger_signal: spec.triggerSignal,
      action_type: spec.actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: spec.topicClusterLabel,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: spec.confidence,
      impact_estimate: spec.impact,
      customer_copy: f.reason,
      operator_evidence:
        "signal=" +
        spec.triggerSignal +
        "; url=" +
        f.url +
        "; impressions_90d=" +
        String(impressionsByUrl.get(f.url) ?? 0) +
        "; play=technical_demand; " +
        f.evidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: spec.actionType,
        targetUrl,
        topicClusterLabel: spec.topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType: spec.actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
