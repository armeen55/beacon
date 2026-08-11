/**
 * llm/de-templating (2026-07-03, BEACON 500 R16 / P6) - the "reads like a repeat" guard on generated customer-facing text.
 *
 * A drafter that keeps producing the same skeleton ("X is a traditional Persian ... The page covers ...") across pages is templating, not writing.
 * This pure check compares a new draft's word 3-grams against the last outputs cached for the same lever family; above REPEAT_THRESHOLD overlap
 * the gateway retries once with a variation instruction, and if the retry is still a near-copy the draft ships FLAGGED ("reads like a repeat") so the
 * draft-quality gate can demote it instead of calling it ready.
 *
 * Deterministic, PURE - no I/O. Pinned by de-templating.test.ts.
 */

const REPEAT_THRESHOLD = 0.7;

/** How many recent same-family outputs the gateway compares against. */
export const REPEAT_HISTORY_SIZE = 20;

/** The operator-facing flag text (Beacon voice, no jargon). */
export const REPEAT_FLAG = "reads like a repeat";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Word n-gram set (default 3-grams). Short texts fall back to smaller grams. */
function ngramSet(text: string, n = 3): Set<string> {
  const ws = words(text);
  const size = Math.min(n, Math.max(1, ws.length));
  const out = new Set<string>();
  for (let i = 0; i + size <= ws.length; i += 1) {
    out.add(ws.slice(i, i + size).join(" "));
  }
  return out;
}

/**
 * Containment overlap: what share of the NEW text's n-grams already appear in the prior text. 0 when either side is empty.
 */
function ngramOverlap(next: string, prior: string, n = 3): number {
  const a = ngramSet(next, n);
  if (a.size === 0) return 0;
  const b = ngramSet(prior, n);
  if (b.size === 0) return 0;
  let hits = 0;
  for (const g of a) if (b.has(g)) hits += 1;
  return hits / a.size;
}

/** Highest overlap of `text` against any of the recent same-family outputs. */
function repeatSimilarity(text: string, priors: ReadonlyArray<string>, n = 3): number {
  let max = 0;
  for (const p of priors.slice(0, REPEAT_HISTORY_SIZE)) {
    const s = ngramOverlap(text, p, n);
    if (s > max) max = s;
    if (max >= 1) break;
  }
  return max;
}

/** True when the text reads like a repeat of a recent same-family output. */
export function looksTemplated(
  text: string,
  priors: ReadonlyArray<string>,
  threshold = REPEAT_THRESHOLD,
): boolean {
  if (priors.length === 0 || text.trim().length === 0) return false;
  return repeatSimilarity(text, priors) > threshold;
}

/** The retry instruction the gateway appends when the first attempt templated. */
export const VARIATION_INSTRUCTION =
  "Your previous draft repeated the structure and phrasing of recent drafts for other pages. " +
  "Write this one differently: vary the opening, sentence structure, and rhythm so it reads as " +
  "written for THIS page specifically. Keep every grounding rule.";
