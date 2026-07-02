/**
 * calibration (2026-07-02, master plan item 43) - PURE math for the accountability layer that sits
 * on top of item 38's Brier scoreboard: two honest reads on each teammate's track record.
 *
 * (1) CONVICTION CALIBRATION - a specialist's supporting votes (brier.ts's `voiceProbability` for a
 *     "supporting" stance) each carry a stated conviction 0..100. Bucket those raw convictions into
 *     bands (60-70, 70-80, 80-90, 90+) and compute the REALIZED win rate within each band - the
 *     honest comparison of "how sure it sounded" against "how often that sounded-sure pick actually
 *     won". A specialist that is well calibrated says 80 percent and wins about 80 percent of the
 *     time; one that is overconfident says 90 percent and only wins half the time. Below 60 the vote
 *     is not really a confident claim, so those votes are excluded from banding (they still count in
 *     the Brier tally in brier.ts, just not in this "argues with conviction" read).
 *
 * (2) OBJECTION TRACK RECORD - when a specialist raises an objection (a dissenting voice in
 *     team-review.ts's `objections` array) and the pick SHIPS ANYWAY (it is not vetoed off content -
 *     see team-review.ts's vetoed/routedOffContent split, so anything that reaches plan.selected and
 *     settles already shipped over any objection attached to it), the objection is scored against the
 *     real settled verdict: RIGHT when the pick went on to lose or land flat (the objector's caution
 *     was warranted), WRONG when the pick won anyway (the objection did not hold up). This is a
 *     separate ledger from the Brier vote on the SAME objection (brier.ts already scores the
 *     objection as a dissenting vote for won/lost purposes) - this module exists to produce the
 *     plain "objected N times, right M times" sentence, which a win/loss/flat tally does not say on
 *     its own.
 *
 * PURE - no I/O, no LLM, deterministic. Pinned by calibration.test.ts.
 */

export type ConvictionBand = "60-70" | "70-80" | "80-90" | "90+";

/** One supporting vote's raw conviction (0..100, NOT the derived win probability) plus the settled
 *  outcome it is scored against. Votes below 60 do not belong to any band (see module doc). */
export type ConvictionObservation = {
  specialist: string;
  conviction: number;
  outcome: 0 | 1;
};

/** Realized record for one conviction band: how many picks argued at this conviction, and how many
 *  actually won. `winRatePct` is null when n is 0 (never divide by zero, never fabricate a rate). */
export type BandTally = {
  band: ConvictionBand;
  n: number;
  won: number;
  winRatePct: number | null;
};

/** Below this many observations in a band, the band's rate is real but not yet a reliable read -
 *  mirrors brier.ts's SMALL_N_THRESHOLD so the two accountability reads use one honesty bar. */
const SMALL_N_THRESHOLD = 5;

const BANDS: ReadonlyArray<{ band: ConvictionBand; min: number; max: number }> = [
  { band: "60-70", min: 60, max: 70 },
  { band: "70-80", min: 70, max: 80 },
  { band: "80-90", min: 80, max: 90 },
  { band: "90+", min: 90, max: 101 }, // 101 so 100 itself lands in the top band (max is exclusive below)
];

/** Which band a raw conviction (0..100) falls into, or null below 60 (not a confident claim) or
 *  above 100 (not a valid percent). Band edges: [min, max) except the last band, which is closed at
 *  100 - so a vote at exactly 70 lands in "70-80", not "60-70". */
export function bandOf(conviction: number): ConvictionBand | null {
  if (!Number.isFinite(conviction) || conviction < 60 || conviction > 100) return null;
  for (const b of BANDS) {
    if (conviction >= b.min && conviction < b.max) return b.band;
  }
  return null;
}

/** Fold conviction observations (already filtered to one specialist) into a tally per band. Always
 *  returns all 4 bands, in order, even when a band has zero observations (n: 0, winRatePct: null) -
 *  a caller filters by n before rendering, but the shape is never sparse/keyed-only-on-what-exists. */
export function buildCalibrationBands(observations: ConvictionObservation[]): BandTally[] {
  const byBand = new Map<ConvictionBand, { n: number; won: number }>();
  for (const b of BANDS) byBand.set(b.band, { n: 0, won: 0 });
  for (const obs of observations) {
    const band = bandOf(obs.conviction);
    if (!band) continue;
    const cell = byBand.get(band)!;
    cell.n += 1;
    if (obs.outcome === 1) cell.won += 1;
  }
  return BANDS.map(({ band }) => {
    const cell = byBand.get(band)!;
    return {
      band,
      n: cell.n,
      won: cell.won,
      winRatePct: cell.n > 0 ? Math.round((cell.won / cell.n) * 100) : null,
    };
  });
}

