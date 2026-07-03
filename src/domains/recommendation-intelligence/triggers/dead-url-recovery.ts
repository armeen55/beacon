/**
 * dead-url-recovery (2026-07-03, BEACON_500 P11 v1 320/321) - the trigger adapter
 * that turns the pure dead-URL-with-demand findings (a page GOOGLE STILL SENDS
 * SEARCHES TO that now returns Not Found / Gone, or that Google's index has
 * dropped) into capped, demand-ranked RecommendationCandidateRow[].
 *
 * PURE. The loader crosses the GSC page signal (demand) with the stored snapshot
 * status + URL-inspection coverage verdict (liveness) via classifyDeadUrl, then
 * passes the findings here.
 *
 * ACTION TYPE: fix_status_code (restore a 200 or install a 301). Because it shares
 * the SAME (tenant, action, url) cooldown_key the page-type bad-http-status
 * trigger and the R19 demand-first technical trigger use, the loader's cross-
 * source cooldown dedupe means a page one of those already claimed never
 * double-cards. This engine WINS the framing when it fires (it is registered
 * BEFORE the R19 family in the loader) because it names the recovery play; its
 * unique contribution is the index_dropped case (a 200 page Google's index treats
 * as gone) that no status-based trigger can see.
 *
 * CONFIDENCE: medium (customer-queue eligible). A dead page Google still shows is
 * unambiguous and high-impact - the same posture the R19 bad_status card uses.
 *
 * DEMAND-RANKED + CAPPED like buried-page.ts / technical-demand.ts. Byte-identical
 * when no page qualifies. No em or en dashes.
 */

import type { DeadUrlFinding } from "@/domains/technical-seo/dead-url-recovery";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type DeadUrlRecoveryTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<DeadUrlFinding>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many dead-URL recovery cards, at most, per run - highest-demand first. */
export const MAX_DEAD_URL_RECOVERY_EMISSIONS = 8;

const TOPIC_CLUSTER_LABEL = "Dead URL recovery";

/**
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned snapshots in the loader.
 */
export function deadUrlRecovery(
  input: DeadUrlRecoveryTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, signalAt } = input;
  const max = input.maxEmissions ?? MAX_DEAD_URL_RECOVERY_EMISSIONS;
  if (findings.length === 0) return [];

  // Highest demand first (impressions, then clicks as a tiebreak, then a stable
  // URL tiebreak) so a run is deterministic.
  const ranked = [...findings].sort(
    (a, b) =>
      b.impressions90d - a.impressions90d ||
      b.clicks90d - a.clicks90d ||
      a.url.localeCompare(b.url),
  );

  const out: RecommendationCandidateRow[] = [];
  for (const f of ranked.slice(0, max)) {
    const targetUrl = f.url;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "dead_url_recovery",
      action_type: "fix_status_code",
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: TOPIC_CLUSTER_LABEL,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: f.reason_copy,
      operator_evidence:
        "signal=dead_url_recovery; url=" +
        f.url +
        "; impressions_90d=" +
        String(f.impressions90d) +
        "; clicks_90d=" +
        String(f.clicks90d) +
        "; play=dead_url_recovery; " +
        f.evidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: "fix_status_code",
        targetUrl,
        topicClusterLabel: TOPIC_CLUSTER_LABEL,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType: "fix_status_code",
        targetUrl,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
