/**
 * winnability (2026-07-02, master plan item 18) - PURE arithmetic that turns
 * three cheap DataForSEO/Backlinks reads (keyword difficulty, winning-domain
 * ranks, and a page-level backlink gap) into a single honest score + band +
 * sentence. No I/O, no server-only: the reads happen in dataforseo-labs.ts and
 * are passed in already-parsed.
 *
 * serp-validation.ts judges a create-page verdict from SERP SHAPE alone
 * (content vs marketplace/UGC) and daily-evidence-brief.ts has to apologize
 * that "competition" is not real difficulty. This module is the arithmetic
 * layer: it never fabricates a number it does not have, and it degrades
 * confidence (never the score direction) when a read is missing.
 *
 * Thresholds (documented, not tuned by vibes):
 *   - median winning-domain rank >= 70            -> "hard" (strong domains own it)
 *   - keyword difficulty >= 70                    -> "hard"
 *   - backlink gap (their avg / your count) > 50x  -> "reject" UNLESS difficulty is
 *     low (< 30) - a low-difficulty keyword can still be winnable with a thin
 *     backlink profile if Google itself says the term is not contested.
 *   - difficulty >= 85 OR median domain rank >= 85 -> "reject" outright (no
 *     amount of corroboration makes an 85+ read winnable)
 */

export type WinnabilityBand = "winnable" | "hard" | "reject";

export type WinnabilityInput = {
  /** 0-100 Google keyword-difficulty score for the target keyword, or null (unread/unknown). */
  difficulty?: number | null;
  /** 0-100 domain-strength rank for each winning SERP domain, or null entries when unread. */
  domainRanks?: Array<number | null> | null;
  /** Backlink comparison: the winning pages' average linking-domain count vs the tenant's own page. */
  backlinkGap?: {
    /** Average referring domains across the top winning URLs, or null when unread. */
    theirAvgReferringDomains: number | null;
    /** The tenant's own page's referring domains, or null when unread. */
    ownReferringDomains: number | null;
  } | null;
  /** SERP shape verdict from serp-validation.ts (content vs marketplace/UGC), for context in reasons. */
  serpShape?: { intent: "content" | "marketplace_ugc" | "mixed"; contentDomainCount: number } | null;
};

export type Winnability = {
  /** 0-100, higher = more winnable. */
  score: number;
  band: WinnabilityBand;
  /** Plain-English reasons backing the band, most-decisive first. */
  reasons: string[];
  /** One first-person sentence with the concrete numbers, for the verdict copy. */
  sentence: string;
  /** How many of the three reads actually had data (0-3). Missing reads lower confidence, never the band. */
  readsAvailable: number;
};

const HARD_DOMAIN_RANK = 70;
const REJECT_DOMAIN_RANK = 85;
const HARD_DIFFICULTY = 70;
const REJECT_DIFFICULTY = 85;
const REJECT_BACKLINK_MULTIPLE = 50;
const LOW_DIFFICULTY = 30;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Score a create-page candidate's winnability from difficulty, winning-domain
 * ranks, and a backlink gap. PURE. Absent reads degrade confidence (fewer
 * reasons, readsAvailable drops) but never fabricate a number - a candidate
 * with zero reads returns the honest middle (score 50, band "hard", one
 * reason: no data yet).
 */
