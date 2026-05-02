/**
 * W2 Step 2.3 (master plan) — plain-English label maps for operator UI.
 *
 * Replaces the older `s.structure.replace(/_/g, " ")` enum-leak path
 * (audit-flagged: "ranked list", "qa format" lower-case were leaking).
 * The data layer keeps internal enum keys; UI ALWAYS goes through this
 * lookup so a future enum addition surfaces as a typecheck failure on
 * the architecture invariant rather than a silent enum leak in copy.
 */

import type { AnswerStructure } from "@/domains/prompt-answer-observations/types";

/** Maps internal `answer_structure` enum values to operator-facing copy. */
export const STRUCTURE_LABEL: Record<AnswerStructure | string, string> = {
  ranked_list: "Ranked list",
  bullet_list: "Bullet points",
  narrative: "Story",
  comparison: "Side-by-side comparison",
  qa_format: "Q&A",
  mixed: "Mixed format",
};

/**
 * Operator-facing label for an answer-structure key. Falls back to a
 * humanized form (Title-cased + underscore-stripped) so an unmapped
 * enum value never renders as raw `qa_format` while still surfacing
 * loudly enough to notice.
 */
export function structureLabel(key: string): string {
  const direct = STRUCTURE_LABEL[key];
  if (direct) return direct;
  return key
    .split(/[_-]/)
    .filter((s) => s.length > 0)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}

/** Maps internal platform enum values to operator-facing copy. */
export const PLATFORM_LABEL: Record<string, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  google_aio: "Google AI",
  claude: "Claude",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}
