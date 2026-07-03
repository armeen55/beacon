/**
 * term-coverage-gap (2026-07-03, BEACON_500 R18 / P7, v1 411) - expand-coverage
 * trigger.
 *
 * THE PLAY: a page that ranks JUST off the top for a money query, where the pages
 * beating it all cover subtopics this page does not. Naming the 3 biggest missing
 * subtopics turns a vague "make it better" into a concrete "add a section on visa
 * fees, processing time, and required documents". The winners' consensus + the
 * real demand-backed sub-questions define the rubric; the page's own stored
 * extracts define what it already covers (both from R11).
 *
 * The pure core (linkgraph/term-coverage.ts) scores coverage + names the missing
 * subtopics; this predicate shapes that grade into an add_h2_section directive.
 * The LOADER supplies the resolved (page, query, position, grade) tuples so this
 * predicate stays a pure reducer (predicate purity invariant).
 *
 * RANKING BAND GATE (the trigger's judgment, not the core's): only fire when the
 * page ranks in the band where coverage is the plausible lever - position in
 * [MIN_POSITION, MAX_POSITION] with real demand. A #1 page needs no lecture; a
 * page ranking 60th has bigger problems than a missing subsection. And coverage
 * must be BELOW the floor (a page already covering most subtopics does not need a
 * card). A grade with no named gaps never fires (nothing concrete to ask for).
 *
 * Never says "coverage score" / "SERP" (lab words) - the copy says plainly the
 * pages beating you all cover these.
 *
 * PURE FUNCTION. No em or en dashes anywhere.
 */

import type { CoverageGrade } from "@/domains/linkgraph/term-coverage";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { termCoverageGapCopy } from "../customer-copy-templates";

export type TermCoverageGapItem = {
  /** The owned page URL to expand. */
  url: string;
  /** The money query the page targets (named in the directive). */
  query: string;
  /** The page's impression-weighted Google position for the query. */
  position: number;
  /** The page's 90-day impressions for the query (demand gate + evidence). */
  impressions: number;
  /** The pre-computed coverage grade (from term-coverage.ts). */
  grade: CoverageGrade;
};

export type TermCoverageGapInput = {
  tenantId: string;
  items: ReadonlyArray<TermCoverageGapItem>;
  signalAt: string;
  maxEmissions?: number;
};

/** Only pages ranking in this band get a coverage directive - relevant enough
 *  that more depth is the plausible lift, not so far back that content is moot. */
export const MIN_POSITION = 5;
export const MAX_POSITION = 15;
/** A page covering at least this share of the rubric already needs no card. */
export const COVERAGE_FLOOR = 0.6;
/** A page needs at least this many 90-day impressions for the query to qualify. */
export const MIN_IMPRESSIONS_90D = 100;
const DEFAULT_MAX_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes pre-graded coverage items whose owned-page
 * set is built from GSC-owned money queries + already-classified page extracts
 * in load-linkgraph-triggers.ts (non-HTML assets never carry GSC query demand
 * nor stored content extracts), so no per-page classification is needed here.
 */
export function termCoverageGap(input: TermCoverageGapInput): RecommendationCandidateRow[] {
  const { tenantId, items, signalAt } = input;
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;
  if (items.length === 0) return [];

  const eligible = items.filter((it) => {
    if (!it.url || !it.query) return false;
    if (it.position < MIN_POSITION || it.position > MAX_POSITION) return false;
    if (it.impressions < MIN_IMPRESSIONS_90D) return false;
    // Rubric must exist and the page must be genuinely under-covering it with at
    // least one concrete gap to name.
    if (it.grade.coverage == null) return false; // unknown rubric - never grade off no data
    if (it.grade.coverage >= COVERAGE_FLOOR) return false;
    if (it.grade.missingTopLabels.length === 0) return false;
    return true;
  });

  // Highest demand first (biggest money), stable url tiebreak.
  eligible.sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url));

  const out: RecommendationCandidateRow[] = [];
  for (const it of eligible.slice(0, max)) {
    const actionType = "add_h2_section" as const;
    const targetUrl = it.url;
    const topicClusterLabel = it.query;
    const coveragePct = Math.round((it.grade.coverage ?? 0) * 100);
    out.push({
      tenant_id: tenantId,
      trigger_signal: "term_coverage_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "term_coverage_gap query=" +
            it.query +
            "; position=" +
            it.position.toFixed(1) +
            "; coverage=" +
            String(it.grade.coveredCount) +
            "/" +
            String(it.grade.expectedCount) +
            " (" +
            coveragePct +
            "%); missing=" +
            it.grade.missingTopLabels.join(" | "),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: termCoverageGapCopy(it.query, it.position, it.grade.missingTopLabels),
      operator_evidence:
        "signal=term_coverage_gap; url=" +
        it.url +
        "; query=" +
        it.query +
        "; position=" +
        it.position.toFixed(1) +
        "; impressions_90d=" +
        String(it.impressions) +
        "; coverage=" +
        coveragePct +
        "%; covered=" +
        String(it.grade.coveredCount) +
        "/" +
        String(it.grade.expectedCount) +
        "; missing=" +
        it.grade.missingAll.map((m) => m.label).slice(0, 8).join(",") +
        "; play=expand_term_coverage",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
