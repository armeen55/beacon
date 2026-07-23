/**
 * Pure platform-name canonicalization — client-safe (no server-only).
 *
 * Extracted from `poll-health.ts` so client components (Today v2
 * visibility chart, leaderboard) can reuse the same active-provider
 * predicate without dragging the server-only Supabase admin client
 * into the browser bundle.
 *
 * `poll-health.ts` re-exports these so existing imports stay
 * unchanged — this module is just the new canonical home for the
 * pure logic.
 */

export type PollPlatform = "perplexity" | "chatgpt";

/**
 * Canonicalize a raw platform string to one of the poll-platform keys.
 *
 * Returns "unknown" for anything we don't recognize so callers can
 * filter / ignore historical-only platforms (e.g. "Google AI
 * Overviews", which is never polled natively).
 *
 * Accepts mixed casing — observation rows store lowercase native-poll
 * labels (`chatgpt`, `perplexity`), older Profound-recovered rows
 * carry TitleCase (`ChatGPT`, `Perplexity`), and the `NativePollPlatform`
 * enum uses `openai` for ChatGPT.
 */
export function canonicalizePollPlatform(
  raw: string | null | undefined,
): PollPlatform | "unknown" {
  if (!raw) return "unknown";
  const lower = raw.trim().toLowerCase();
  if (lower === "chatgpt" || lower === "openai") return "chatgpt";
  if (lower === "perplexity") return "perplexity";
  return "unknown";
}
