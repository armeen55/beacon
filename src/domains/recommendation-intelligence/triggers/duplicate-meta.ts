/**
 * 2026-05-19 — Slice 4.5.B.α₂ + α₂.2 trigger predicate:
 * `duplicate_meta`.
 *
 * Cross-snapshot aggregation predicate. Symmetric shape to
 * `duplicate-title` over `meta_description`. Runs ONCE over the
 * full tenant snapshot list; emits an `edit_meta` candidate per
 * occurrence past the alphabetical-first canonical anchor.
 *
 * α₂.2 (2026-05-19) added the `isNonHtmlAsset` filter — technical
 * assets are excluded BEFORE grouping.
 *
 * Normalization (locked α₂ rule):
 *   trim() → toLowerCase() → collapse internal whitespace
 *   (`/\s+/g → " "`). Snapshots whose meta_description is null /
 *   empty / whitespace-only OR whose normalized value is empty
 *   are skipped (those cases are owned by `missing-meta`).
 *
 * Canonical anchor: first URL alphabetically per group. Group of
 * N URLs emits N-1 candidates.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity` +
 * `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { duplicateMetaCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";

export type DuplicateMetaInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function duplicateMeta(
  input: DuplicateMetaInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots } = input;

  const groups = new Map<string, PageSnapshot[]>();
  for (const snap of snapshots) {
    // α₂.2: filter technical assets BEFORE grouping.
    if (isNonHtmlAsset(snap.url)) continue;
    if (snap.meta_description == null) continue;
    const key = normalize(snap.meta_description);
    if (key.length === 0) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(snap);
    groups.set(key, bucket);
  }

  const out: RecommendationCandidateRow[] = [];
  for (const [normalizedMeta, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
    );
    const canonicalUrl = sorted[0]!.url;
    for (let i = 1; i < sorted.length; i++) {
      const snap = sorted[i]!;
      const actionType = "edit_meta" as const;
      const targetUrl = snap.url;
      const topicClusterLabel = "Meta description";
      out.push({
        tenant_id: tenantId,
        trigger_signal: "duplicate_meta",
        action_type: actionType,
        generator_kind: "deterministic",
        target_url: targetUrl,
        topic_cluster_label: topicClusterLabel,
        evidence: [
          {
            kind: "page_snapshot_pair",
            ref: targetUrl,
            detail:
              "duplicate meta description shared by " +
              String(sorted.length) +
              " owned pages",
          },
        ],
        confidence: "high",
        impact_estimate: "medium",
        customer_copy: duplicateMetaCopy(sorted.length),
        operator_evidence:
          "Duplicate meta_description across " +
          String(sorted.length) +
          " snapshots (normalized: " +
          JSON.stringify(normalizedMeta) +
          ", canonical=" +
          canonicalUrl +
          ")",
        dedupe_key: dedupeKey({
          tenantId,
          actionType,
          targetUrl,
          topicClusterLabel,
        }),
        cooldown_key: cooldownKey({
          tenantId,
          actionType,
          targetUrl,
        }),
        created_from_signal_at: snap.fetched_at,
        safety_flags: [],
      });
    }
  }
  return out;
}
