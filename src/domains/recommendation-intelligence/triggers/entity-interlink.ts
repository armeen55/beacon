/**
 * entity-interlink (2026-07-03, BEACON_500 R18 / P7, v1 95/112) - entity
 * auto-interlink trigger.
 *
 * THE PLAY: a page talks about a topic ANOTHER of your pages owns, but never
 * links to it. Adding a contextual in-body link to the owner page passes the
 * discovery + relevance that owner page is currently missing, and keeps readers
 * on your site. Grounded in the page's REAL stored body text (never a guess) and
 * the N2 ownership registry (never links to a contender, only the owner).
 *
 * The candidate TARGETS THE SOURCE page (that is where the edit lands - add a
 * link on the topic words). Suggested anchor = the topic label.
 *
 * The pure core (linkgraph/entity-interlink.ts) does the matching; this predicate
 * shapes its candidates into RecommendationCandidateRows. The LOADER supplies the
 * resolved (source, destination-owner, topic) tuples so this predicate stays a
 * pure reducer (predicate purity invariant - no I/O, no registry read here).
 *
 * DEDUP: the loader dedupes these against the existing internal_link_opportunity
 * cards by cooldown_key (tenant, action, source url), so a source page never
 * emits both. This trigger is the tighter, body-grounded, ownership-aware signal;
 * internal_link_opportunity is the broader title/H1-overlap signal.
 *
 * PURE FUNCTION. No em or en dashes anywhere.
 */

import type { InterlinkCandidate } from "@/domains/linkgraph/entity-interlink";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { entityInterlinkCopy } from "../customer-copy-templates";

export type EntityInterlinkInput = {
  tenantId: string;
  /** Resolved interlink candidates from the pure core (source page -> owner page
   *  for a topic the source page's body actually mentions). */
  candidates: ReadonlyArray<InterlinkCandidate>;
  signalAt: string;
  maxEmissions?: number;
};

const DEFAULT_MAX_EMISSIONS = 8;

/** Path (or the whole URL when unparseable) for the customer copy. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * @no-classifier-required: consumes pre-resolved interlink candidates whose
 * source + destination node universe already excluded non-HTML assets
 * (isNonHtmlAsset is applied in load-linkgraph-triggers.ts when the nodes are
 * built), so no per-page classification is needed here.
 */
export function entityInterlink(input: EntityInterlinkInput): RecommendationCandidateRow[] {
  const { tenantId, candidates, signalAt } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;
  if (candidates.length === 0) return [];

  // Rank: most distinguishing-token proof first (a fuller mention is a stronger
  // link), then stable (source, destination) tiebreak for determinism.
  const ranked = [...candidates].sort(
    (a, b) =>
      b.matchedTokens.length - a.matchedTokens.length ||
      a.sourceUrl.localeCompare(b.sourceUrl) ||
      a.destinationUrl.localeCompare(b.destinationUrl),
  );

  const out: RecommendationCandidateRow[] = [];
  for (const c of ranked.slice(0, max)) {
    const actionType = "add_internal_link" as const;
    const targetUrl = c.sourceUrl; // the page being EDITED
    // topic_cluster_label carries the destination so two links FROM the same
    // source TO different destinations are distinct dedupe rows (cooldown_key is
    // still coarse per source so cross-source dedup stays intentional).
    const topicClusterLabel = c.destinationUrl;
    out.push({
      tenant_id: tenantId,
      trigger_signal: "entity_interlink",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "entity_interlink destination=" +
            c.destinationUrl +
            "; topic=" +
            c.topicLabel +
            "; matched_tokens=" +
            c.matchedTokens.slice(0, 6).join(",") +
            "; suggested_anchor=" +
            c.suggestedAnchor,
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: entityInterlinkCopy(c.topicLabel, pathOf(c.destinationUrl)),
      operator_evidence:
        "signal=entity_interlink; source=" +
        c.sourceUrl +
        "; destination=" +
        c.destinationUrl +
        "; topic=" +
        c.topicLabel +
        "; matched_tokens=" +
        c.matchedTokens.join(",") +
        "; suggested_anchor=" +
        c.suggestedAnchor +
        "; play=entity_auto_interlink_to_owner",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
