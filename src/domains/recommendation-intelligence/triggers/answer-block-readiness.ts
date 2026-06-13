/**
 * AEO answer-block readiness slice (2026-06-12 night shift) — trigger
 * predicate: `missing_answer_block`. The Iranopedia superpower: their
 * pages are literally question-shaped ("What is Chaharshanbe Suri",
 * "Cities in Iran") — the single highest-leverage AEO move on such a
 * page is a concise, self-contained direct answer near the top, in
 * snippet length, so answer engines can lift it verbatim.
 *
 * THE PLAY (sourced; commit carries the ≥4-source digest):
 *   • GEO study (Aggarwal et al., KDD 2024): adding quotable,
 *     self-contained statements is among the strongest measured
 *     generative-visibility levers.
 *   • Google featured-snippet length convention: a direct answer of
 *     ~40-60 words / 2-3 sentences is the extractable sweet spot.
 *   • Answer-first ("inverted pyramid") placement is Google's own
 *     people-first content guidance.
 *   • FAQPage rich results were deprecated for most sites (Google,
 *     2023) — so the recommendation is an INLINE early answer block,
 *     not an FAQ schema dependency.
 *
 * Firing (deterministic, conservative — low false-positive):
 *   The page must have a QUESTION-shaped demand signal AND lack any
 *   early structured answer:
 *     • demand: a top GSC query is question-shaped with ≥ the
 *       impressions floor (first-party, strongest) OR the page's
 *       title/H1 is itself question-shaped (crawl-only fallback, so
 *       it fires before GSC is connected);
 *     • gap: the page has NO FAQ structure (faqs empty AND no FAQ
 *       schema block) AND no question-shaped H2 (no existing
 *       Q→A scaffold).
 *   Merely-definitional titles ("X Rug: Motifs…") do NOT fire — only
 *   genuinely question-shaped demand — so an encyclopedia isn't
 *   flooded. One emission per page (the worst/strongest question).
 *
 * Emits `add_answer_block` at OPERATOR-REVIEW with a DIRECTIVE draft:
 * it names the exact question + the sourced answer-length guidance
 * but NEVER writes the answer (that's the owner's factual authority;
 * fabricating cultural/historical facts is a hard rail).
 *
 * PURE FUNCTION — pinned by `recommendation-trigger-predicates-purity`
 * + `recommendation-triggers-page-classifier-applied`.
 */

import type { PageSnapshot } from "@/domains/pages/types";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { answerBlockReadinessCopy } from "../customer-copy-templates";
import { isNonHtmlAsset } from "../page-classifier";
import type { GscPageSignal } from "../gsc-page-signals";

export type AnswerBlockReadinessInput = {
  tenantId: string;
  snapshot: PageSnapshot;
  /** Pre-loaded 28-day GSC signal, or undefined when GSC isn't
   *  connected (the title/H1 fallback still fires). */
  signal: GscPageSignal | undefined;
};

/** First-party question queries need a real impressions floor (28d)
 *  to be worth a card — mirrors the striking-distance noise floor. */
const MIN_QUESTION_IMPRESSIONS_28D = 100;

/** Interrogative openers + the question mark. Lowercased word-boundary
 *  match. Deliberately English-keyworded: the SIGNAL (does this page
 *  answer a question?) is language-general, but v1 detects the
 *  English interrogatives present in the tenant's own
 *  titles/queries — extend per-locale when non-English query data
 *  lands (no guessed foreign lists). */
const QUESTION_OPENERS = [
  "what", "what's", "whats", "how", "why", "who", "whose", "when",
  "where", "which", "is", "are", "was", "were", "does", "do", "did",
  "can", "should", "will", "list of",
];

export function isQuestionShaped(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (t.length === 0) return false;
  if (t.includes("?")) return true;
  for (const opener of QUESTION_OPENERS) {
    if (t === opener) continue;
    if (t.startsWith(opener + " ")) return true;
  }
  return false;
}

/** The page already scaffolds Q→A and so doesn't need this card:
 *  an FAQ list, an FAQ schema block, or a question-shaped H2. */
export function hasEarlyAnswerScaffold(snap: PageSnapshot): boolean {
  if (Array.isArray(snap.faqs) && snap.faqs.length > 0) return true;
  if ((snap.faq_schema_block_count ?? 0) > 0) return true;
  if (
    Array.isArray(snap.h2_list) &&
    snap.h2_list.some((h) => isQuestionShaped(h))
  ) {
    return true;
  }
  return false;
}

/** The strongest question demand for the page, or null. First-party
 *  GSC question query (by impressions) wins; else a question-shaped
 *  title/H1. */
export function strongestQuestion(
  snapshot: PageSnapshot,
  signal: GscPageSignal | undefined,
): { question: string; source: "gsc_query" | "title" } | null {
  if (signal != null) {
    const q = signal.topQueries
      .filter(
        (x) =>
          x.impressions >= MIN_QUESTION_IMPRESSIONS_28D &&
          isQuestionShaped(x.query),
      )
      .sort((a, b) => b.impressions - a.impressions)[0];
    if (q != null) return { question: q.query, source: "gsc_query" };
  }
  const title = snapshot.title?.trim() || snapshot.h1?.trim() || "";
  if (isQuestionShaped(title)) return { question: title, source: "title" };
  return null;
}

export function answerBlockReadiness(
  input: AnswerBlockReadinessInput,
): RecommendationCandidateRow[] {
  const { tenantId, snapshot, signal } = input;
  if (isNonHtmlAsset(snapshot.url)) return [];
  if (snapshot.http_status >= 400) return [];
  if (hasEarlyAnswerScaffold(snapshot)) return [];

  const demand = strongestQuestion(snapshot, signal);
  if (demand == null) return [];

  const actionType = "add_answer_block" as const;
  const targetUrl = snapshot.url;
  const topicClusterLabel = demand.question;

  const detail =
    demand.source === "gsc_query"
      ? "answer_block_readiness question=" +
        demand.question +
        "; source=gsc_query; no_faq=true; no_question_h2=true"
      : "answer_block_readiness question=" +
        demand.question +
        "; source=title; no_faq=true; no_question_h2=true";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "missing_answer_block",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [{ kind: "page_snapshot", ref: targetUrl, detail }],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: answerBlockReadinessCopy(demand.question),
      operator_evidence:
        "signal=missing_answer_block; question=" +
        demand.question +
        "; demand_source=" +
        demand.source +
        "; has_faq=false; has_question_h2=false; play=add_early_direct_answer_block",
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: snapshot.fetched_at,
      safety_flags: [],
    },
  ];
}
