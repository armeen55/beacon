/**
 * ProfoundAnswerRow — the pure row shape for one AI-answer record.
 *
 * This is a plain data type with NO API connection. It survives the removal of
 * the live Profound client (2026-07-20 full-disconnect): the cached readers
 * (profound-coverage/load-cached, profound-question-intelligence) reconstruct
 * these rows from OUR OWN durable Supabase tables (profound_answer_rows), never
 * from any live account call. Kept in its own module so those cached-evidence
 * surfaces have a stable home for the shape without importing a connector client.
 */

export type ProfoundAnswerRow = {
  promptId: string | null;
  prompt: string;
  response: string;
  /** Entity/brand names the answer mentioned. */
  mentions: string[];
  /** Full URLs the answer cited. */
  citationUrls: string[];
  /** Hostnames derived from `citationUrls` (www-stripped). */
  citationHostnames: string[];
  /** Theme tags for this answer (may be empty). */
  themes: string[];
  topic: string | null;
  model: string | null;
  /** The tracked asset this answer is about (when applicable). */
  asset: string | null;
  createdAt: string | null;
};
