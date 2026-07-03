/**
 * broken-links (2026-07-03, BEACON_500 P11 v1 319/475) - the trigger adapter that
 * turns broken internal links (a page linking at a target that returns
 * 4xx/5xx) into capped RecommendationCandidateRow[], ONE card per source page.
 *
 * PURE. The loader aggregates every snapshot's internal_links, builds a target ->
 * liveness map (owned pages' own snapshot statuses give this for free at $0; an
 * optional polite + capped + fail-soft live pass fills in a few external /
 * not-yet-snapshotted targets), and passes a `livenessOf` lookup + the assembled
 * source pages here. A target with no known status is honestly SKIPPED (unknown
 * is never counted as broken).
 *
 * ACTION TYPE: add_internal_link (the same fix family orphan-page uses - the owner
 * repoints or removes the dead links on the named page). Confidence medium so the
 * card is customer-queue eligible; a definitively-dead target (from an owned 404
 * snapshot or a real fetch) is unambiguous.
 *
 * GLOBAL EMPTINESS GUARD: when NO source page carries any internal-link data, this
 * emits nothing (data unavailable, not "no broken links"). The loader passes
 * `hasLinkData` so this is decided on real evidence.
 *
 * CAPPED, highest-dead-count first. Byte-identical when every link is live (or
 * unknown). No em or en dashes.
 */

import type { BrokenLinkFinding } from "@/domains/technical-seo/broken-links";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type BrokenLinksTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<BrokenLinkFinding>;
  /** True when at least one snapshot carried internal-link data. When false the
   *  findings list is meaningless (no evidence) and this emits nothing. */
  hasLinkData: boolean;
  signalAt: string;
  maxEmissions?: number;
};

/** How many broken-link cards, at most, per run - most dead links first. */
export const MAX_BROKEN_LINKS_EMISSIONS = 8;

const TOPIC_CLUSTER_LABEL = "Broken internal links";

/**
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned snapshots in the loader.
 */
export function brokenLinks(
  input: BrokenLinksTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, hasLinkData, signalAt } = input;
  if (!hasLinkData) return [];
  const max = input.maxEmissions ?? MAX_BROKEN_LINKS_EMISSIONS;
  if (findings.length === 0) return [];

  // Most-broken pages first, then a stable source-URL tiebreak.
  const ranked = [...findings].sort(
    (a, b) =>
      b.deadTargets.length - a.deadTargets.length ||
      a.sourceUrl.localeCompare(b.sourceUrl),
  );

  const out: RecommendationCandidateRow[] = [];
  for (const f of ranked.slice(0, max)) {
    const targetUrl = f.sourceUrl;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "broken_internal_links",
      action_type: "add_internal_link",
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: TOPIC_CLUSTER_LABEL,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: f.reason_copy,
      operator_evidence:
        "signal=broken_internal_links; source=" +
        f.sourceUrl +
        "; dead_count=" +
        String(f.deadTargets.length) +
        "; play=broken_link_fixer; " +
        f.evidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: "add_internal_link",
        targetUrl,
        topicClusterLabel: TOPIC_CLUSTER_LABEL,
      }),
      cooldown_key: cooldownKey({
        tenantId,
        actionType: "add_internal_link",
        targetUrl,
      }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
