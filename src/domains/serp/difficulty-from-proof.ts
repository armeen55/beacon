/**
 * difficulty-from-proof (BEACON_500 R23 P19, v1 item 366, 2026-07-03) - estimate
 * how hard a page is to win from Beacon's OWN settled outcome history, with NO
 * paid difficulty read.
 *
 * winnability.ts already scores a create-page candidate, but it needs THREE paid
 * DataForSEO/Backlinks reads (Google keyword difficulty, winning-domain ranks, a
 * backlink gap). This module is the $0 companion: it answers "how hard is this to
 * win" using only what Beacon has already measured about ITS OWN moves - the
 * shipped-change proof ledger's won/lost verdicts, bucketed by the Google
 * position band the change STARTED in. A page that starts on page two has
 * historically been harder for us to move than one already in striking distance,
 * and this module reads that straight off our own track record instead of buying
 * a difficulty score.
 *
 * PURE, no I/O. The caller loads settled proof records (proof-gsc/
 * shipped-change-store.ts) and the current page's start position, and passes
 * plain values in.
 *
 * HONESTY RULE: with too few settled results in a band, this returns a NULL score
 * and says so in plain words ("not enough history yet") - it NEVER fabricates a
 * difficulty number off a sliver of data. Beacon voice: first person, a concrete
 * count when one exists, no lab words, no em or en dashes.
 */

/** The Google position band a change STARTED in (its pre-ship rank). These are
 *  the same bands the rest of Beacon speaks in: top 3, striking distance (4-10),
 *  and page two and beyond (11+). "unranked" = no measurable start rank. */
export type StartBand = "top3" | "striking" | "deep" | "unranked";

/** Map a pre-ship average position to its band. Position 0 / null / non-finite
 *  reads as "unranked" (Google had no measurable position for it yet). */
export function startBandForPosition(position: number | null | undefined): StartBand {
  if (position == null || !Number.isFinite(position) || position <= 0) return "unranked";
  if (position <= 3) return "top3";
  if (position <= 10) return "striking";
  return "deep";
}

/** Plain-English name for a band, for the difficulty sentence. */
const BAND_PHRASE: Record<StartBand, string> = {
  top3: "already in the top 3",
  striking: "in striking distance (positions 4 to 10)",
  deep: "on page two or beyond (position 11+)",
  unranked: "not ranking yet",
};

/** One settled outcome the estimator reads: the band the change started in and
 *  whether it won. Only settled verdicts (won/lost) are meaningful - a caller
 *  filters measuring/inconclusive/insufficient_data out before calling. */
export type ProofOutcome = {
  /** Pre-ship average Google position for the change (baseline.position). */
  startPosition: number | null;
  /** The settled ledger verdict. Only "won" / "lost" move the estimate. */
  verdict: string;
};

/** A band needs at least this many settled (won+lost) outcomes before its
 *  win-rate is trusted enough to put a difficulty number on. Below this the band
 *  is honestly "not enough history yet". Mirrors outcome-prior.ts's
 *  MIN_OUTCOME_SAMPLES so the two learners agree on when a sample is real. */
export const MIN_BAND_OUTCOMES = 3;

export type DifficultyBand = "winnable" | "moderate" | "hard";

export type ProofDifficulty = {
  /** 0-100, higher = HARDER to win, or null when there is not enough of our own
   *  history in this band yet. difficulty = (1 - winRate) * 100. */
  difficulty: number | null;
  band: DifficultyBand | null;
  /** The start band this estimate is for. */
  startBand: StartBand;
  /** Settled outcomes seen IN this start band (won + lost). */
  sampleSize: number;
  /** Of those, how many won. */
  wins: number;
  /** One first-person sentence naming the concrete track record, or the honest
   *  "not enough history yet" line. Never a lab word, never a dash. */
  sentence: string;
};

/** Difficulty band from a win-rate: >=60% won is winnable, 30-60% moderate,
 *  <30% hard. Documented thresholds, not vibes. */
function bandForWinRate(winRate: number): DifficultyBand {
  if (winRate >= 0.6) return "winnable";
  if (winRate >= 0.3) return "moderate";
  return "hard";
}

/**
 * Estimate how hard a page at `startPosition` is to win from the tenant's OWN
 * settled proof outcomes in the SAME start band. PURE.
 *
 * The estimate is the inverse win-rate of past moves that started in this band:
 * if 8 of 10 changes that began in striking distance went on to win, this band
 * is easy for us (difficulty 20); if 1 of 6 page-two changes won, it is hard
 * (difficulty ~83). With fewer than MIN_BAND_OUTCOMES settled results in the
 * band, difficulty/band are null and the sentence says there is not enough
 * history yet - never a fabricated number.
 */
export function estimateDifficultyFromProof(
  startPosition: number | null | undefined,
  outcomes: readonly ProofOutcome[],
): ProofDifficulty {
  const startBand = startBandForPosition(startPosition);

  let wins = 0;
  let losses = 0;
  for (const o of outcomes) {
    if (startBandForPosition(o.startPosition) !== startBand) continue;
    if (o.verdict === "won") wins += 1;
    else if (o.verdict === "lost") losses += 1;
  }
  const sampleSize = wins + losses;

  if (sampleSize < MIN_BAND_OUTCOMES) {
    return {
      difficulty: null,
      band: null,
      startBand,
      sampleSize,
      wins,
      sentence: `I do not have enough of our own results for pages ${BAND_PHRASE[startBand]} to say how hard this is to win yet. I need ${MIN_BAND_OUTCOMES} settled results in this range; I have ${sampleSize} so far.`,
    };
  }

  const winRate = wins / sampleSize;
  const difficulty = Math.round((1 - winRate) * 100);
  const band = bandForWinRate(winRate);
  const pct = Math.round(winRate * 100);
  const bandPhrase = BAND_PHRASE[startBand];

  const verdictClause =
    band === "winnable"
      ? "so this is a realistic win for us"
      : band === "moderate"
        ? "so this is a real climb, but doable"
        : "so this one is genuinely hard for us to move";

  return {
    difficulty,
    band,
    startBand,
    sampleSize,
    wins,
    sentence: `Of our own moves that started ${bandPhrase}, ${wins} of ${sampleSize} won (${pct}%), ${verdictClause}.`,
  };
}
