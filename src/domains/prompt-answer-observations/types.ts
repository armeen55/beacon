export type PromptAnswerObservation = {
  id: string;
  prompt_id: string;
  run_id: string;
  answer_hash: string | null;
  position: number | null;
  tracked_brand_mentioned: boolean | null;
  tracked_brand_cited: boolean | null;
  citation_count: number;
  owned_citation_count: number;
  citation_domains: string[];
  citation_categories: Partial<Record<string, number>>;
  mentions: string[];
  observed_at: string;
  platform: string;
  topic: string;
  /**
   * Raw AI-generated search queries (verbatim from Profound export / native
   * engine tool-use traces). One string per observation. Populated for
   * ChatGPT + Claude + Perplexity only; Google AI Overview never exposes
   * this \u2014 accepted blind spot per Phase 7 Part 1b audit (2026-04-19).
   * Preserved lossless so the scanner can re-parse if the split heuristic
   * proves wrong on a specific row.
   */
  raw_search_queries?: string;
  /**
   * Best-effort parsed split of `raw_search_queries`. Empty array when the
   * raw field is empty (all AIO rows, some Perplexity/ChatGPT rows that
   * didn't trigger a web search). See `parseSearchQueries()` in
   * `src/domains/prompt-answer-observations/search-query-parser.ts` for the
   * exact split heuristic (conservative: only splits when parts look like
   * real queries, not competitor-name fragments).
   */
  search_queries?: string[];
  metadata: Record<string, unknown>;
  /** Owning tenant. */
  tenant_id: string;
};
