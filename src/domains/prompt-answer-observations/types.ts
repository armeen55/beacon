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
  /**
   * Schema v2 Commit 3 (2026-04-24) — must-have-now extraction fields.
   * Deterministically extracted from answer text + citations (no LLM).
   * All three are nullable: populated by Commit 4's adapter extraction and
   * backfill script. Older rows (pre-Apr-22, Profound-era imports where
   * answer_text isn't stored) stay null forever.
   */
  /**
   * Character offset of the first brand mention in answer_text.
   * Null when the brand is not mentioned. Correlates strongly with
   * recommendation strength — early mention ≠ buried mention.
   */
  mention_position?: number | null;
  /**
   * 1-indexed position of the owned domain in the citations list.
   * Null when the brand is not cited. Profound does not capture this
   * at all — #1-cited vs #8-cited is dramatically different signal.
   */
  citation_rank?: number | null;
  /**
   * Heuristic: brand mentioned AND first mention is in the first 20% of
   * answer text AND brand is one of the first 2 distinct entities by
   * order of appearance. Captures "Beacon is THE answer" vs "also
   * mentioned" — the single most sellable-to-customers signal.
   */
  primary_recommendation?: boolean | null;
};
