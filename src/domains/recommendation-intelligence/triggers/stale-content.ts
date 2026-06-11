/**
 * 2026-06-11 (night shift, inventory #44) — trigger predicate:
 * `stale_content` → `update_intro`.
 *
 * The resurrection playbook's "this 2019 page" detector: pages whose
 * sitemap lastmod is older than STALE_MONTHS get a refresh candidate.
 * The sitemap's own lastmod is the page declaring its age — no crawl
 * heuristics, no vertical assumptions.
 *
 * Deliberately conservative + calibration-first:
 *   • Emits at `confidence: "low"` → `diagnostic_only` routing (the
 *     operator calibrates; nothing auto-promotes — `stale_content::
 *     update_intro` also has no eligibility entry: double-locked).
 *   • Caps at MAX_EMISSIONS_PER_RUN oldest pages so a fully-stale
 *     archive doesn't flood the diagnostic page.
 *   • Pages without a lastmod are SKIPPED (unknown age is not
 *     evidence of staleness).
 *
 * PURE FUNCTION — the loader pre-loads the per-tenant lastmod map
 * from the sitemap reconciliation (predicate purity invariant).
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { staleContentCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";

export const STALE_MONTHS = 18;
export const MAX_EMISSIONS_PER_RUN = 15;

export type StaleContentInput = {
  tenantId: string;
  snapshots: ReadonlyArray<PageSnapshot>;
  /** normalized URL (lowercase, no trailing slash) → sitemap lastmod ISO. */
  lastmodByUrl: ReadonlyMap<string, string>;
  /** Injected clock for determinism in tests. */
  now: Date;
};

export function normalizeStaleUrl(raw: string): string {
  return raw.toLowerCase().replace(/\/+$/, "");
}

export function staleContent(
  input: StaleContentInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshots, lastmodByUrl, now } = input;
  if (lastmodByUrl.size === 0) return [];
  const cutoff = new Date(now.getTime() - STALE_MONTHS * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const stale: Array<{ snap: PageSnapshot; lastmod: string }> = [];
  for (const snap of snapshots) {
    if (isNonHtmlAsset(snap.url)) continue;
    if (snap.http_status >= 400) continue;
    if ((snap.word_count ?? 0) === 0) continue;
    const lastmod = lastmodByUrl.get(normalizeStaleUrl(snap.url));
    if (!lastmod) continue; // unknown age ≠ stale
    if (lastmod.slice(0, 10) >= cutoff) continue;
    stale.push({ snap, lastmod });
  }

  stale.sort((a, b) => a.lastmod.localeCompare(b.lastmod)); // oldest first
  const out: RecommendationCandidateRow[] = [];
  for (const { snap, lastmod } of stale.slice(0, MAX_EMISSIONS_PER_RUN)) {
    const actionType = "update_intro" as const;
    const topicClusterLabel = "Aging content";
    out.push({
      tenant_id: tenantId,
      trigger_signal: "stale_content",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: snap.url,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: snap.url,
          detail: `sitemap lastmod ${lastmod.slice(0, 10)} — older than ${STALE_MONTHS} months`,
        },
      ],
      confidence: "low",
      impact_estimate: "medium",
      customer_copy: staleContentCopy(),
      operator_evidence: `stale_content: lastmod=${lastmod} cutoff=${cutoff} url=${snap.url}`,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl: snap.url,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType,
        targetUrl: snap.url,
      }),
      created_from_signal_at: snap.fetched_at,
      safety_flags: [],
    });
  }
  return out;
}
