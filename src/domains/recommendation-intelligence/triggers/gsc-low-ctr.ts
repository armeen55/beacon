/**
 * Insight Graph slice 1 (2026-06-12) — trigger predicate:
 * `gsc_low_ctr`. The first FUSED recommendation: the tenant's OWN
 * Google Search Console truth (queries, impressions, CTR, position)
 * drives a page edit, instead of crawl-only heuristics.
 *
 * Rule A — "high impressions, low CTR → rewrite the title":
 *   For a page's top queries, when
 *     position ≤ 5 (rounded)          AND
 *     impressions ≥ 200 over 28 days  AND
 *     ctr < 0.5 × expected_ctr(position)
 *   the page earns ONE edit_title candidate carrying the worst
 *   under-performing query + its exact numbers as evidence.
 *
 * Threshold grounding (sources cited in the slice commit):
 *   • Expected per-position CTR benchmarks: Semrush (Dec 2025) —
 *     pos 1 ≈ 39.8%, 2 ≈ 18.7%, 3 ≈ 10.2%, 4 ≈ 7.2%, 5 ≈ 5.1%.
 *     v1 deliberately restricts to positions 1–5 — the band these
 *     benchmarks fully cover (no guessed numbers for 6+).
 *   • "Below half the positional benchmark" mirrors Ahrefs'/
 *     Backlinko's low-CTR-vs-positional-average plays.
 *   • The title is the lever per Google's title-link doc: it is
 *     "often the primary piece of information people use to decide
 *     which result to click".
 *   • 28-day aggregation: single-day CTR is too noisy (all sources
 *     aggregate before thresholding).
 *
 * These constants are RESEARCH-DERIVED calibration, not business
 * vocabulary — they apply to any vertical/geo/language because the
 * comparison is the page's own numbers vs the position's benchmark.
 *
 * PURE FUNCTION — the per-page signal is a pre-loaded input
 * (gsc-page-signals.ts does the I/O), mirroring the indexability
 * predicates. Pinned by `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { gscLowCtrCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { GscPageSignal, GscQuerySignal } from "../gsc-page-signals";

export type GscLowCtrInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  /** Pre-loaded 28-day signal for this snapshot's page, or undefined
   *  when GSC has no data for it (or isn't connected). */
  signal: GscPageSignal | undefined;
};

/** Semrush (Dec 2025) per-position organic CTR benchmarks, as
 *  fractions. Positions 1–5 only — the band the source covers. */
export const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.398,
  2: 0.187,
  3: 0.102,
  4: 0.072,
  5: 0.051,
};

const MIN_IMPRESSIONS_28D = 200;
const CTR_SHORTFALL_FACTOR = 0.5;

/** The under-performing queries for a page, worst shortfall first. */
export function underperformingQueries(
  signal: GscPageSignal,
): GscQuerySignal[] {
  const out: Array<{ q: GscQuerySignal; shortfall: number }> = [];
  for (const q of signal.topQueries) {
    if (q.impressions < MIN_IMPRESSIONS_28D) continue;
    const pos = Math.round(q.position);
    const expected = EXPECTED_CTR_BY_POSITION[pos];
    if (expected == null) continue; // outside the sourced 1–5 band
    if (q.ctr >= expected * CTR_SHORTFALL_FACTOR) continue;
    out.push({ q, shortfall: expected - q.ctr });
  }
  out.sort((a, b) => b.shortfall - a.shortfall);
  return out.map((e) => e.q);
}

export function gscLowCtr(input: GscLowCtrInput): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (signal == null) return [];

  const losers = underperformingQueries(signal);
  if (losers.length === 0) return [];
  const worst = losers[0]!;

  const actionType = "edit_title" as const;
  const targetUrl = snapshot.url;
  // The under-performing query IS the topic — it also keys dedupe so
  // a different worst-query later produces a fresh candidate.
  const topicClusterLabel = worst.query;
  const pct = (f: number) => (f * 100).toFixed(1) + "%";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "gsc_low_ctr",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "gsc_28d query=" +
            worst.query +
            "; impressions=" +
            worst.impressions +
            "; clicks=" +
            worst.clicks +
            "; ctr=" +
            pct(worst.ctr) +
            "; position=" +
            worst.position.toFixed(1) +
            "; expected_ctr=" +
            pct(EXPECTED_CTR_BY_POSITION[Math.round(worst.position)] ?? 0),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: gscLowCtrCopy(worst.query, worst.impressions),
      operator_evidence:
        "signal=gsc_low_ctr; window=28d; page_impressions=" +
        signal.impressions28d +
        "; page_ctr=" +
        pct(signal.ctr28d) +
        "; underperforming=" +
        losers
          .map(
            (q) =>
              q.query +
              " (pos " +
              q.position.toFixed(1) +
              ", ctr " +
              pct(q.ctr) +
              ", " +
              q.impressions +
              " impr)",
          )
          .join(" | "),
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
