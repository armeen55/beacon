/**
 * 2026-05-19 — Slice 4.5.B.α₂ trigger predicate: `duplicate_title`.
 *
 * Cross-snapshot aggregation predicate. Runs ONCE over the full
 * tenant snapshot list (the loader invokes this before the per-
 * snapshot loop). Groups owned snapshots by normalized title;
 * emits an `edit_title` candidate per occurrence past the
 * alphabetical-first canonical anchor.
 *
 * Normalization (locked α₂ rule):
 *   trim() → toLowerCase() → collapse internal whitespace
 *   (`/\s+/g → " "`). Snapshots whose title is null / empty /
 *   whitespace-only OR whose normalized value is empty are
 *   skipped (those cases are owned by `missing-title`).
 *
 * Canonical anchor: first URL alphabetically per group. Deterministic
 * + stable across loader invocations. Group of N URLs emits N-1
 * candidates.
 *
 * PURE FUNCTION. Pinned by
 * `recommendation-trigger-predicates-purity`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { duplicateTitleCopy } from "../customer-copy-templates";

export type DuplicateTitleInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function duplicateTitle(
  input: DuplicateTitleInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots } = input;

  const groups = new Map<string, PageSnapshot[]>();
  for (const snap of snapshots) {
    if (snap.title == null) continue;
    const key = normalize(snap.title);
    if (key.length === 0) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(snap);
    groups.set(key, bucket);
  }

  const out: RecommendationCandidateRow[] = [];
  for (const [normalizedTitle, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
    );
    const canonicalUrl = sorted[0]!.url;
    for (let i = 1; i < sorted.length; i++) {
      const snap = sorted[i]!;
      const actionType = "edit_title" as const;
      const targetUrl = snap.url;
      const topicClusterLabel = "Page title";
      out.push({
        tenant_id: tenantId,
        trigger_signal: "duplicate_title",
        action_type: actionType,
        generator_kind: "deterministic",
        target_url: targetUrl,
        topic_cluster_label: topicClusterLabel,
        evidence: [
          {
            kind: "page_snapshot_pair",
            ref: targetUrl,
            detail:
              "duplicate title shared by " +
              String(sorted.length) +
              " owned pages",
          },
        ],
        confidence: "high",
        impact_estimate: "medium",
        customer_copy: duplicateTitleCopy(sorted.length),
        operator_evidence:
          "Duplicate title across " +
          String(sorted.length) +
          " snapshots (normalized: " +
          JSON.stringify(normalizedTitle) +
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
