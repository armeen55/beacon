/**
 * Pure extractors for observation schema v2 (Commit 4, 2026-04-24).
 *
 * Three deterministic functions compute must-have-now structured fields
 * from an answer text + entity list + citation domains. Called from both
 * the Perplexity adapter (src/adapters/perplexity/poll.ts) and the OpenAI
 * adapter (which wraps Perplexity), and also from the backfill script
 * (scripts/backfill-observation-extraction.ts) over existing Apr-22+ rows
 * where answer_texts is available.
 *
 * Design constraints:
 *   - Deterministic (same inputs → same outputs). No LLM, no randomness.
 *   - Pure. No I/O. No side effects. All inputs passed in.
 *   - Null-safe. Empty text → null / false; brand absent → null / false.
 *   - Case-insensitive matching. All matching lower-cases both sides.
 *   - Idempotent. Backfill can re-run over the same row without churn.
 *
 * Why these three specifically: see docs/OBSERVATION_SCHEMA_V2.md.
 */

export type EntityForOrdering = {
  name: string;
  aliases?: string[];
};

/**
 * Character offset of the first case-insensitive match of any brand variant
 * (name or alias) in answer_text. Returns null when the brand isn't
 * mentioned or when the text is empty.
 *
 * Takes the earliest match across all variants so `["Ritz Builders", "Ritz"]`
 * resolves to the position of whichever appeared first — the "Ritz" in
 * "Ritz was founded" is caught even if "Ritz Builders" appears later.
 */
export function extractMentionPosition(
  answerText: string,
  brandVariants: string[],
): number | null {
  if (!answerText) return null;
  const lower = answerText.toLowerCase();
  let earliest: number | null = null;
  for (const variant of brandVariants) {
    if (!variant) continue;
    const v = variant.toLowerCase();
    const idx = lower.indexOf(v);
    if (idx < 0) continue;
    if (earliest === null || idx < earliest) earliest = idx;
  }
  return earliest;
}

/**
 * 1-indexed position of the first owned domain in the citations list.
 * Returns null when the brand isn't cited.
 *
 * `citationDomains` is expected lowercased (the adapter stores them that
 * way). `ownedDomains` should also be lowercased.
 */
export function extractCitationRank(
  citationDomains: string[],
  ownedDomains: Set<string>,
): number | null {
  if (citationDomains.length === 0 || ownedDomains.size === 0) return null;
  for (let i = 0; i < citationDomains.length; i++) {
    const d = citationDomains[i];
    if (!d) continue;
    if (ownedDomains.has(d.toLowerCase())) return i + 1;
  }
  return null;
}

/**
 * Returns entity canonical names in order of first appearance in answer_text
 * (earliest first). Entities with no match are omitted. Entity ordering is
 * by its earliest variant-match position (name or alias, whichever appears
 * first).
 *
 * Used to check "is brand in top-2 entities by order of appearance" for
 * `extractPrimaryRecommendation`.
 */
export function rankEntitiesByFirstAppearance(
  answerText: string,
  entities: EntityForOrdering[],
  maxN: number = 10,
): string[] {
  if (!answerText || entities.length === 0) return [];
  const lower = answerText.toLowerCase();
  const firstPos = new Map<string, number>();
  for (const entity of entities) {
    if (!entity.name) continue;
    const variants: string[] = [entity.name];
    if (entity.aliases) {
      for (const a of entity.aliases) {
        if (a) variants.push(a);
      }
    }
    let earliest: number | null = null;
    for (const variant of variants) {
      const idx = lower.indexOf(variant.toLowerCase());
      if (idx < 0) continue;
      if (earliest === null || idx < earliest) earliest = idx;
    }
    if (earliest !== null) firstPos.set(entity.name, earliest);
  }
  return [...firstPos.entries()]
    .sort(([, a], [, b]) => a - b)
    .slice(0, maxN)
    .map(([name]) => name);
}

/**
 * Heuristic: is the brand the "primary recommendation" in the answer?
 *
 * Conditions (all must hold):
 *  1. Brand is mentioned at all (`brandPosition` non-null).
 *  2. First brand mention is in the first 20% of the answer text
 *     (early enough to be a lead recommendation vs buried in a list).
 *  3. Brand is one of the first 2 distinct entities by order of appearance
 *     (i.e. the answer leads with the brand or mentions one other entity
 *     before the brand, not three or more).
 *
 * Returns false when any condition fails. False when answer is empty.
 */
export function extractPrimaryRecommendation(
  answerText: string,
  brandPosition: number | null,
  entitiesInOrder: string[],
  brandName: string,
  thresholdRatio: number = 0.2,
): boolean {
  if (brandPosition === null) return false;
  if (!answerText) return false;
  if (!brandName) return false;

  // Condition 2: early in text.
  const earlyCutoff = Math.max(1, answerText.length * thresholdRatio);
  const isEarly = brandPosition < earlyCutoff;
  if (!isEarly) return false;

  // Condition 3: brand in top-2 entities by order of appearance.
  const topTwo = entitiesInOrder.slice(0, 2);
  const inTopTwo = topTwo.includes(brandName);
  return inTopTwo;
}
