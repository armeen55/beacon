/**
 * today-questions-rows (2026-06-25) — the AEO answer-block lens: questions people
 * ask Google that the tenant ALREADY appears for (real impressions) but earns few
 * clicks — because no page directly answers them. Adding a concise answer block /
 * FAQ wins the featured snippet and the AI-overview citation. Pure + dependency-free.
 */

export type QuestionQueryInput = { query: string; clicks: number; impressions: number };

export type AnswerOpportunity = {
  query: string;
  impressions: number;
  clicks: number;
  /** clicks / impressions over the window (low = appears but not chosen). */
  ctr: number;
};

const QUESTION_RE = /^(how|what|why|who|whom|whose|when|where|which|is|are|was|were|does|do|did|can|could|should|will)\b/i;

/** A query reads as a question (leading interrogative or a literal "?"). */
export function isQuestion(query: string): boolean {
  const q = (query || "").trim();
  return q.includes("?") || QUESTION_RE.test(q);
}

/**
 * Rank answer-block opportunities: question-shaped queries with real impressions
 * (≥`minImpressions`) and a weak click rate (the answer isn't being captured).
 * Sorted by impressions (biggest unanswered demand first), capped. Deterministic.
 */
export function buildAnswerOpportunities(
  queries: readonly QuestionQueryInput[],
  opts: { minImpressions?: number; maxCtr?: number; cap?: number } = {},
): AnswerOpportunity[] {
  const minImpressions = opts.minImpressions ?? 20;
  const maxCtr = opts.maxCtr ?? 0.02; // ≤2% CTR on a question = no answer captured
  const cap = opts.cap ?? 10;
  const out: AnswerOpportunity[] = [];
  for (const q of queries) {
    if (!q.query || !isQuestion(q.query)) continue;
    if (q.impressions < minImpressions) continue;
    const ctr = q.impressions > 0 ? q.clicks / q.impressions : 0;
    if (ctr > maxCtr) continue; // already answered well enough
    out.push({ query: q.query, impressions: q.impressions, clicks: q.clicks, ctr });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out.slice(0, cap);
}

/** Total impressions across the answer opportunities (the unanswered demand pool). */
export function answerImpressionsAtStake(rows: AnswerOpportunity[]): number {
  return rows.reduce((s, r) => s + r.impressions, 0);
}
