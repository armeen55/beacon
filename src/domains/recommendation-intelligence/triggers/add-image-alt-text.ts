/**
 * add-image-alt-text (2026-07-03, BEACON_500 P24 image-SEO lane, v1 410/248/552)
 * - the trigger adapter that turns pure alt-text-gap findings into capped,
 * demand-ranked RecommendationCandidateRow[].
 *
 * PURE. The loader reads the `images` field the scanner now captures on each
 * PageSnapshot, joins the GSC demand already loaded, runs classifyAltTextGap per
 * page (which composes the alt-audit coverage math with the deterministic alt
 * drafter), and passes the findings here.
 *
 * ACTION TYPE: `add_image_alt_text`, registered since Slice 4.5.B.α but
 * previously INACTIVE (no extractor + no predicate). This lane supplies both, so
 * this is the predicate that activates it. It stays a DIRECTIVE card
 * (generator_kind "deterministic"; the LLM never drafts it - the drafter is
 * deterministic and the drafted text is carried inline in the copy). Only
 * EXISTING pictures are touched; the lane never proposes a NEW image, so N5's
 * new-image gate is not involved.
 *
 * ROUTING: `confidence: "medium"` so real-demand alt-text gaps reach the
 * customer queue (a missing alt on a page Google sends searches to is
 * unambiguous and safe - adding a description never risks deindexing anything,
 * unlike the noindex/canonical directives). impact "low" (an accessibility +
 * Google-Images win, not a ranking mover).
 *
 * DEMAND-RANKED + CAPPED like technical-demand.ts / buried-page.ts. Byte-
 * identical when no page qualifies (empty findings -> []). No em or en dashes.
 */

import type { AltTextGapFinding } from "@/domains/image-seo/classify";
import type { ActionType } from "@/domains/recommendations/action-types";
import { addImageAltTextCopy } from "../customer-copy-templates";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";

export type AddImageAltTextTriggerInput = {
  tenantId: string;
  findings: ReadonlyArray<AltTextGapFinding>;
  signalAt: string;
  maxEmissions?: number;
};

/** How many alt-text cards, at most, per run - highest-demand first. */
export const MAX_ALT_TEXT_EMISSIONS = 8;

const ACTION_TYPE: ActionType = "add_image_alt_text";
const TRIGGER_SIGNAL = "add_image_alt_text";
const TOPIC_CLUSTER_LABEL = "Image alt text";

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
 * @no-classifier-required: consumes pre-classified findings whose page universe
 * was already assembled from owned snapshots in the loader.
 */
export function addImageAltText(
  input: AddImageAltTextTriggerInput,
): RecommendationCandidateRow[] {
  const { tenantId, findings, signalAt } = input;
  const max = input.maxEmissions ?? MAX_ALT_TEXT_EMISSIONS;
  if (findings.length === 0) return [];

  // Highest demand first, then most-missing, then a stable url tiebreak.
  const ranked = [...findings].sort(
    (a, b) =>
      b.impressions90d - a.impressions90d ||
      b.missingCount - a.missingCount ||
      a.url.localeCompare(b.url),
  );

  const out: RecommendationCandidateRow[] = [];
  for (const f of ranked.slice(0, max)) {
    const targetUrl = f.url;
    const firstDraft = f.examples[0]!.draft;
    out.push({
      tenant_id: tenantId,
      trigger_signal: TRIGGER_SIGNAL,
      action_type: ACTION_TYPE,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: TOPIC_CLUSTER_LABEL,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail: f.evidence }],
      confidence: "medium",
      impact_estimate: "low",
      customer_copy: addImageAltTextCopy(
        pathOf(targetUrl),
        f.missingCount,
        firstDraft,
      ),
      operator_evidence:
        "signal=" +
        TRIGGER_SIGNAL +
        "; url=" +
        f.url +
        "; missing=" +
        String(f.missingCount) +
        "/" +
        String(f.totalImages) +
        "; impressions_90d=" +
        String(f.impressions90d) +
        "; play=image_alt_text; " +
        f.evidence,
      dedupe_key: dedupeKey({
        tenantId,
        actionType: ACTION_TYPE,
        targetUrl,
        topicClusterLabel: TOPIC_CLUSTER_LABEL,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType: ACTION_TYPE, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