/**
 * The single honest calibration line for one specialist's most-observed band that clears the small-n
 * bar, e.g. "Search demand argues at 80 percent conviction and is right 74 percent of the time." Null
 * when no band has enough observations yet (SMALL_N_THRESHOLD) - silence, not a thin-sample claim.
 * Picks the band with the most observations among those clearing the bar (ties broken by the higher
 * band, since a team's headline conviction skews toward its strongest claims). Renders the band's
 * lower bound (60/70/80/90) as "argues at N percent conviction", matching the master plan's own
 * example sentence ("Search demand argues at 80 percent conviction...") for its 80-90 band.
 */
export function buildCalibrationLine(specialistLabel: string, bands: BandTally[]): string | null {
  const eligible = bands.filter((b) => b.n >= SMALL_N_THRESHOLD && b.winRatePct != null);
  if (eligible.length === 0) return null;
  const best = eligible.sort((a, b) => {
    const byN = b.n - a.n;
    if (byN !== 0) return byN;
    return BANDS.findIndex((x) => x.band === b.band) - BANDS.findIndex((x) => x.band === a.band);
  })[0]!;
  const lowerBound: Record<ConvictionBand, number> = { "60-70": 60, "70-80": 70, "80-90": 80, "90+": 90 };
  return `${specialistLabel} argues at ${lowerBound[best.band]} percent conviction and is right ${best.winRatePct} percent of the time.`;
}

// ── Objection track record ─────────────────────────────────────────────────

/** One objection a specialist raised on a pick that shipped anyway (a veto that routed the page off
 *  content work never reaches a plan pick, so every objection joined here already shipped over it -
 *  see the module doc). `outcome` is the pick's settled verdict collapsed to won (1) / not-won (0),
 *  same convention as brier.ts's ScoredVote. */
export type ObjectionObservation = {
  /** The objector's plain label (team-review.ts's `objections[].label`, e.g. "Visitor behavior") -
   *  objections do not carry the raw specialist key, only the label (see compute-scoreboard.ts). */
  objectorLabel: string;
  severity: "veto" | "downgrade";
  outcome: 0 | 1;
};

/** One objector's realized track record: how many times it objected on a pick that shipped anyway,
 *  and how many of those objections turned out RIGHT (the pick went on to lose or land flat). */
export type ObjectionTally = {
  objectorLabel: string;
  objected: number;
  right: number;
  wrong: number;
};

/** Fold objection observations into one tally per objector label. Deterministic alphabetical order. */
export function buildObjectionTrackRecord(observations: ObjectionObservation[]): ObjectionTally[] {
  const byLabel = new Map<string, { objected: number; right: number; wrong: number }>();
  for (const obs of observations) {
    const cell = byLabel.get(obs.objectorLabel) ?? { objected: 0, right: 0, wrong: 0 };
    cell.objected += 1;
    // The objection bet AGAINST the pick. It reads RIGHT when the pick did not win (lost/flat, i.e.
    // outcome 0); WRONG when the pick won anyway (outcome 1).
    if (obs.outcome === 0) cell.right += 1;
    else cell.wrong += 1;
    byLabel.set(obs.objectorLabel, cell);
  }
  return [...byLabel.keys()].sort().map((objectorLabel) => {
    const cell = byLabel.get(objectorLabel)!;
    return { objectorLabel, ...cell };
  });
}

/** Below this many objections from one objector, the track-record line stays silent - matches the
 *  small-n bar used everywhere else in the scoreboard. */
const SMALL_N_OBJECTIONS_THRESHOLD = 5;

/**
 * The single honest objection-track-record line for the objector with the most objections that
 * clears the small-n bar, e.g. "Visitor behavior objected 4 times this quarter and was right twice."
 * Despite the master-plan example using 4, the surface contract (item 43) requires >= 5 observations
 * before the line renders at all - silence below that, exactly like the calibration line.
 * Null when no objector clears the bar.
 */
export function buildObjectionTrackRecordLine(tallies: ObjectionTally[]): string | null {
  const eligible = tallies.filter((t) => t.objected >= SMALL_N_OBJECTIONS_THRESHOLD);
  if (eligible.length === 0) return null;
  const best = eligible.sort((a, b) => {
    const byCount = b.objected - a.objected;
    if (byCount !== 0) return byCount;
    return a.objectorLabel.localeCompare(b.objectorLabel);
  })[0]!;
  const timesWord = best.objected === 1 ? "time" : "times";
  const rightWord =
    best.right === 0
      ? "was not right yet"
      : best.right === 1
        ? "was right once"
        : best.right === 2
          ? "was right twice"
          : `was right ${numberWord(best.right)} times`;
  return `${best.objectorLabel} objected ${numberWord(best.objected)} ${timesWord} this quarter and ${rightWord}.`;
}

/** Plain small-number words for a natural sentence (1-10); falls back to the digit above 10. */
function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return n >= 0 && n < words.length ? words[n]! : String(n);
}
