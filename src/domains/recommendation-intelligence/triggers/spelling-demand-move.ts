/**
 * spelling-demand-move (P20, v1 129, 2026-07-03) - own-the-canonical-spelling
 * Move.
 *
 * THE PLAY: a tenant's audience types the same thing several ways, so the demand
 * splits across spellings and no single one looks big enough to build a page
 * for. Consolidated, the combined demand is real and no owned page captures it
 * yet. This emits a create_page Move to own the canonical spelling and name the
 * other spellings on that one page.
 *
 * GENERIC + language-agnostic. It fires ONLY when the tenant has declared
 * spelling groups (config) AND the consolidated demand clears the floor AND no
 * owned page already captures the variants. With no config the loader passes no
 * items and this predicate returns [] - byte-identical to a world without it.
 *
 * The pure math (which spellings, how much demand, which owned pages already
 * capture them) lives in @/domains/spelling-demand; this predicate only shapes
 * the ready items into create_page directives (predicate purity invariant).
 *
 * Anchored on the site root because the target page does not exist yet (queue
 * rules require a URL); the owner creates the canonical page. Deduped by
 * cooldown_key so the same canonical never emits twice.
 *
 * Never says a lab word. No em or en dashes anywhere. PURE FUNCTION.
 */

import type { SpellingDemandMoveItem } from "@/domains/spelling-demand/build-move-items";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { spellingDemandConsolidationCopy } from "../customer-copy-templates";

export type SpellingDemandMoveInput = {
  tenantId: string;
  items: ReadonlyArray<SpellingDemandMoveItem>;
  /** Site root the create_page directive anchors on (target does not exist). */
  siteRootUrl: string | null;
  signalAt: string;
  maxEmissions?: number;
};

const DEFAULT_MAX_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes pre-consolidated, demand-gated spelling
 * groups (built in the loader from the tenant's own config + GSC demand). The
 * anchor is the site root, not an owned page, so there is no per-page type to
 * classify.
 */
export function spellingDemandMove(
  input: SpellingDemandMoveInput,
): RecommendationCandidateRow[] {
  const { tenantId, items, siteRootUrl, signalAt } = input;
  if (items.length === 0 || !siteRootUrl) return [];
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  // Highest combined demand first; stable canonical tiebreak.
  const ordered = [...items].sort(
    (a, b) =>
      b.combinedDemand - a.combinedDemand ||
      a.canonical.localeCompare(b.canonical),
  );

  const out: RecommendationCandidateRow[] = [];
  const seenCanonical = new Set<string>();
  for (const it of ordered.slice(0, max)) {
    const canonicalKey = it.canonical.toLowerCase().trim();
    if (seenCanonical.has(canonicalKey)) continue;
    seenCanonical.add(canonicalKey);

    const actionType = "create_page" as const;
    const topicClusterLabel = it.canonical;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "spelling_demand_move",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: siteRootUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "business_config",
          ref: "spelling_variants",
          detail:
            "spelling_demand_move canonical=" +
            it.canonical +
            "; combined_demand=" +
            String(it.combinedDemand) +
            "; spellings=" +
            String(it.spellingCount) +
            "; top_spelling_demand=" +
            String(it.topSpellingDemand) +
            "; other_spellings=" +
            it.otherSpellings.slice(0, 8).join(" | "),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: spellingDemandConsolidationCopy(
        it.canonical,
        it.combinedDemand,
        it.spellingCount,
        it.topSpellingDemand,
      ),
      operator_evidence:
        "signal=spelling_demand_move; canonical=" +
        it.canonical +
        "; combined_demand=" +
        String(it.combinedDemand) +
        "; spellings_with_demand=" +
        String(it.spellingCount) +
        "; top_spelling_demand=" +
        String(it.topSpellingDemand) +
        "; other_spellings=" +
        it.otherSpellings.slice(0, 8).join(",") +
        "; play=own_canonical_spelling",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl: siteRootUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl: siteRootUrl + "#spelling:" + canonicalKey }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
