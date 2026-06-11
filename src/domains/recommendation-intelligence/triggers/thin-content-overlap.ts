/**
 * 2026-06-11 (night shift, inventory #43) — trigger predicate:
 * `thin_content_overlap` → `merge_pages`.
 *
 * The resurrection playbook's "two thin pages bleeding into each
 * other" detector: cross-snapshot aggregation over OWNED, thin
 * (< THIN_WORD_COUNT words) HTML pages whose title/h1 token sets
 * overlap heavily — classic cannibalization candidates that usually
 * perform better folded into one stronger page.
 *
 * Deliberately conservative + calibration-first:
 *   • Emits at `confidence: "low"` so `applyQueueRules` routes every
 *     candidate to `diagnostic_only` — the operator validates on the
 *     trigger page; NOTHING auto-promotes (merge_pages also has no
 *     eligibility-table entry, so the promotion ladder blocks it
 *     independently — two locks).
 *   • Pairwise only over the THIN subset (bounded n²).
 *   • Token overlap ignores site-wide boilerplate via document
 *     frequency (a brand token on every title is not topical overlap)
 *     — same vertical-agnostic technique as the draft enricher.
 *
 * PURE FUNCTION (predicate purity invariant).
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { mergePagesCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";

export const THIN_WORD_COUNT = 400;
export const MIN_SHARED_TOKENS = 3;
export const MIN_JACCARD = 0.5;

export type ThinContentOverlapInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
};

const GENERIC_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "this", "that", "what",
  "when", "where", "how", "why", "are", "was", "were", "will", "can",
  "about", "into", "near", "best", "guide", "page", "home",
]);

function tokensOf(snap: PageSnapshot): Set<string> {
  const out = new Set<string>();
  for (const raw of `${snap.title ?? ""} ${snap.h1 ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)) {
    if (raw.length >= 4 && !GENERIC_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

export function thinContentOverlap(
  input: ThinContentOverlapInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots } = input;

  // Thin, owned, HTML, healthy-status pages only.
  const thin = snapshots.filter(
    (s) =>
      !isNonHtmlAsset(s.url) &&
      s.http_status < 400 &&
      (s.word_count ?? 0) > 0 &&
      (s.word_count ?? 0) < THIN_WORD_COUNT,
  );
  if (thin.length < 2) return [];

  // Site-wide boilerplate tokens (brand names) — document frequency over
  // ALL snapshots, not just thin ones, so the filter is stable.
  const docFreq = new Map<string, number>();
  let docs = 0;
  for (const s of snapshots) {
    if (isNonHtmlAsset(s.url)) continue;
    docs++;
    for (const t of tokensOf(s)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const isBoilerplate = (t: string) => {
    const n = docFreq.get(t) ?? 0;
    return n >= 3 && n / Math.max(docs, 1) > 0.5;
  };

  const tokenSets = thin.map((s) => ({
    snap: s,
    tokens: new Set([...tokensOf(s)].filter((t) => !isBoilerplate(t))),
  }));

  const out: RecommendationCandidateRow[] = [];
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const a = tokenSets[i]!;
      const b = tokenSets[j]!;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;
      let shared = 0;
      for (const t of a.tokens) if (b.tokens.has(t)) shared++;
      if (shared < MIN_SHARED_TOKENS) continue;
      const unionSize = a.tokens.size + b.tokens.size - shared;
      if (unionSize === 0 || shared / unionSize < MIN_JACCARD) continue;

      // Canonical anchor = alphabetically-first URL; the candidate
      // targets the OTHER page (the one to fold in).
      const [anchor, target] =
        a.snap.url < b.snap.url ? [a.snap, b.snap] : [b.snap, a.snap];
      const actionType = "merge_pages" as const;
      const topicClusterLabel = "Overlapping thin pages";
      out.push({
        tenant_id: tenantId,
        trigger_signal: "thin_content_overlap",
        action_type: actionType,
        generator_kind: "deterministic",
        target_url: target.url,
        topic_cluster_label: topicClusterLabel,
        evidence: [
          {
            kind: "page_snapshot_pair",
            ref: target.url,
            detail: `overlaps ${anchor.url} (${shared} shared topic words; both under ${THIN_WORD_COUNT} words)`,
          },
        ],
        confidence: "low",
        impact_estimate: "medium",
        customer_copy: mergePagesCopy(),
        operator_evidence:
          `thin_content_overlap: ${target.url} (${target.word_count}w) vs ${anchor.url} (${anchor.word_count}w); ` +
          `shared=${shared} jaccard=${(shared / unionSize).toFixed(2)}`,
        dedupe_key: dedupeKey({
          tenantId,
          actionType,
          targetUrl: target.url,
          topicClusterLabel,
        }),
        cooldown_key: cooldownKey({
          tenantId,
          actionType,
          targetUrl: target.url,
        }),
        created_from_signal_at: target.fetched_at,
        safety_flags: [],
      });
    }
  }
  return out;
}
