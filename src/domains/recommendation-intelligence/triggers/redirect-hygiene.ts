/**
 * redirect-hygiene (2026-07-03, BEACON_500 P11 v1 320/517) - the trigger adapter
 * that turns redirect-chain + soft-404 findings into capped, demand-ranked
 * RecommendationCandidateRow[].
 *
 * PURE. The loader resolves each page's redirect chain (via the optional polite +
 * capped + fail-soft liveness pass) and reads Google's URL-inspection coverage
 * verdict, runs classifyRedirectHygiene per page, and passes the findings here.
 *
 * ACTION TYPES:
 *   • redirect_chain -> fix_status_code (repoint the address at the final page).
 *     Confidence medium: a multi-hop chain is unambiguous and safe to collapse.
 *   • soft_404       -> fix_status_code. Confidence medium: Google's own post-
 *     render coverage verdict ("Soft 404") is authoritative, so this is not the
 *     raw-HTML guesswork the JS-shell trap warns against.
 *
 * Both share fix_status_code's (tenant, action, url) cooldown_key, so the loader's
 * cross-source dedupe keeps a page the dead-URL / R19 technical trigger already
 * claimed from double-carding. This engine's unique contribution is the chain +
 * soft-404 cases those status-only triggers cannot see.
 *
 * DEMAND-RANKED + CAPPED. Byte-identical when every page is clean. No em or en
 * dashes.
 */

import type {
  RedirectHygieneFinding,
  RedirectHygieneKind,
} from "@/domains/technical-seo/redirect-hygiene";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type RedirectHygieneTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<RedirectHygieneFinding>;
  /** Per-page 90-day impressions (canonical URL key) - drives the demand-first
   *  ordering only; the classifier already applied its own demand gate. */
  impressionsByUrl: ReadonlyMap<string, number>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many redirect-hygiene cards, at most, per run - highest-demand first. */
export const MAX_REDIRECT_HYGIENE_EMISSIONS = 8;

const TOPIC_CLUSTER_LABEL: Record<RedirectHygieneKind, string> = {
  redirect_chain: "Redirect chain",
  soft_404: "Soft 404",
};

const TRIGGER_SIGNAL: Record<RedirectHygieneKind, string> = {
  redirect_chain: "redirect_chain",
  soft_404: "soft_404",
};

/**
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned snapshots in the loader.
 */
export function redirectHygiene(
  input: RedirectHygieneTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, impressionsByUrl, signalAt } = input;
  const max = input.maxEmissions ?? MAX_REDIRECT_HYGIENE_EMISSIONS;
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
    const targetUrl = f.url;
    const topic = TOPIC_CLUSTER_LABEL[f.kind];
    out.push({
      tenant_id: tenantId,
      trigger_signal: TRIGGER_SIGNAL[f.kind],
      action_type: "fix_status_code",
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topic,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: "medium",
      impact_estimate: f.kind === "soft_404" ? "high" : "medium",
      customer_copy: f.reason_copy,
      operator_evidence:
        "signal=" +
        TRIGGER_SIGNAL[f.kind] +
        "; url=" +
        f.url +
        "; impressions_90d=" +
        String(impressionsByUrl.get(f.url) ?? 0) +
        "; play=redirect_hygiene; " +
        f.evidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: "fix_status_code",
        targetUrl,
        topicClusterLabel: topic,
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
