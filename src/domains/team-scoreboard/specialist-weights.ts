/**
 * specialist-weights (2026-07-02, BEACON_500 item 70) - the LEARNING half of the team scoreboard
 * loop: turn each specialist's SETTLED voting record (brier.ts's per-specialist / per-family
 * tallies, already joined to real proof-ledger verdicts by compute-scoreboard.ts) into a bounded,
 * explainable reliability WEIGHT the router can apply to that specialist's vote. This is the exact
 * pattern src/domains/learning/experiment-prior.ts already proved for Moves (MIN_DECIDED settled
 * outcomes, clamp to a narrow band, explainable counts, neutral until proven) - applied here to
 * TEAMMATES instead of lever dimensions.
 *
 * Design guarantees (mirrors experiment-prior.ts's contract exactly):
 *  - INFLUENCE, NOT DOMINATE: the weight is clamped to [MIN_WEIGHT, MAX_WEIGHT] = [0.85, 1.15].
 *    A specialist that has called 8 of 11 winners gets a bit more say; it can never out-vote a
 *    unanimous team or silence a dissent on its own.
 *  - NO FAKE LEARNING: a (specialist, family) cell needs >= MIN_DECIDED settled votes (won+lost,
 *    "flat" excluded - see below) before it earns a non-neutral weight. Below that it backs off to
 *    the specialist's OVERALL record (still gated by the same MIN_DECIDED); below THAT it is
 *    neutral (1.0). One early result can never bias a vote.
 *  - CALIBRATION SHRINK: independently of the win-rate weight, a specialist that consistently
 *    STATES more confidence than its picks actually earn (its conviction band's win rate trails its
 *    stated conviction by more than OVERCONFIDENCE_MARGIN, on enough samples) gets a bounded shrink
 *    multiplier folded in - a loud, overconfident voice is quieted a little, not silenced.
 *  - DETERMINISTIC + EXPLAINABLE: same scoreboard -> same weights; every resolved weight carries a
 *    plain-English tag ("Search demand has called 8 of its last 11 winners here, so its vote counts
 *    a bit more.") and the counts that earned it.
 *  - PURE / no I/O / no store: computed at READ TIME from the existing team-scoreboard snapshot
 *    (brier.ts's Tally + calibration.ts's BandTally), never a new persisted table. A caller wanting
 *    this cached across a request wraps the snapshot loader in React's cache(), same as every other
 *    $0 scoreboard read (load-team-scoreboard.ts).
 *
 * PURE / deterministic. Pinned by specialist-weights.test.ts.
 */

import type { Tally } from "./brier";
import type { BandTally } from "./calibration";

/** Minimum DECIDED (won+lost) votes in a cell before its win-rate is trusted enough to weight a
 *  vote. Mirrors experiment-prior.ts's MIN_DECIDED exactly - the same honesty bar, applied to a
 *  specialist's record instead of a lever dimension. */
export const MIN_DECIDED = 3;
/** Bounded multiplier band - learning tilts a vote, never dominates it. Identical band to
 *  experiment-prior.ts's [MIN_MULTIPLIER, MAX_MULTIPLIER] so the two learning layers read as one
 *  consistent "how much can Beacon's own history move a decision" contract. */
export const MIN_WEIGHT = 0.85;
export const MAX_WEIGHT = 1.15;
/** Slope from win-rate to weight before clamping - same sensitivity experiment-prior.ts uses, so a
 *  specialist and a lever family earn a boost/cut at the same rate for the same win rate. */
const SENSITIVITY = 0.5;

/** A won+lost tally reduced to what the weight math needs (brier.ts's Tally already has this
 *  shape; this alias keeps this module decoupled from importing Tally's full surface). */
export type DecidedRecord = { won: number; lost: number };

function decidedCountOf(t: DecidedRecord): number {
  return t.won + t.lost;
}

function winRateOf(t: DecidedRecord): number {
  const decided = decidedCountOf(t);
  return decided > 0 ? t.won / decided : 0.5;
}

function clampWeight(n: number): number {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, n));
}

function weightFromWinRate(winRate: number): number {
  return clampWeight(1 + (winRate - 0.5) * SENSITIVITY);
}

/** Where a resolved weight's evidence came from - the family cell itself, a backoff to the
 *  specialist's overall record, or neutral (no cell cleared MIN_DECIDED). Explainable provenance,
 *  same spirit as experiment-prior.ts's `basis`. */
export type WeightBasis = "family" | "overall" | "neutral";

