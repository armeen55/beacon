/**
 * Insight Graph slice 2 (2026-06-12) — trigger predicate:
 * `semrush_striking_distance`. Second fused signal: third-party rank
 * data (keyword, position, monthly volume, ranking URL) drives an
 * on-page push for keywords just short of page-one prominence.
 *
 * Rule (sources cited in the slice commit):
 *   band 4–20 — inside the union of credible striking-distance bands
 *   (SEJ tooling defaults 4–20; Backlinko 8–20; Semrush's own
 *   quick-win filter 11–30); volume ≥ 10/mo (research spec's
 *   small-site floor). The on-page play (SEJ): check the keyword is
 *   present in the title — when it is NOT, an edit_title candidate
 *   carries the keyword + numbers; when it already is, the
 *   deterministic shape has nothing honest to add → abstain (the
 *   structured-output LLM path upgrades this later).
 *
 * PURE FUNCTION — the per-page signal is a pre-loaded input
 * (semrush-page-signals.ts does the I/O). Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { strikingDistanceCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { SemrushPageSignal } from "../semrush-page-signals";

export type SemrushStrikingDistanceInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  signal: SemrushPageSignal | undefined;
};

/** Tokenized containment: every keyword token appears in the text. */
export function textContainsKeyword(
  text: string | null | undefined,
  keyword: string,
): boolean {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack) return false;
  const tokens = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}

export function semrushStrikingDistance(
  input: SemrushStrikingDistanceInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (signal == null || signal.strikingDistance.length === 0) return [];

  // The best (highest-volume) striking keyword NOT already in the
  // title — the SEJ presence-check play.
  const target = signal.strikingDistance.find(
    (k) => !textContainsKeyword(snapshot.title, k.keyword),
  );
  if (target == null) return [];

  const actionType = "edit_title" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = target.keyword;

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "semrush_striking_distance",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "striking_distance keyword=" +
            target.keyword +
            "; position=" +
            target.position +
            "; volume_per_month=" +
            target.volume +
            "; keyword_in_title=false",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: strikingDistanceCopy(
        target.keyword,
        target.position,
        target.volume,
      ),
      operator_evidence:
        "signal=semrush_striking_distance; band=4-20; candidates=" +
        signal.strikingDistance
          .map((k) => `${k.keyword} (#${k.position}, ${k.volume}/mo)`)
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
