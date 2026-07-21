/**
 * Element-key parsing (CORE 100K Lane D, 2026-07-21).
 *
 * Stable element keys look like `<type>[<index>]:<hash>` (positional),
 * `<type>[new]:<hash>` (additive), or `schema[TypeName]...` (schema).
 * The hash suffix is the pairing identity FAQ bundles use: a
 * `faq_question[new]:<hash>` row must ship with a matching
 * `faq_answer[new]:<hash>` row. This util is the ONE shared home for that
 * suffix extraction; `specific-edit-validator.ts` (bundle pairing gate) and
 * `load-action-row-by-edit.ts` (push-time QA lookup) both consume it.
 *
 * Pure / deterministic. No I/O.
 */

/**
 * Extract the hash suffix from a `<type>[new]:<hash>` element key. Returns
 * null when the key is not additive or has no `:hash` suffix.
 */
export function extractElementKeyHashSuffix(
  elementKey: string | null | undefined,
): string | null {
  if (typeof elementKey !== "string") return null;
  const additive = elementKey.match(/\[new\]:(.+)$/);
  if (additive && additive[1].length > 0) return additive[1];
  const colonIdx = elementKey.indexOf(":");
  if (colonIdx > 0 && colonIdx < elementKey.length - 1) {
    return elementKey.slice(colonIdx + 1);
  }
  return null;
}