export function computeWinnability(input: WinnabilityInput): Winnability {
  const difficulty = typeof input.difficulty === "number" && Number.isFinite(input.difficulty) ? clamp(input.difficulty) : null;
  const ranks = (input.domainRanks ?? []).filter((r): r is number => typeof r === "number" && Number.isFinite(r)).map(clamp);
  const medianRank = median(ranks);
  const gap = input.backlinkGap ?? null;
  const theirAvg = typeof gap?.theirAvgReferringDomains === "number" && gap.theirAvgReferringDomains >= 0 ? gap.theirAvgReferringDomains : null;
  const ownCount = typeof gap?.ownReferringDomains === "number" && gap.ownReferringDomains >= 0 ? gap.ownReferringDomains : null;
  const backlinkMultiple = theirAvg != null && ownCount != null ? (ownCount === 0 ? (theirAvg > 0 ? Infinity : 0) : theirAvg / ownCount) : null;

  const readsAvailable = (difficulty != null ? 1 : 0) + (medianRank != null ? 1 : 0) + (backlinkMultiple != null ? 1 : 0);

  const reasons: string[] = [];
  let band: WinnabilityBand = "winnable";

  // ── Hard rejects first (most decisive, cited alone when they fire) ──
  if (difficulty != null && difficulty >= REJECT_DIFFICULTY) {
    band = "reject";
    reasons.push(`Google's own index scores this keyword ${Math.round(difficulty)} of 100 difficulty, too contested to win.`);
  }
  if (medianRank != null && medianRank >= REJECT_DOMAIN_RANK) {
    band = "reject";
    reasons.push(`The pages that win average domain strength ${Math.round(medianRank)}, sites that strong are not beatable with a new page.`);
  }
  if (band !== "reject" && backlinkMultiple != null && backlinkMultiple > REJECT_BACKLINK_MULTIPLE) {
    if (difficulty != null && difficulty < LOW_DIFFICULTY) {
      reasons.push(`The winning pages have ${Math.round(backlinkMultiple)}x your linking domains, but Google's difficulty score is only ${Math.round(difficulty)}, so this stays winnable on merit.`);
    } else {
      band = "reject";
      reasons.push(`The winning pages average ${Math.round(theirAvg as number)} linking domains and you have ${Math.round(ownCount as number)}, a ${Math.round(backlinkMultiple)}x gap you cannot close with content alone.`);
    }
  }

  // ── Hard band (contested but not a flat reject) ──
  if (band !== "reject") {
    if (difficulty != null && difficulty >= HARD_DIFFICULTY) {
      band = "hard";
      reasons.push(`Google scores this keyword ${Math.round(difficulty)} of 100 difficulty, a real climb.`);
    }
    if (medianRank != null && medianRank >= HARD_DOMAIN_RANK) {
      band = "hard";
      reasons.push(`The pages that win average domain strength ${Math.round(medianRank)}, strong sites hold this SERP.`);
    }
  }

  // ── Winnable corroboration (only cited when we are not already hard/reject) ──
  if (band === "winnable") {
    if (difficulty != null) reasons.push(`Google scores this keyword ${Math.round(difficulty)} of 100 difficulty, you can realistically compete.`);
    if (medianRank != null) reasons.push(`The pages that win average domain strength ${Math.round(medianRank)}, not out of reach.`);
    if (backlinkMultiple != null && Number.isFinite(backlinkMultiple)) {
      reasons.push(`The winning pages average ${Math.round(theirAvg as number)} linking domains and you have ${Math.round(ownCount as number)}, a gap you can close with real content.`);
    }
  }

  if (readsAvailable === 0) {
    band = "hard";
    reasons.push("No difficulty, domain-strength, or backlink read yet, staying cautious until Google's numbers are in.");
  }

  // ── score: start at the band midpoint, then nudge by how contested the reads are ──
  let score = band === "reject" ? 15 : band === "hard" ? 45 : 75;
  if (difficulty != null) score -= (difficulty - 50) * 0.4;
  if (medianRank != null) score -= (medianRank - 50) * 0.3;
  if (backlinkMultiple != null && Number.isFinite(backlinkMultiple)) score -= Math.min(backlinkMultiple, 100) * 0.3;
  score = clamp(Math.round(score));
  if (band === "reject") score = Math.min(score, 24);
  if (band === "hard") score = Math.min(Math.max(score, 25), 69);
  if (band === "winnable") score = Math.max(score, 70);

  const sentence = buildSentence({ difficulty, medianRank, theirAvg, ownCount, backlinkMultiple, band, serpShape: input.serpShape ?? null });

  return { score, band, reasons, sentence, readsAvailable };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function buildSentence(args: {
  difficulty: number | null;
  medianRank: number | null;
  theirAvg: number | null;
  ownCount: number | null;
  backlinkMultiple: number | null;
  band: WinnabilityBand;
  serpShape: { intent: "content" | "marketplace_ugc" | "mixed"; contentDomainCount: number } | null;
}): string {
  const { difficulty, medianRank, theirAvg, ownCount, band } = args;
  const parts: string[] = [];
  if (difficulty != null) parts.push(`Google's index scores this keyword ${Math.round(difficulty)} of 100 difficulty`);
  if (medianRank != null) parts.push(`the pages that win average domain strength ${Math.round(medianRank)}`);
  if (theirAvg != null && ownCount != null) parts.push(`they average ${Math.round(theirAvg)} linking domains, you have ${Math.round(ownCount)}`);

  if (parts.length === 0) {
    return "I do not have Google's difficulty or domain-strength numbers for this yet, so I am staying cautious.";
  }

  const facts = parts.join(", ").replace(/^./, (c) => c.toUpperCase());
  if (band === "reject") return `${facts}. This one is not winnable right now, I would skip it.`;
  if (band === "hard") return `${facts}. This is a real climb, but not off the table.`;
  return `${facts}. You can realistically compete here.`;
}
