/**
 * Cannibalization slice (2026-06-12) — cross-page trigger:
 * `semrush_cannibalization`. The SAME keyword ranking two of the
 * tenant's own pages splits link equity and leaves the engine to
 * guess the canonical answer (Semrush cannibalization guide; SEL +
 * Backlinko corroboration — sources in the slice commit). The guide's
 * remedies: consolidate via 301/canonical, or point internal links at
 * the preferred page. v1 emits the SAFEST remedy deterministically —
 * an internal link from the cannibal page to the preferred page —
 * at operator-review tier (link-structure advice wants human eyes;
 * same tier as orphan_page::add_internal_link).
 *
 * Intent guard: rows with DIFFERENT stored intent classes never pair
 * (different intent = legitimately different pages, per the guide).
 *
 * @no-classifier-required — cross-page advisory keyed to URLs from
 * the SEMrush rank data (non-HTML assets cannot rank organically);
 * no snapshot classification is involved.
 *
 * PURE — the cases are a pre-loaded input (the page-signals module
 * detects them from synced rows). Pinned by the purity ratchet.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { cannibalizationCopy } from "../customer-copy-templates";
import type { CannibalizationCase } from "../semrush-page-signals";

export type SemrushCannibalizationInput = {
  tenantId: string;
  cases: ReadonlyArray<CannibalizationCase>;
  /** Emission cap per run (volume-ranked upstream). */
  maxEmissions?: number;
  /** Timestamp for created_from_signal_at (the sync's data moment). */
  signalAt: string;
};

const DEFAULT_MAX_EMISSIONS = 5;

export function semrushCannibalization(
  input: SemrushCannibalizationInput,
): RecommendationCandidateRow[] {
  const { tenantId, cases, signalAt } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;
  const out: RecommendationCandidateRow[] = [];
  for (const c of cases.slice(0, max)) {
    const actionType = "add_internal_link" as const;
    const targetUrl = c.cannibalUrl;
    const topicClusterLabel = c.keyword;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "semrush_cannibalization",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "cannibalization keyword=" +
            c.keyword +
            "; preferred=" +
            c.preferredUrl +
            " (#" +
            c.preferredPosition +
            "); this_page=#" +
            c.cannibalPosition +
            "; volume_per_month=" +
            c.volume,
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: cannibalizationCopy(c.keyword),
      operator_evidence:
        "signal=semrush_cannibalization; keyword=" +
        c.keyword +
        "; preferred=" +
        c.preferredUrl +
        " (#" +
        c.preferredPosition +
        "); cannibal=" +
        c.cannibalUrl +
        " (#" +
        c.cannibalPosition +
        "); volume=" +
        c.volume +
        "; intent=" +
        (c.intent ?? "null") +
        "; remedies=internal_link_preferred|canonical|301 (operator chooses)",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
