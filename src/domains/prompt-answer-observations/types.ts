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
  /**
   * Schema v2.1 Commit 6 (2026-04-24) — high-value-soon extraction fields.
   * Deterministic; backfilled across Apr-22+ rows and emitted on every new
   * poll. See docs/OBSERVATION_SCHEMA_V2.md.
   */
  /**
   * Up to 10 adjectives/nouns in a ±5-word window around the first brand
   * mention. Proxy for how AI positions the brand: "luxury", "affordable",
   * "award-winning". Empty when brand not mentioned.
   */
  descriptor_window?: string[] | null;
  /**
   * Canonical names of tracked non-owned entities mentioned in this
   * answer, in order of first appearance. Empty when no competitor was
   * mentioned alongside the brand.
   */
  competitor_co_mentions?: string[] | null;
  /**
   * W2 Step 2.1 (master plan, 2026-05-01) — descriptor windows AROUND
   * each competitor mention. Keyed by canonical competitor name (entity
   * name, not alias). Each value is up to 10 adjective/noun-like tokens
   * in a ±5-word window around the competitor's first-appearance
   * position. Powers the right column of "How AI described you" v2 so
   * the comparison view shows real competitor descriptors, not just
   * descriptors that happen to fall near the brand.
   *
   * `null` on rows from before this field shipped (existing native
   * observations + W4 historical_recovered rows that haven't been
   * re-extracted yet). Empty `{}` when answer text exists but no
   * competitors appeared.
   */
  competitor_descriptor_windows?: Record<string, string[]> | null;
  /**
   * Per-citation class, parallel to `citation_domains` (same length, same
   * index). Values from CitationDomainClass. Empty when the answer has no
   * citations.
   */
  citation_domain_classes?: string[] | null;
  /**
   * Shape of the answer. Values from AnswerStructure. Null when answer
   * text is empty.
   */
  answer_structure?: string | null;
  /**
   * Schema v2.2 Commit 7 (2026-04-24) — full URLs of citations in order.
   * Parallel to `citation_domains` (same length, same index). `citation_urls[i]`
   * is the authoritative URL of the i-th citation in the LLM response;
   * `citation_domains[i]` is the (deduped) host. Needed for native per-URL
   * citation history (url-citation-history.ts), which matches citation
   * URLs against owned-site URL paths.
   *
   * Null on pre-Commit-7 rows: raw URLs weren't stored at poll time, so
   * domain-level analysis is the only native signal available for those.
   * Re-polling would recover them but is not worth the API spend.
   */
  citation_urls?: string[] | null;
};

/** Citation domain classes emitted by classifyCitationDomains. */
export type CitationDomainClass =
  | "owned"
  | "competitor"
  | "directory"
  | "news"
  | "review"
  | "social"
  | "other";

/** Answer structure enum values emitted by extractAnswerStructure. */
export type AnswerStructure =
  | "ranked_list"
  | "bullet_list"
  | "narrative"
  | "comparison"
  | "mixed";