export type ReliabilityWeight = {
  specialist: string;
  family: string;
  /** Final bounded weight, calibration shrink already folded in. 1.0 when neutral. */
  weight: number;
  basis: WeightBasis;
  /** Settled (won+lost) sample the weight rode on - the family cell's count when basis is
   *  "family", the specialist's overall count when "overall", 0 when neutral. */
  decidedSample: number;
  won: number;
  lost: number;
  /** Set when a calibration shrink was folded into `weight` (basis can still be "family" or
   *  "overall" - shrink is an independent adjustment, not its own basis). Null when no shrink
   *  applied (either no overconfident band, or the win-rate weight was already neutral/no cell). */
  shrinkApplied: number | null;
  /** Plain-English explainable line for a scoreboard/roundtable surface. Null exactly when the
   *  weight is neutral with no shrink (nothing learned yet to say). */
  tag: string | null;
};

const NEUTRAL_BASIS: WeightBasis = "neutral";

function neutralWeight(specialist: string, family: string): ReliabilityWeight {
  return {
    specialist,
    family,
    weight: 1,
    basis: NEUTRAL_BASIS,
    decidedSample: 0,
    won: 0,
    lost: 0,
    shrinkApplied: null,
    tag: null,
  };
}

/** Plain-English tag for a resolved weight - "Search demand has called 8 of its last 11 winners
 *  here, so its vote counts a bit more." Mirrors experiment-prior.ts's tagFor style: names the
 *  record, says which way it moved the vote, never uses a raw dimension key. `scopeLabel` is
 *  "here" for a family-scoped weight (the router applies it inside one lever family) or "overall"
 *  for the specialist's whole record (family cell was too thin). */
function tagFor(label: string, record: DecidedRecord, basis: WeightBasis, weight: number): string {
  const scope = basis === "family" ? "here" : "overall";
  const n = decidedCountOf(record);
  if (weight > 1) return `${label} has called ${record.won} of its last ${n} winners ${scope}, so its vote counts a bit more.`;
  if (weight < 1) return `${label} has called ${record.won} of its last ${n} winners ${scope}, so its vote counts a little less.`;
  return `${label} has called ${record.won} of its last ${n} winners ${scope} - a neutral track record so far.`;
}

/**
 * Resolve ONE specialist's reliability weight for ONE lever family, with backoff. PURE.
 *  1. If the family cell has >= MIN_DECIDED settled votes, weight from ITS win rate (basis "family").
 *  2. Else if the specialist's OVERALL tally has >= MIN_DECIDED settled votes, weight from that
 *     (basis "overall") - a specialist proven reliable in general, even where this exact family is
 *     still thin, earns a small benefit of the doubt (bounded the same way).
 *  3. Else neutral (1.0, "neutral", no tag) - exactly experiment-prior.ts's backoff-then-neutral
 *     ladder, one level deep (family -> overall) since a specialist only has these two scopes.
 */
export function resolveSpecialistWeight(
  specialist: string,
  family: string,
  overall: DecidedRecord,
  familyCell: DecidedRecord | undefined,
  specialistLabel: string,
): ReliabilityWeight {
  if (familyCell && decidedCountOf(familyCell) >= MIN_DECIDED) {
    const weight = weightFromWinRate(winRateOf(familyCell));
    return {
      specialist,
      family,
      weight,
      basis: "family",
      decidedSample: decidedCountOf(familyCell),
      won: familyCell.won,
      lost: familyCell.lost,
      shrinkApplied: null,
      tag: tagFor(specialistLabel, familyCell, "family", weight),
    };
  }
  if (decidedCountOf(overall) >= MIN_DECIDED) {
    const weight = weightFromWinRate(winRateOf(overall));
    return {
      specialist,
      family,
      weight,
      basis: "overall",
      decidedSample: decidedCountOf(overall),
      won: overall.won,
      lost: overall.lost,
      shrinkApplied: null,
      tag: tagFor(specialistLabel, overall, "overall", weight),
    };
  }
  return neutralWeight(specialist, family);
}

// ── Calibration shrink ──────────────────────────────────────────────────────
//
// Independent of the win-rate weight above: a specialist can have a fine win rate but still
// consistently OVERSTATE its confidence (e.g. always arguing at 90 when it is only right 65% of
// the time in that band). calibration.ts already buckets a specialist's stated confidencePct into
// bands and measures each band's realized win rate; this section turns a chronically overconfident
// band into a bounded shrink multiplier, folded into the family/overall weight above so a loud,
// overconfident voice does not get to keep its full volume just because its overall win rate is OK.

/** How far a band's stated confidence must exceed its measured win rate before it counts as
 *  "chronically overconfident" - a small, honest gap is normal noise, not a pattern to correct. */
export const OVERCONFIDENCE_MARGIN = 15;
/** Minimum observations in a band before its measured win rate is trusted enough to shrink a
 *  specialist's weight - mirrors calibration.ts's own SMALL_N_THRESHOLD (5), the same honesty bar
 *  the calibration line itself uses before it will say anything out loud. */
export const MIN_BAND_SAMPLE_FOR_SHRINK = 5;
/** Floor on the shrink multiplier - bounded the same way the weight itself is bounded, so
 *  overconfidence can quiet a voice but never mute it. */
export const MIN_SHRINK = 0.85;

