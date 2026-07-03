/**
 * rank-distribution (BEACON_500 R23 P19, v1 item 489, 2026-07-03) - a
 * deterministic, honest read of WHERE the tenant ranks across its tracked
 * queries: how many sit in the top 3, how many in striking distance (4 to 10),
 * and how many on page two and beyond (11+).
 *
 * This is a pure summary over already-persisted Search Console query signals - no
 * new read, no paid call. It exists so a surface can show one honest distribution
 * line ("Of 214 searches you show up for, 38 are in the top 3, 71 are in
 * striking distance, 105 are on page two or beyond") instead of a single average
 * position that hides the shape.
 *
 * PURE, no I/O. The caller loads the tenant's query signals (Search Console) and
 * passes { position } rows in.
 *
 * HONESTY RULE: with no tracked queries, this returns all-zero buckets and says
 * so plainly - it never invents a count. Beacon voice: first person, concrete
 * counts, no lab words, no em or en dashes.
 */

/** The same three rank bands the rest of Beacon speaks in. */
export type RankBucketKey = "top3" | "striking" | "deep";

export type RankDistribution = {
  /** Queries in the top 3 (position 1 to 3). */
  top3: number;
  /** Queries in striking distance (position 4 to 10). */
  striking: number;
  /** Queries on page two and beyond (position 11+). */
  deep: number;
  /** Total queries with a real (finite, positive) position that were counted. */
  total: number;
  /** One first-person summary sentence, or the honest no-data line. Never a lab
   *  word, never a dash. */
  sentence: string;
};

/** One tracked query's rank, all this summary needs. `position` is the
 *  impressions-weighted average Google position (Search Console convention). */
export type RankedQuery = { position: number | null | undefined };

/**
 * Bucket the tenant's tracked-query ranks into top 3 / striking distance / page
 * two and beyond. PURE. Queries with no real position (0, null, non-finite) are
 * not counted toward any bucket or the total - a query Google never showed has no
 * rank to distribute. With nothing to count, all buckets are 0 and the sentence
 * says so honestly.
 */
export function computeRankDistribution(rows: readonly RankedQuery[]): RankDistribution {
  let top3 = 0;
  let striking = 0;
  let deep = 0;
  for (const r of rows) {
    const p = r.position;
    if (p == null || !Number.isFinite(p) || p <= 0) continue;
    if (p <= 3) top3 += 1;
    else if (p <= 10) striking += 1;
    else deep += 1;
  }
  const total = top3 + striking + deep;

  if (total === 0) {
    return {
      top3: 0,
      striking: 0,
      deep: 0,
      total: 0,
      sentence: "I do not have ranked searches for you yet, so there is no rank spread to show.",
    };
  }

  const n = (v: number) => v.toLocaleString("en-US");
  const sentence = `Of ${n(total)} searches you show up for, ${n(top3)} are in the top 3, ${n(striking)} are in striking distance, and ${n(deep)} are on page two or beyond.`;

  return { top3, striking, deep, total, sentence };
}
