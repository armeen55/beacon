/**
 * beatability (2026-07-02, master plan item 23) - PURE scoring for the
 * beat-Wikipedia finder. No I/O, no server-only, unit-tested hard.
 *
 * Three independent signals, each already deterministic and honest:
 *   - thinness:  the article's word count on the specific subtopic (< 500
 *     words = thin; the fewer the words, the higher the score)
 *   - staleness: years since the last revision (> 2 years = stale; the
 *     older, the higher the score)
 *   - demand:    query impressions/volume when known (a thin+stale article
 *     nobody asks about is a lower-conviction win than one AI cites often)
 *
 * The final score blends the three into 0-100 and a plain-English band, plus
 * an operator-facing evidence sentence in the Beacon voice: first person,
 * concrete numbers, no em or en dashes anywhere (hyphens only - guard-tested
 * in beatability.test.ts).
 */

export type BeatabilityInput = {
  /** Article word count, or null when unknown (never guessed). */
  words: number | null;
  /** ISO timestamp of the last revision, or null when unknown. */
  lastRevisionAt: string | null;
  /** Section count, when known - a very low count on a broad-sounding title
   *  is itself a "generic, not specific" signal. */
  sections: number | null;
  /** True when the article does not exist at all (an even stronger case:
   *  AI is citing a page that has nothing on the specific subtopic). */
  exists: boolean;
  /** Query impressions or search volume, when known. Null = unknown, never
   *  guessed - demand then contributes 0 to the score (thinness/staleness
   *  alone still carry the verdict). */
  demand: number | null;
  /** Reference "now" for the staleness calculation. Defaults to real now. */
  now?: Date;
};

export type BeatabilityBand = "high" | "medium" | "low";

export type BeatabilityResult = {
  score: number; // 0-100
  band: BeatabilityBand;
  thin: boolean;
  stale: boolean;
  /** True when the article exists but its word count sits far below the thin
   *  threshold relative to its section count - a broad/generic treatment
   *  rather than a real answer to the specific question. */
  generic: boolean;
  yearsSinceRevision: number | null;
  evidenceSentence: string;
};

/** Below this word count on the specific subtopic, the article counts as thin. */
export const THIN_WORDS_THRESHOLD = 500;
/** Past this many years since the last real edit, the article counts as stale. */
export const STALE_YEARS_THRESHOLD = 2;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 0-1: thinner articles score higher. 0 words -> 1 (maximally thin, but only
 *  when the article exists - a nonexistent article is handled separately by
 *  the caller via `exists`). Words at or above the threshold score falls off
 *  to 0 by 3x the threshold. */
function thinnessScore(words: number | null): number {
  if (words == null) return 0; // unknown - never assume thin
  if (words <= 0) return 1;
  if (words >= THIN_WORDS_THRESHOLD) return 0; // at/above the threshold - not thin
  return clamp(1 - words / THIN_WORDS_THRESHOLD, 0, 1);
}

function yearsSince(lastRevisionAt: string | null, now: Date): number | null {
  if (!lastRevisionAt) return null;
  const ms = now.getTime() - Date.parse(lastRevisionAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

/** 0-1: older revisions score higher, saturating at 2x the stale threshold. */
function stalenessScore(years: number | null): number {
  if (years == null) return 0; // unknown - never assume stale
  if (years <= STALE_YEARS_THRESHOLD) return clamp(years / STALE_YEARS_THRESHOLD, 0, 1) * 0.4; // below threshold: weak credit only
  return clamp(years / (STALE_YEARS_THRESHOLD * 2), 0, 1);
}

/** 0-1: demand contributes at most a third of the score - thinness/staleness
 *  are the real "is this beatable" signal; demand only breaks ties among
 *  beatable topics toward the ones worth building first. */
function demandScore(demand: number | null): number {
  if (demand == null || demand <= 0) return 0;
  // log-scale so a 50-impression query and a 5,000-impression query don't
  // sit 100x apart in contribution - saturates around ~2,000.
  return clamp(Math.log10(demand + 1) / Math.log10(2001), 0, 1);
}

const fmtYears = (years: number): string => {
  if (years < 1) return "under a year";
  const whole = Math.round(years);
  return whole === 1 ? "1 year" : `${whole} years`;
};

const revisionYear = (lastRevisionAt: string | null): string | null => {
  if (!lastRevisionAt) return null;
  const d = new Date(lastRevisionAt);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
};

/** PURE: score one Wikipedia article's beatability. Never throws. */
export function scoreBeatability(input: BeatabilityInput): BeatabilityResult {
  const now = input.now ?? new Date();

  if (!input.exists) {
    // No article at all on this specific subtopic - the strongest possible
    // case (nothing to be "thin" relative to; AI is citing a page that
    // never addresses the question). Score high, but the evidence sentence
    // stays honest about what "beatable" means here.
    return {
      score: 90,
      band: "high",
      thin: true,
      stale: false,
      generic: false,
      yearsSinceRevision: null,
      evidenceSentence:
        "I do not see a dedicated Wikipedia article on this specific question. AI cites the closest Wikipedia page anyway because nothing better exists. You can be the first real answer.",
    };
  }

  const years = yearsSince(input.lastRevisionAt, now);
  const thin = input.words != null && input.words < THIN_WORDS_THRESHOLD;
  const stale = years != null && years > STALE_YEARS_THRESHOLD;
  // Generic: a real article exists with real length, but very few sections
  // for its size - a broad treatment rather than a focused answer to the
  // specific question. Only flagged when we actually know both numbers.
  const generic =
    input.words != null && input.sections != null && input.words > THIN_WORDS_THRESHOLD && input.sections <= 2;

  const tScore = thinnessScore(input.words);
  const sScore = stalenessScore(years);
  const dScore = demandScore(input.demand);
  const genericBonus = generic ? 0.15 : 0;
  // A confirmed thin AND stale article (the master-plan's own "180 words, last
  // touched 2019" example) is the strongest real-world case - a small bonus
  // keeps it from sitting on the medium/high boundary when either signal alone
  // is only moderate.
  const thinAndStaleBonus = thin && stale ? 0.1 : 0;

  // Weighted blend: thinness and staleness are the core "beatable" signal;
  // demand breaks ties; a generic-but-not-thin article gets a small bonus
  // since "covers the broad topic, not the specific question" is itself a
  // beatable gap even when word count alone looks fine.
  const raw = tScore * 0.5 + sScore * 0.3 + dScore * 0.2 + genericBonus + thinAndStaleBonus;
  const score = Math.round(clamp(raw, 0, 1) * 100);

  const band: BeatabilityBand = score >= 60 ? "high" : score >= 30 ? "medium" : "low";

  // Evidence sentence - first person, concrete numbers, no dashes.
  const parts: string[] = [];
  if (input.words != null) {
    parts.push(`Wikipedia's article on this is ${input.words.toLocaleString("en-US")} words`);
  } else {
    parts.push("Wikipedia's article on this is short");
  }
  const revYear = revisionYear(input.lastRevisionAt);
  if (revYear) {
    parts.push(`and was last touched in ${revYear}`);
  } else if (years != null) {
    parts.push(`and has not been touched in ${fmtYears(years)}`);
  }
  let sentence = `${parts.join(" ")}. `;
  if (generic && !thin) {
    sentence += "It covers the broad topic, not this specific question. ";
  }
  sentence += "AI cites it anyway because nothing better exists. You can be the better source.";

  return {
    score,
    band,
    thin,
    stale,
    generic,
    yearsSinceRevision: years == null ? null : Math.round(years * 10) / 10,
    evidenceSentence: sentence,
  };
}
