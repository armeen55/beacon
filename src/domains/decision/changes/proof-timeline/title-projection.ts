/**
 * /changes v2 — customer-facing title + description projection.
 *
 * Polish bundle (2026-05-11) — hosted visual review found the v2
 * timeline + brief were still rendering raw `change_description`
 * verbatim, which leaked operator vocabulary into the customer UI:
 *
 *   • Prompt UUIDs like `prompt 319557d1` (Beacon's internal
 *     short-id form for `tracked_prompts.id`).
 *   • Internal "packet" vocabulary ("the packet's cited source
 *     pages", "the packet shows", etc.) — `packet` is an internal
 *     name for the per-recommendation evidence bundle.
 *   • Long parenthetical example lists ("examples:
 *     hdrremodeling.com, baysidebuildersgroup.com") that made
 *     titles unreadable.
 *
 * This module is a PROJECTION layer. The stored
 * `change_description` is never mutated; v2 surfaces consume the
 * projected forms while the legacy table continues to render the
 * raw text verbatim. Pure module — no I/O, no DOM, no React.
 *
 * Customer-vocabulary contract:
 *   • `prompt <8+ hex>` is stripped or replaced with "a tracked AI
 *     prompt".
 *   • "the packet's cited source pages" / "the packet's cited
 *     pages" / "the packet shows" all map to plain English
 *     ("examples Beacon tracked" / "Beacon's prompt data shows").
 *   • Long parenthetical example lists are dropped from short
 *     titles and kept (cleaned) in the full description.
 *   • Whitespace is normalized so projection output never carries
 *     awkward double spaces or trailing/leading punctuation.
 */

type ProjectedChangeTitle = {
  /** Short, customer-friendly title for cards + brief header.
   *  Derived by taking the segment before the em-dash separator
   *  when one exists, then scrubbing. */
  shortTitle: string;
  /** Full description for Act 1 of the brief. Same scrubbing
   *  applied; may include the segment after the em-dash when the
   *  raw description carried one. `null` when the full
   *  description is identical to the short title (avoid the
   *  duplicate-render bug the audit flagged). */
  fullDescription: string | null;
};

/**
 * Project a raw `change_description` into a customer-safe pair.
 *
 * Pure — given the same input, returns the same output. Safe to
 * call on every render.
 */
export function projectChangeTitle(
  raw: string | null | undefined,
): ProjectedChangeTitle {
  const cleaned = scrub(raw ?? "");
  if (!cleaned) {
    return { shortTitle: "Untitled change", fullDescription: null };
  }

  // Many accepted-rec rows follow the shape:
  //   "<HEADLINE> — <FULL EXPLANATION>"
  // The em-dash (U+2014) separator is stable in stored data
  // because the generator builds it server-side. Detect either an
  // em-dash or a double-hyphen as a defensive fallback for older
  // imports.
  const dashRegex = /\s+(?:—|--)\s+/;
  const match = cleaned.match(dashRegex);

  if (match && match.index !== undefined) {
    const head = cleaned.slice(0, match.index).trim();
    const tail = cleaned.slice(match.index + match[0].length).trim();
    // Keep the head as the short title; tail becomes the full
    // description ONLY when it adds information beyond the head.
    if (head && tail && head !== tail) {
      return {
        shortTitle: head,
        fullDescription: tail,
      };
    }
    if (head) {
      return { shortTitle: head, fullDescription: null };
    }
  }

  // No separator → the whole thing is the title. Don't render the
  // same text again as the full description.
  return {
    shortTitle: cleaned,
    fullDescription: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scrub pipeline
// ─────────────────────────────────────────────────────────────────────

/**
 * Replace internal prompt-id mentions, packet vocabulary, and
 * leftover parenthetical example lists. Always returns trimmed,
 * normalized whitespace.
 */
function scrub(input: string): string {
  let out = input;

  // 1. Strip prompt IDs in any of the shapes the generator emits.
  //    Examples:
  //      "in prompt 319557d1"  → "in a tracked AI prompt"
  //      "from prompt 7ee3216b" → "from a tracked AI prompt"
  //      "tied to prompt abc12345 and ..." → "tied to a tracked AI prompt and ..."
  out = out.replace(
    /\bprompt\s+[0-9a-f]{6,}\b/gi,
    "a tracked AI prompt",
  );

  // 2. Internal "packet" vocabulary. Order matters — match
  //    multi-word phrases before the bare "packet" so we don't
  //    leave dangling fragments.
  out = out.replace(
    /\bthe\s+packet['’]s\s+cited\s+source\s+pages\b/gi,
    "examples Beacon tracked",
  );
  out = out.replace(
    /\bthe\s+packet['’]s\s+cited\s+pages\b/gi,
    "examples Beacon tracked",
  );
  out = out.replace(
    /\bthe\s+packet\s+shows\b/gi,
    "Beacon's prompt data shows",
  );
  out = out.replace(
    /\bthe\s+packet['’]s?\b/gi,
    "Beacon's prompt data",
  );

  // 3. Drop long inline example lists. Two shapes:
  //    "(examples: a.com, b.com, c.com)"
  //    "(e.g., a.com, b.com)"
  //    Keep tight — only drop the parenthetical, not the
  //    surrounding sentence.
  out = out.replace(/\s*\(\s*(?:examples?|e\.g\.)\s*[:,][^()]*\)/gi, "");

  // 4. Normalize whitespace + tidy stray punctuation introduced
  //    by the replacements above.
  out = out.replace(/\s+/g, " ");
  out = out.replace(/\s+([.,;:])/g, "$1");
  out = out.replace(/\(\s*\)/g, "");
  out = out.trim();

  return out;
}

/**
 * Maximum visible length for a v2 short title. The card layout
 * caps to two lines via CSS, but truncating at this length keeps
 * the title readable even when the source description is
 * pathologically long. Callers can override.
 */
const DEFAULT_SHORT_TITLE_MAX = 140;

/**
 * Clamp a short title to a visual length, adding an ellipsis when
 * truncation occurs. Pure — safe in render paths.
 */
export function clampShortTitle(
  title: string,
  max: number = DEFAULT_SHORT_TITLE_MAX,
): string {
  if (title.length <= max) return title;
  // Try to cut on a word boundary so we don't slice mid-word.
  const slice = title.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}
