/**
 * Insight Graph slice 1 (2026-06-12) — trigger predicate:
 * `gsc_low_ctr`. The first FUSED recommendation: the tenant's OWN
 * Google Search Console truth (queries, impressions, CTR, position)
 * drives a page edit, instead of crawl-only heuristics.
 *
 * Rule A — "high impressions, low CTR → rewrite the title":
 *   For a page's top queries, when
 *     position ≤ 5 (rounded)             AND
 *     impressions ≥ 200 over the window  AND
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
 *   • 90-day aggregation (operator pref 2026-06-13; audit #15 de-misnamed
 *     the fields 2026-06-14): single-day CTR is too noisy (all sources
 *     aggregate before thresholding). The 200-impression floor is a
 *     sample-size floor for a meaningful CTR — it is window-agnostic, so
 *     it stays 200 across the window change (NOT scaled to the window).
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
import {
  gscLowCtrCopy,
  gscStrikingDistanceCopy,
} from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { GscPageSignal, GscQuerySignal } from "../gsc-page-signals";

export type GscLowCtrInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  /** Pre-loaded 90-day signal for this snapshot's page, or undefined
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

const MIN_IMPRESSIONS = 200;
const CTR_SHORTFALL_FACTOR = 0.5;

/** The under-performing queries for a page, worst shortfall first. */
export function underperformingQueries(
  signal: GscPageSignal,
): GscQuerySignal[] {
  const out: Array<{ q: GscQuerySignal; shortfall: number }> = [];
  for (const q of signal.topQueries) {
    if (q.impressions < MIN_IMPRESSIONS) continue;
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
  // audit #10 (2026-06-14): GSC retains rows for URLs that have since gone
  // 404/5xx; don't emit a title-rewrite card for a dead page (mirrors
  // answer-block-readiness). Other per-page triggers already guard this.
  if (snapshot.http_status >= 400) return [];
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
            "gsc_90d query=" +
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
      // Sourced EV math: clicks recovered if CTR rises to the
      // positional benchmark (CTR-gap × impressions). The impressions
      // base is the 90-day window (worst.impressions ← GscQuerySignal,
      // aggregated over WINDOW_DAYS=90 in gsc-page-signals.ts), so the
      // upside is a per-90-day estimate — the field name `*90d` matches
      // that base (audit #15 / #337 de-misnamed it; was "*28d").
      upside_clicks_90d: Math.round(
        Math.max(
          0,
          (EXPECTED_CTR_BY_POSITION[Math.round(worst.position)] ?? 0) -
            worst.ctr,
        ) * worst.impressions,
      ),
      customer_copy: gscLowCtrCopy(worst.query, worst.impressions),
      operator_evidence:
        "signal=gsc_low_ctr; window=90d; page_impressions=" +
        signal.impressions90d +
        "; page_ctr=" +
        pct(signal.ctr90d) +
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

/**
 * Rule B — first-party striking distance (2026-06-12). Sourced bands:
 * SEJ tooling 4–20 default, Backlinko 8–20, Ahrefs "almost there"
 * <8.1 — v1 uses 4–15 (the overlap the GSC research recommends) with
 * the spec's impressions floor. The play (SEJ): the query must appear
 * in the title — when absent, an edit_title candidate carries the
 * query + numbers. First-party impressions are STRONGER evidence than
 * third-party volume (Mueller: tool volumes "will always be wrong").
 *
 * #339 — INTENTIONALLY NARROWER than the SEMrush striking band
 * (4–20, in semrush-page-signals.ts STRIKING_DISTANCE_{MIN,MAX}). The
 * two bands are NOT meant to match: this first-party GSC band is the
 * tighter "overlap the GSC research recommends" because GSC's own
 * impressions are clean, precise demand evidence, so the tighter 4–15
 * keeps cards to the highest-confidence near-page-one queries. The
 * SEMrush band is wider (4–20, the SEJ tooling default) because
 * third-party position/volume estimates are noisier, so a wider net is
 * the right trade for that weaker signal. Narrowing SEMrush to 4–15 to
 * "align" would drop real positions 16–20 the SEJ default explicitly
 * covers and contradict its sourcing — so they stay deliberately
 * distinct (documented, not unified). The customer-facing operator
 * evidence line below states the band per signal ("band=4-15" here vs
 * "band=4-20" in the SEMrush trigger) so the difference is visible.
 */
const STRIKING_MIN_POS = 4;
const STRIKING_MAX_POS = 15;
const STRIKING_MIN_IMPRESSIONS = 100;

function titleContains(text: string | null | undefined, q: string): boolean {
  const hay = (text ?? "").toLowerCase();
  if (!hay) return false;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

export function gscStrikingDistance(
  input: GscLowCtrInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  // audit #10 (2026-06-14): GSC retains rows for URLs that have since gone
  // 404/5xx; don't emit a title-rewrite card for a dead page (mirrors
  // answer-block-readiness). Other per-page triggers already guard this.
  if (snapshot.http_status >= 400) return [];
  if (signal == null) return [];

  const target = signal.topQueries
    .filter(
      (q) =>
        q.impressions >= STRIKING_MIN_IMPRESSIONS &&
        q.position >= STRIKING_MIN_POS &&
        q.position <= STRIKING_MAX_POS &&
        !titleContains(snapshot.title, q.query),
    )
    .sort((a, b) => b.impressions - a.impressions)[0];
  if (target == null) return [];

  const actionType = "edit_title" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = target.query;

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "gsc_striking_distance",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "gsc_90d striking query=" +
            target.query +
            "; impressions=" +
            target.impressions +
            "; position=" +
            target.position.toFixed(1) +
            "; keyword_in_title=false",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      // Upside if the page reaches position 3 (SEOmonitor's top-1-3
      // target convention) from its current striking position:
      // (ctr(3) − actual) × impressions. impressions is the 90-day
      // base, so this is a per-90-day estimate (field name `*90d`).
      upside_clicks_90d: Math.round(
        Math.max(0, 0.102 - target.ctr) * target.impressions,
      ),
      customer_copy: gscStrikingDistanceCopy(
        target.query,
        Math.round(target.position),
        target.impressions,
      ),
      operator_evidence:
        "signal=gsc_striking_distance; band=4-15; window=90d; query=" +
        target.query +
        "; impressions=" +
        target.impressions +
        "; position=" +
        target.position.toFixed(1),
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
