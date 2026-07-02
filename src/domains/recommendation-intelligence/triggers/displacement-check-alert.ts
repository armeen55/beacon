/**
 * Displacement check alert trigger (BEACON 500 item 82, 2026-07-02) -
 * predicate `displacement_check`.
 *
 * THE GAP: nightly picks already react to OPPORTUNITIES (a new keyword
 * opening up, an AI engine gap); a real LOSS on a money query the tenant
 * already ranked for got no reflex at all until an operator happened to look.
 * `runDisplacementCheckForTenant` (src/domains/serp/displacement-check.ts)
 * does the actual work off-predicate: it finds a 7d-vs-prior-7d position drop
 * of 3+ on a query with real clicks, spends ONE capped live Google check
 * through the existing `runSerpQuery` gauntlet, reads off who now outranks
 * the tenant, and persists a `DisplacementVerdict` via move_drafts. This
 * predicate is a thin, PURE wrapper that turns each already-persisted
 * verdict into a `RecommendationCandidateRow` - it does no drop math and no
 * paid call itself (the trigger-predicate purity invariant forbids I/O here).
 *
 * ACTION: `watch` - the same "track without editing" passive action `watch`
 * already represents. This is a loss alert, not a drafted fix: the operator
 * decides how to respond (a content refresh, matching a displacer's format,
 * or nothing if the query wasn't worth defending). We deliberately do NOT
 * trigger a fresh competitor teardown here beyond the one SERP pull already
 * spent in displacement-check.ts - when a cached teardown exists the copy
 * names what the displacer's page has; otherwise it offers reading it next.
 *
 * Anchored on the affected page itself (`verdict.page`) - unlike
 * profound-aeo-gap/sov-drop-alert's site-root anchor, a displacement is a
 * page-level loss with a known owned URL, so it gets the more specific
 * anchor the queue rules already allow.
 *
 * ONE emission per verdict, worst drop (biggest position loss) first, capped
 * so a bad week of drops does not flood the plan.
 *
 * PURE FUNCTION over pre-loaded verdicts. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { displacementCheckCopy } from "../customer-copy-templates";
import type { DisplacementVerdict } from "@/domains/serp/displacement-check";

export type DisplacementCheckAlertInput = {
  tenantId: string;
  /** Pre-computed, pre-persisted verdicts from displacement-check.ts (empty
   *  when no drop qualified, or none were checked yet). */
  verdicts: ReadonlyArray<DisplacementVerdict>;
  /** ISO timestamp the verdicts feed was read at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many verdicts feed the candidate builder per run, mirroring
   *  sov-drop-alert's DEFAULT_MAX_CANDIDATES. Defaults to 3. */
  maxCandidates?: number;
};

const DEFAULT_MAX_CANDIDATES = 3;

/**
 * @no-classifier-required: the anchor is a known owned page URL taken
 * directly from the persisted verdict (the page GSC attributes the query
 * to), not a crawled snapshot - neither `classifyPageType` nor
 * `isNonHtmlAsset` applies to a URL string with no snapshot in hand.
 * (Sanctioned opt-out per the page-classifier architecture invariant, same
 * shape of opt-out profound-aeo-gap.ts / sov-drop-alert.ts use for their own
 * non-snapshot anchors.)
 */
export function displacementCheckAlert(
  input: DisplacementCheckAlertInput,
): RecommendationCandidateRow[] {
  const { tenantId, verdicts, signalAt } = input;
  if (verdicts.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const withPage = verdicts.filter((v) => v.page && v.page.trim().length > 0);
  // Worst drop first (biggest position loss).
  const ranked = [...withPage].sort((a, b) => b.positionDrop - a.positionDrop).slice(0, maxCandidates);

  const actionType = "watch" as const;

  return ranked.map((verdict) => {
    const targetUrl = verdict.page;
    const topDisplacer = verdict.displacers[0] ?? null;
    const topicClusterLabel = `displacement_check:${verdict.query}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "displacement_check",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: `displacement_check:${verdict.query}`,
          detail:
            "displacement_check query=" +
            verdict.query +
            "; page=" +
            verdict.page +
            "; prior_position=" +
            verdict.priorPosition.toFixed(1) +
            "; recent_position=" +
            verdict.recentPosition.toFixed(1) +
            "; position_drop=" +
            verdict.positionDrop.toFixed(1) +
            "; clicks_at_risk_per_week=" +
            verdict.clicksAtRiskPerWeek +
            "; fell_off_page=" +
            String(verdict.fellOffPage) +
            "; displacer_domain=" +
            (topDisplacer?.domain ?? "none") +
            "; displacer_url=" +
            (topDisplacer?.url ?? "none") +
            "; checked_at=" +
            verdict.checkedAt,
        },
      ],
      confidence: "medium",
      impact_estimate: verdict.positionDrop >= 5 || verdict.fellOffPage ? "high" : "medium",
      customer_copy: displacementCheckCopy(
        verdict.query,
        verdict.priorPosition,
        verdict.recentPosition,
        verdict.clicksAtRiskPerWeek,
        topDisplacer?.domain ?? null,
        topDisplacer?.whatTheyHave ?? null,
      ),
      operator_evidence:
        "signal=displacement_check; verdict checked at " + verdict.checkedAt,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
