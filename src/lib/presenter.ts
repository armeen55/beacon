/** lib/presenter - the ONE place a machine name becomes a customer word. Two surfaces each carried a private
 *  engine-label map while producer copy shipped raw slugs ("chatgpt, gemini") and raw ISO dates into cards
 *  (Codex, 2026-08-21). Every surface and every producer that writes customer-facing words imports THIS. */

const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude", google: "Google" };

/** "chatgpt" -> "ChatGPT"; an unknown instrument is named honestly, never echoed as a slug. */
export const engineLabel = (raw: string): string => ENGINE_LABEL[(raw || "").toLowerCase()] ?? "An AI assistant";

/** A list of instruments as a customer reads it: "ChatGPT, Gemini". */
export const engineList = (raws: readonly string[]): string => raws.map(engineLabel).join(", ");

/** A day in the operator's words ("Aug 17"). A bare YYYY-MM-DD is a finalized day read in UTC, so the day
 *  named is the day the data actually ends on. Null in, null out; a surface decides its own fallback. */
export function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
