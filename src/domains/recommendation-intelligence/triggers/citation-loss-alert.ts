/**
 * Citation loss alert trigger (BEACON 500 item 83, 2026-07-02) - predicate
 * `citation_loss_alert`.
 *
 * THE GAP: `citation-loss.ts` (src/domains/ai-visibility) diffs the nightly-
 * ish Profound citation stream (`profound_answer_rows`) week over week and
 * finds prompts where the tenant's OWN page used to be cited in the AI's
 * answer and now is not - naming the competitor domain that took the slot
 * and, when available, a headline fact from that competing answer. This
 * predicate is a thin, PURE wrapper that turns each already-computed
 * `CitationLossFinding` into a `RecommendationCandidateRow` - it does no
 * window math and no Supabase read itself (that lives in citation-loss.ts;
 * the trigger-predicate purity invariant forbids I/O here).
 *
 * COVERAGE LOSS IS NEVER EMITTED HERE: `CoverageLossFinding` (the prompt
 * simply stopped being polled - a data gap, not a lost citation) is filtered
 * out before this predicate ever sees it (the loader only passes citation
 * losses in). Firing a recommendation off a polling gap would tell the owner
 * to "win back" something we never actually confirmed they lost.
 *
 * DEDUPE VS sov_drop_alert (BEACON 500 item 79): both streams can name a
 * "you used to be cited/mentioned on X, now you're not" story for the SAME
 * topic in the SAME week - sov_drop_alert from the native 4-engine poll
 * (`prompt_answer_observations`), this one from the imported Profound
 * citation stream (`profound_answer_rows`). Two cards saying the same thing
 * from two pipelines would look like a bug, not two signals. This predicate
 * takes the current week's `sov_drop_alert` topics as a pure input and skips
 * (with a code-visible reason) any citation loss whose (topic, ISO week)
 * matches one already covered - the native-poll alert wins because it has a
 * larger, better-calibrated floor (MIN_PROMPTS_PER_CELL in sov-weekly.ts);
 * this predicate only fills the gap Profound's citation data sees that the
 * native poll does not yet have history for.
 *
 * ACTION: `add_answer_block`, same non-pushable DIRECTIVE action as
 * profound-aeo-gap.ts / sov-drop-alert.ts - Beacon never fabricates the
 * factual claim, the owner writes the real answer. Anchored on the site root
 * (topic-level signal from a prompt/topic diff, not a single crawled page,
 * same anchoring convention as the other two Profound/native-poll triggers).
 *
 * ONE emission per citation loss, ranked by how many times the prompt was
 * cited before (biggest loss first), capped so a bad week does not flood the
 * plan.
 *
 * PURE FUNCTION over pre-loaded findings + the current week's sov-drop-alert
 * topics. Pinned by `recommendation-trigger-predicates-purity`.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { citationLossCopy } from "../customer-copy-templates";
import type { CitationLossFinding } from "@/domains/ai-visibility/citation-loss";
import { isoWeekKey, type SovDropAlert } from "@/domains/ai-visibility/sov-weekly";

export type CitationLossAlertInput = {
  tenantId: string;
  /** Pre-computed citation losses from citation-loss.ts (empty when nothing
   *  qualified, or the sync has no history yet). Coverage losses must be
   *  filtered out by the caller before this predicate runs - this input type
   *  only accepts the `citation_loss` kind. */
  findings: ReadonlyArray<CitationLossFinding>;
  /** This week's already-fired sov_drop_alert alerts (from sov-weekly.ts),
   *  used ONLY to dedupe - never re-scored here. Empty when the native poll
   *  has no drop this week (or no history at all). */
  sovDropAlertsThisWeek: ReadonlyArray<SovDropAlert>;
  /** Site-root URL to anchor the card on, same convention as
   *  profound-aeo-gap.ts / sov-drop-alert.ts. Null when no configured
   *  domain - the predicate then abstains (queue rules require a URL for
   *  this on-site action). */
  siteRootUrl: string | null;
  /** ISO timestamp the findings were computed at (created_from_signal_at). */
  signalAt: string;
  /** Cap on how many findings feed the candidate builder per run, mirroring
   *  sov-drop-alert's DEFAULT_MAX_CANDIDATES. Defaults to 3. */
  maxCandidates?: number;
};

const DEFAULT_MAX_CANDIDATES = 3;