const BAND_LOWER_BOUND: Record<BandTally["band"], number> = { "60-70": 60, "70-80": 70, "80-90": 80, "90+": 90 };

/** The shrink multiplier for ONE conviction band: 1.0 (no shrink) unless the band has enough
 *  samples AND its stated conviction (the band's lower bound, matching calibration.ts's own
 *  "argues at N percent conviction" convention) exceeds its measured win rate by more than
 *  OVERCONFIDENCE_MARGIN points. The overshoot beyond the margin maps linearly to a cut, clamped at
 *  MIN_SHRINK - a band that is wildly overconfident shrinks no further than a moderately
 *  overconfident one once both are already at the floor. PURE. */
export function shrinkForBand(band: BandTally): number {
  if (band.n < MIN_BAND_SAMPLE_FOR_SHRINK || band.winRatePct == null) return 1;
  const statedPct = BAND_LOWER_BOUND[band.band];
  const overshoot = statedPct - band.winRatePct - OVERCONFIDENCE_MARGIN;
  if (overshoot <= 0) return 1;
  // Each point of overshoot beyond the margin shaves 1% off the weight, floored at MIN_SHRINK.
  return Math.max(MIN_SHRINK, 1 - overshoot / 100);
}

/** The single worst (smallest) shrink multiplier across a specialist's calibration bands, i.e. the
 *  band it is MOST chronically overconfident in. 1.0 (no shrink) when no band qualifies or the
 *  specialist has no bands at all. PURE, deterministic (ties do not matter - equal shrinks are
 *  interchangeable). */
export function worstShrinkAcrossBands(bands: readonly BandTally[] | undefined): number {
  if (!bands || bands.length === 0) return 1;
  let worst = 1;
  for (const b of bands) {
    const s = shrinkForBand(b);
    if (s < worst) worst = s;
  }
  return worst;
}

/**
 * Fold a calibration shrink into an already-resolved win-rate weight. PURE. A neutral (basis
 * "neutral") weight is left untouched - shrink only ever tightens an EARNED weight, it never
 * manufactures a non-neutral one out of a thin/absent record. When a shrink applies, it multiplies
 * the win-rate weight and the result is re-clamped to the same [MIN_WEIGHT, MAX_WEIGHT] band, and
 * the tag is replaced with one that names the overconfidence honestly.
 */
export function applyCalibrationShrink(
  resolved: ReliabilityWeight,
  bands: readonly BandTally[] | undefined,
  specialistLabel: string,
): ReliabilityWeight {
  if (resolved.basis === "neutral") return resolved;
  const shrink = worstShrinkAcrossBands(bands);
  if (shrink >= 1) return resolved;
  const weight = clampWeight(resolved.weight * shrink);
  return {
    ...resolved,
    weight,
    shrinkApplied: shrink,
    tag: `${specialistLabel} has argued with more confidence than its picks earned, so its vote counts a little less.`,
  };
}

// ── Read-time table + lookup ────────────────────────────────────────────────

/** The minimal scoreboard shape this module needs per specialist - a subset of
 *  TeamScoreboardSnapshot['specialists'][number] so this module never imports the store type
 *  (kept decoupled; a caller passes exactly this shape from whatever it already loaded). */
export type SpecialistScoreboardCell = {
  specialist: string;
  overall: Tally;
  byFamily: Record<string, Tally>;
  calibrationBands?: BandTally[];
};

/** A resolved weight table: specialist -> family -> ReliabilityWeight, plus a `get` that resolves
 *  a NEW (specialist, family) pair on demand (families never observed for a specialist correctly
 *  fall back to its overall record, or neutral). Built once per scoreboard snapshot. */
export type SpecialistWeightTable = {
  get(specialist: string, family: string): ReliabilityWeight;
};

/**
 * Build the full weight table from the team scoreboard's per-specialist rows. PURE. `labelFor`
 * maps a raw specialist key to its operator-facing name (team/identity.ts's teammateOf, threaded
 * in rather than imported so this module stays a leaf - no dependency on the identity module).
 * With an EMPTY `cells` array (no scoreboard yet, or nothing settled) every lookup resolves neutral
 * - the byte-identical-when-cold guarantee routeMove's test pins.
 */
export function buildSpecialistWeightTable(
  cells: readonly SpecialistScoreboardCell[],
  labelFor: (specialist: string) => string,
): SpecialistWeightTable {
  const bySpecialist = new Map<string, SpecialistScoreboardCell>();
  for (const c of cells) bySpecialist.set(c.specialist, c);

  return {
    get(specialist: string, family: string): ReliabilityWeight {
      const cell = bySpecialist.get(specialist);
      if (!cell) return neutralWeight(specialist, family);
      const label = labelFor(specialist);
      const resolved = resolveSpecialistWeight(specialist, family, cell.overall, cell.byFamily[family], label);
      return applyCalibrationShrink(resolved, cell.calibrationBands, label);
    },
  };
}
