import type { SpecificEditEvidenceRef } from "./specific-edit-provider";

const PROMPT_SNIPPET_MAX_CHARS = 50;
const PROMPT_SNIPPET_TRUNCATED_CHARS = 47;

/**
 * Render a single evidence ref as an operator-facing summary string.
 * For `prompt` refs, replaces the raw promptId UUID with a snippet of
 * the prompt text. Returns null when a prompt ref's UUID isn't in the
 * lookup — we hide the chip rather than leak the UUID.
 */
export function summarizeEvidenceRef(
  ref: SpecificEditEvidenceRef,
  promptTextById: Record<string, string> | Map<string, string>,
): string | null {
  if (ref.type === "prompt") {
    const text =
      promptTextById instanceof Map
        ? promptTextById.get(ref.promptId)
        : promptTextById[ref.promptId];
    if (!text) return null;
    const snippet =
      text.length > PROMPT_SNIPPET_MAX_CHARS
        ? `${text.slice(0, PROMPT_SNIPPET_TRUNCATED_CHARS).trim()}…`
        : text;
    return `prompt: "${snippet}"`;
  }
  if (ref.type === "element") return `element:${ref.elementKey}`;
  if (ref.type === "owned_page") return `page:${ref.url}`;
  if (ref.type === "competitor") return `competitor:${ref.competitorName}`;
  if (ref.type === "prior_outcome") return `prior:${ref.actionType}`;
  return null;
}

/**
 * Summarize an array of evidence refs into a single " · "-joined
 * operator-facing string. Drops any refs that resolve to null
 * (e.g. unknown prompt UUIDs).
 */
export function summarizeEvidenceRefs(
  refs: ReadonlyArray<SpecificEditEvidenceRef>,
  promptTextById: Record<string, string> | Map<string, string>,
): string {
  return refs
    .map((r) => summarizeEvidenceRef(r, promptTextById))
    .filter((s): s is string => Boolean(s))
    .join(" · ");
}