/** Loose topic match for dedupe purposes only: lowercase + trim + collapse
 *  whitespace. Both topics come from the SAME humanizer family (promptToTopic
 *  in sov-weekly.ts and citation-loss.ts are independently-derived but
 *  textually similar for the same prompt), so an exact normalized match is
 *  the conservative choice - a near-miss simply means both cards fire, which
 *  is safe (queue-level dedupe still collapses identical dedupe_keys); we
 *  only need to catch the common exact-topic case here. */
function normTopic(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * @no-classifier-required: topic-level Profound citation diff, not
 * page-scoped. The unit is a (prompt, topic) citation loss, not a crawled
 * page, so emission anchors to the always-HTML site root; neither
 * `classifyPageType` nor `isNonHtmlAsset` applies. (Sanctioned opt-out per
 * the page-classifier architecture invariant, same opt-out profound-aeo-gap.ts
 * / sov-drop-alert.ts use.)
 */
export function citationLossAlert(input: CitationLossAlertInput): RecommendationCandidateRow[] {
  const { tenantId, findings, sovDropAlertsThisWeek, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  if (findings.length === 0) return [];

  // Dedupe vs sov_drop_alert: skip any citation loss whose topic matches an
  // sov_drop_alert topic already fired THIS week (same signalAt week) - the
  // native-poll alert already tells this story with a better-calibrated
  // floor. Comment-visible per the item's dedupe requirement.
  const currentWeekKey = isoWeekKey(signalAt);
  const sovTopicsThisWeek = new Set(
    sovDropAlertsThisWeek.filter((a) => a.weekKey === currentWeekKey).map((a) => normTopic(a.topic)),
  );

  const eligible = findings.filter((f) => !sovTopicsThisWeek.has(normTopic(f.topic)));
  const skippedForSovOverlap = findings.length - eligible.length;
  // (skippedForSovOverlap is intentionally unread beyond this point - it
  // exists so a future operator diagnostic can surface "N citation losses
  // were skipped, already covered by sov_drop_alert this week" without
  // re-deriving the dedupe set. See the module docstring for the full
  // rationale.)
  void skippedForSovOverlap;

  if (eligible.length === 0) return [];

  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  // Worst loss first (most prior citations lost).
  const ranked = [...eligible].sort((a, b) => b.priorCitationCount - a.priorCitationCount).slice(0, maxCandidates);

  const actionType = "add_answer_block" as const;
  const targetUrl = siteRootUrl;

  return ranked.map((finding) => {
    const engineName = finding.priorCitingModels[0] ?? finding.recentAnsweringModels[0] ?? "An AI engine";
    // The (topic, prompt) pair is the dedupe anchor - a different prompt or a
    // re-run against a changed prompt set produces a fresh candidate; a
    // re-run against the same still-losing prompt collapses onto one row.
    const topicClusterLabel = `citation_loss:${finding.topic}:${finding.prompt}`;

    return {
      tenant_id: tenantId,
      trigger_signal: "citation_loss_alert",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "prompt_answer_observation",
          ref: `citation_loss:${finding.prompt}`,
          detail:
            "citation_loss_alert prompt=" +
            finding.prompt +
            "; topic=" +
            finding.topic +
            "; prior_citing_models=" +
            finding.priorCitingModels.join(",") +
            "; prior_citation_count=" +
            String(finding.priorCitationCount) +
            "; recent_answering_models=" +
            finding.recentAnsweringModels.join(",") +
            "; competitor_domain=" +
            (finding.competitor.domain ?? "none") +
            "; competitor_citing_answer_count=" +
            String(finding.competitor.citingAnswerCount) +
            "; headline_fact_model=" +
            (finding.headlineFact?.model ?? "none"),
        },
      ],
      confidence: "medium",
      impact_estimate: finding.priorCitationCount >= 5 ? "high" : "medium",
      customer_copy: citationLossCopy(
        engineName,
        finding.prompt,
        finding.competitor.domain,
        finding.headlineFact?.fact ?? null,
        finding.priorCitationCount,
      ),
      operator_evidence:
        "signal=citation_loss_alert; prompt=" +
        finding.prompt +
        "; was cited " +
        String(finding.priorCitationCount) +
        " time(s) by " +
        (finding.priorCitingModels.join(", ") || "unknown model(s)") +
        ", now cited by none of " +
        (finding.recentAnsweringModels.join(", ") || "the recent answers"),
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
