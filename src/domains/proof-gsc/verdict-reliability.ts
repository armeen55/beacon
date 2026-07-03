/**
 * verdict-reliability (BEACON_500 N10, 2026-07-02) - ONE grade that answers the
 * question every other feeder answers a piece of: "how much should I trust this
 * read?" Combines six things a proof card already computes separately (recrawl
 * clock N11, window completeness, contamination N13, weak comparison pages,
 * shock/seasonal overlap, and sample strength) into one label the operator can
 * scan without holding six caveats in their head at once.
 *
 * PURE - no I/O. Takes the SAME feeder outputs measurement-maturity.ts's
 * buildMeasurementPresentation() already computed (plus the two sufficiency
 * numbers and the optional permutation-null read), so this module never
 * re-derives anything and never disagrees with the card's own caveats. A
 * caller with no new feeders wired sees the grade fall out of maturity +
 * sample strength alone - additive, same posture as every N10 feeder before
 * it (weatherQuarantined, weakComparisonFlagged, seasonalInflectionFlagged,
 * recrawlPending, controlContaminationFlagged all already exist on
 * MeasurementPresentation; this module just reads them).
 *
 * Grade ladder (mutually exclusive, checked top to bottom):
 *   "too early" - not enough calendar time / index exposure has passed for a
 *                 read to mean anything yet (recrawl pending, or no window has
 *                 closed, or the record hasn't shipped).
 *   "shaky"     - a window HAS closed, but at least one integrity problem
 *                 remains unresolved: contamination, a weak comparison group,
 *                 an overlapping shock/seasonal swing, thin sample, or an
 *                 accidental edit overlap.
 *   "decent"    - one soft caveat only (an early/interim checkpoint that is
 *                 otherwise clean, or a mature result whose sample clears the
 *                 mature-eligibility floor but not the deeper "high
 *                 confidence" floor) - trustworthy enough to act on, not yet
 *                 the final word.
 *   "solid"     - mature, clean attribution, a DEEP sample (the same floor
 *                 measurement-maturity.ts's maturityConfidence() requires for
 *                 "high" presentation confidence), and (when a permutation-
 *                 null read exists) the untouched-page comparison agrees this
 *                 is not just noise.
 *
 * Pinned by verdict-reliability.test.ts.
 */

import type {
  MeasurementMaturity,
  MeasurementPresentation,
} from "./measurement-maturity";

export type VerdictReliabilityGrade = "solid" | "decent" | "shaky" | "too early";

export type VerdictReliabilityInput = {
  maturity: MeasurementMaturity;
  /** The window this read is judged from (7/14/28), or null when nothing has
   *  closed yet. Mirrors MeasurementPresentation.basisDay. */
  basisDay: 7 | 14 | 28 | null;
  /** True while Google's index has not yet been observed holding the new
   *  content (N11). Mirrors MeasurementPresentation.recrawlPending. */
  recrawlPending: boolean;
  /** True when a comparison page changed mid-window and no clean substitute
   *  was available (N13). Mirrors MeasurementPresentation.controlContaminationFlagged. */
  controlContaminationFlagged: boolean;
  /** True when the comparison pages were not moving like the treated page
   *  before the change. Mirrors MeasurementPresentation.weakComparisonFlagged. */
  weakComparisonFlagged: boolean;
  /** True when this window overlapped a confirmed Google update or a
   *  detected sitewide shock. Mirrors MeasurementPresentation.weatherQuarantined. */
  weatherQuarantined: boolean;
  /** True when this window overlapped a detected seasonal demand swing for
   *  the page's family. Mirrors MeasurementPresentation.seasonalInflectionFlagged. */
  seasonalInflectionFlagged: boolean;
  /** True when another edit touches the same page within this measurement
   *  window - EITHER an accidental overlap (attributionQuality "limited") OR
   *  an intentional package shipped together (attributionQuality "compound").
   *  Both weaken single-change attribution the same way learningEligibility
   *  treats them: only a lone, "clean" change may train ranking priors. */
  attributionShared: boolean;
  /** Comparison pages actually used in the basis window (diff-in-diff
   *  comparators). Mirrors the same MIN_CONTROLS_FOR_MATURE floor
   *  measurement-maturity.ts uses for "mature_result" sufficiency. */
  controlsUsed: number;
  /** Treated-page baseline impressions. Mirrors MIN_BASELINE_FOR_MATURE. */
  baselineImpressions: number;
  /** Optional permutation-null read (master plan item 37): when present,
   *  "solid" additionally requires the untouched-page comparison to agree
   *  this is not normal noise (nGreater / nTotal <= 0.05, the same threshold
   *  the card's own plain sentence uses). Absent/null - permutation read is
   *  simply not required (a caller that never wires this sees the grade
   *  computed from everything else, unchanged). */
  permutationRead?: { nGreater: number; nTotal: number } | null;
  /** Interference guard (master plan N14): true when interference-graph.ts
   *  found at least one significant edge (a directly linked page, a same-
   *  template-family page, or overlapping search demand still measuring;
   *  or a sitewide shock) overlapping this ship's window that the OTHER
   *  feeders above did not already catch. Additive - a caller that never
   *  wires this (the default, undefined) sees byte-identical grades to
   *  before this field existed. Deliberately named distinctly from
   *  controlContaminationFlagged/weatherQuarantined/attributionShared so a
   *  caller that already computed one of those from the SAME interference
   *  graph (e.g. a sitewide shock is also surfaced via weatherQuarantined)
   *  is never double-penalized for restating it here - pass this only for
   *  interference NOT already covered by the other flags. */
  interferenceFlagged?: boolean;
  /** Fixed query panel (P4 R10a, v1 item 150): true when the frozen
   *  target-query panel moved meaningfully OPPOSITE to the page-level read
   *  (QueryPanelOutcome.disagreesWithPage). Two lenses on the same window
   *  pointing different ways means something else on the page is moving the
   *  page total - demotes to shaky. Additive: a caller that never wires this
   *  (the default) sees byte-identical grades. */
  panelDisagrees?: boolean;
  /** Novelty-decay flag (P4 R10a, v1 item 378): true when the lift peaked in
   *  week 1 and faded back toward baseline by week 4 (NoveltyDecayRead
   *  .noveltyDecay). A first-week jump that did not last should never read as
   *  a trustworthy win - demotes to shaky. Additive, same posture as above. */
  noveltyDecay?: boolean;
  /** Adaptive-window flag (P4 R10a, v1 item 288): true when every recent
   *  post-ship day is far outside the page's normal range in one direction
   *  (EarlySignalRead.earlyDecisive). NEVER upgrades a read past "decent" -
   *  the 28-day clock is inviolable and "solid" stays mature-only; this only
   *  strengthens the decent sentence so an unmistakable early read is not
   *  presented with the same hedging as a marginal one. Additive. */
  earlyDecisive?: boolean;
  /** Equivalence read (P4 R10b, v1 item 289): true when the plausible effect
   *  range of a closed 28 day window is PROVEN to sit inside the too-small-
   *  to-matter band (EquivalenceRead.provenNeutral). A proven "did nothing"
   *  is a reliable LESSON, categorically different from an inconclusive "do
   *  not know" - grades solid-for-learning even though the change did not
   *  win. Only read with basisDay 28, and never rescues a read any shaky
   *  disqualifier above already caught. Additive: a caller that never wires
   *  this sees byte-identical grades. */
  provenNeutral?: boolean;
  /** Many-measurements caution (P4 R10b, v1 item 291): true when this win
   *  cleared its own bar but lost the pool-wide adjustment across all
   *  simultaneous mature wins (FdrRead.fdrCaution). Demotes a would-be solid
   *  win to decent - hold the champagne. Additive, same posture as above. */
  fdrCaution?: boolean;
  /** How many mature wins were adjusted together, for the honest sentence
   *  ("with 12 changes measured at once"). Only read when fdrCaution. */
  fdrPoolSize?: number;
};

export type VerdictReliabilityResult = {
  grade: VerdictReliabilityGrade;
  /** Plain-English reasons, most important first. Empty only for a clean
   *  "solid" read with a permutation confirmation (the sentence covers it). */
  reasons: string[];
  /** One first-person sentence combining the grade and its top reason(s),
   *  e.g. "I would treat this read as solid: 28 days mature, clean
   *  comparisons, enough traffic to mean something." No dashes. */
  sentence: string;
};

/** Same floors buildMeasurementPresentation() uses for "mature_result"
 *  sufficiency - kept in sync deliberately so this grade never disagrees
 *  with maturity about what counts as enough sample. */
const MIN_CONTROLS_FOR_MATURE = 2;
const MIN_BASELINE_FOR_MATURE = 200;
/** Below this, even a technically-sufficient sample reads as "thin" for the
 *  softer "decent" tier - the SAME high-confidence floor maturityConfidence()
 *  uses in measurement-maturity.ts, so "solid" lines up with a mature result
 *  that also earned "high" presentation confidence, not merely "medium". */
const DECENT_BASELINE_FLOOR = 3000;
const DECENT_CONTROLS_FLOOR = 3;
/** Permutation-null "this is not noise" threshold - mirrors the card's own
 *  plain sentence (page.tsx / permutation-null.ts) so the grade never
 *  contradicts what the card already says about the same number. */
const PERMUTATION_NOISE_THRESHOLD = 0.05;

function sampleIsAdequate(controlsUsed: number, baselineImpressions: number): boolean {
  return controlsUsed >= MIN_CONTROLS_FOR_MATURE && baselineImpressions >= MIN_BASELINE_FOR_MATURE;
}

function sampleIsThin(controlsUsed: number, baselineImpressions: number): boolean {
  return controlsUsed < DECENT_CONTROLS_FLOOR || baselineImpressions < DECENT_BASELINE_FLOOR;
}

function permutationAgrees(read: VerdictReliabilityInput["permutationRead"]): boolean | null {
  if (!read || read.nTotal <= 0) return null;
  return read.nGreater / read.nTotal <= PERMUTATION_NOISE_THRESHOLD;
}

/** The single grade resolver. PURE. Checked top to bottom: too early beats
 *  shaky beats decent beats solid, so any disqualifier always wins. */
export function gradeVerdictReliability(input: VerdictReliabilityInput): VerdictReliabilityResult {
  const reasons: string[] = [];

  // ── too early: nothing has had enough time/exposure to mean anything yet ──
  if (input.maturity === "scheduled") {
    return {
      grade: "too early",
      reasons: ["This change has not shipped yet."],
      sentence: "I would call this too early to read: this change has not shipped yet.",
    };
  }
  if (input.recrawlPending) {
    return {
      grade: "too early",
      reasons: ["Google has not re-read this page yet, so the search clock has not started."],
      sentence:
        "I would call this too early to read: Google has not re-read this page yet, so the search clock has not started.",
    };
  }
  if (input.basisDay == null) {
    return {
      grade: "too early",
      reasons: ["No checkpoint has closed yet."],
      sentence: "I would call this too early to read: no checkpoint has closed yet.",
    };
  }

  // ── shaky: a window closed, but an integrity problem is unresolved ──
  if (input.controlContaminationFlagged) {
    reasons.push("a comparison page changed mid-window and I could not find a clean replacement");
  }
  if (input.weakComparisonFlagged) {
    reasons.push("the comparison pages were not moving like this page before the change");
  }
  if (input.weatherQuarantined) {
    reasons.push("this window overlapped a Google update or a sitewide shift");
  }
  if (input.seasonalInflectionFlagged) {
    reasons.push("this window overlapped a seasonal demand swing for this page's family");
  }
  if (input.attributionShared) {
    reasons.push("another change touches this page within the same window");
  }
  if (input.interferenceFlagged) {
    reasons.push("a linked or same-family page still measuring could bleed into this result");
  }
  if (input.panelDisagrees) {
    reasons.push("the searches this change targeted moved the opposite way from the page total, so something else on the page is muddying this read");
  }
  if (input.noveltyDecay) {
    reasons.push("the first week jump faded back toward normal, so this looks like novelty, not a lasting win");
  }
  if (!sampleIsAdequate(input.controlsUsed, input.baselineImpressions)) {
    reasons.push("traffic is too thin to be confident yet");
  }
  const permutationVerdict = permutationAgrees(input.permutationRead);
  if (permutationVerdict === false) {
    reasons.push("pages I did not touch moved this much on their own, so this could be normal noise");
  }

  if (reasons.length > 0) {
    return {
      grade: "shaky",
      reasons,
      sentence: `I would treat this read as shaky: ${reasons.join(", ")}.`,
    };
  }

  // ── decent vs solid: both clean of the above; split on maturity + sample depth ──
  const daysLabel = `${input.basisDay} days`;

  // Equivalence read (P4 R10b, v1 289): a closed 28 day window whose whole
  // plausible effect range is PROVEN too small to matter is a reliable
  // lesson, distinct from inconclusive - solid-for-learning even though the
  // change did not win. Checked BEFORE the maturity split because a proven
  // neutral's stored verdict is usually not won/lost, so its maturity reads
  // "inconclusive" rather than "mature_result" - exactly the case this
  // distinguishes. Gated on basisDay 28 (bounds from a shorter window prove
  // nothing final) and never reached when any shaky disqualifier fired above.
  if (input.provenNeutral === true && input.basisDay === 28) {
    return {
      grade: "solid",
      reasons: [
        "28 days mature",
        "the plausible effect range is proven too small to matter",
        "the lesson is reliable even though the change did not win",
      ],
      sentence:
        "I would treat this read as solid: this change genuinely did nothing, and I can prove that now; that is different from not knowing. The lesson still counts.",
    };
  }

  if (input.maturity !== "mature_result") {
    // Adaptive-window read (v1 288): an unmistakable early direction earns a
    // stronger DECENT sentence, never a higher grade - the 28-day clock rules
    // are inviolable, so "solid" stays reserved for a mature result.
    if (input.earlyDecisive === true) {
      return {
        grade: "decent",
        reasons: [`only ${daysLabel} in, but every recent day is far outside this page's normal range`],
        sentence: `I would treat this read as decent: only ${daysLabel} in, but this is moving so clearly I do not need the full 28 days to tell you which way it is going. The final call still waits for the full window.`,
      };
    }
    const softReasons = [`only ${daysLabel} in, directional not final`];
    return {
      grade: "decent",
      reasons: softReasons,
      sentence: `I would treat this read as decent: ${daysLabel} in with clean comparisons, but not the final word yet.`,
    };
  }

  if (sampleIsThin(input.controlsUsed, input.baselineImpressions)) {
    const softReasons = ["the sample is adequate but not deep"];
    return {
      grade: "decent",
      reasons: softReasons,
      sentence: `I would treat this read as decent: ${daysLabel} mature and clean, but the sample is not deep enough to call it solid.`,
    };
  }

  // Many-measurements caution (P4 R10b, v1 291): this win cleared its own bar
  // but lost the pool-wide adjustment across every simultaneous mature win -
  // a would-be solid demotes to decent. Hold the champagne.
  if (input.fdrCaution === true) {
    const poolPhrase =
      input.fdrPoolSize != null && input.fdrPoolSize >= 2
        ? `with ${input.fdrPoolSize} changes measured at once`
        : "with several changes measured at once";
    return {
      grade: "decent",
      reasons: [
        "measured alongside many changes at once, this win sits close to the line where one of them looks good by chance",
      ],
      sentence: `I would treat this read as decent: ${poolPhrase}, one or two will look like winners by chance, and this one is close enough to that line that I am holding the champagne.`,
    };
  }

  if (permutationVerdict === null) {
    // No permutation-null read wired for this record - can't confirm against
    // untouched pages, but everything else is clean and sample is strong.
    return {
      grade: "solid",
      reasons: [`${daysLabel} mature`, "clean comparisons", "enough traffic to mean something"],
      sentence: `I would treat this read as solid: ${daysLabel} mature, clean comparisons, enough traffic to mean something.`,
    };
  }

  // permutationVerdict === true here (false already returned "shaky" above).
  return {
    grade: "solid",
    reasons: [`${daysLabel} mature`, "clean comparisons", "enough traffic to mean something", "untouched pages agree this is a real signal"],
    sentence: `I would treat this read as solid: ${daysLabel} mature, clean comparisons, enough traffic to mean something, and pages I did not touch rarely moved this much on their own.`,
  };
}

/** Convenience adapter: build the grade straight from a MeasurementPresentation
 *  plus the two sufficiency numbers and an optional permutation read, so a
 *  read site that already built the presentation (the /results card, fact-
 *  assembly.ts) never has to restate the six feeder flags by hand. PURE. */
export function gradeFromPresentation(
  pres: Pick<
    MeasurementPresentation,
    | "maturity"
    | "basisDay"
    | "recrawlPending"
    | "controlContaminationFlagged"
    | "weakComparisonFlagged"
    | "weatherQuarantined"
    | "seasonalInflectionFlagged"
    | "attributionQuality"
  >,
  sufficiency: { controlsUsed: number; baselineImpressions: number },
  permutationRead?: { nGreater: number; nTotal: number } | null,
  /** Interference guard (master plan N14): the caller's own
   *  interference-graph.ts read for this ship, when computed. Optional -
   *  omitted (the default) yields byte-identical grades to before this
   *  parameter existed. Pass `hasSignificantInterference` from
   *  computeInterferenceGraph, or false when the graph found nothing. */
  interferenceFlagged?: boolean,
  /** P4 R10a + R10b measurement-rigor extras, all optional and additive
   *  (omitting this argument yields byte-identical grades): the fixed-query-
   *  panel disagreement (v1 150, demotes to shaky), the novelty-decay flag
   *  (v1 378, demotes to shaky), the early-decisive flag (v1 288,
   *  strengthens the decent sentence, never upgrades the grade), the proven-
   *  neutral equivalence flag (v1 289, a closed 28 day window whose effect
   *  is proven too small to matter grades solid-for-learning), and the
   *  many-measurements caution (v1 291, demotes a would-be solid win to
   *  decent, with the pool count for the honest sentence). Read them
   *  straight off the record's computed attachments (panelOutcome /
   *  noveltyDecay / earlySignal / equivalence / fdrRead). */
  extras?: {
    panelDisagrees?: boolean;
    noveltyDecay?: boolean;
    earlyDecisive?: boolean;
    provenNeutral?: boolean;
    fdrCaution?: boolean;
    fdrPoolSize?: number;
  },
): VerdictReliabilityResult {
  return gradeVerdictReliability({
    maturity: pres.maturity,
    basisDay: pres.basisDay,
    recrawlPending: pres.recrawlPending,
    controlContaminationFlagged: pres.controlContaminationFlagged,
    weakComparisonFlagged: pres.weakComparisonFlagged,
    weatherQuarantined: pres.weatherQuarantined,
    seasonalInflectionFlagged: pres.seasonalInflectionFlagged,
    attributionShared: pres.attributionQuality !== "clean",
    controlsUsed: sufficiency.controlsUsed,
    baselineImpressions: sufficiency.baselineImpressions,
    permutationRead: permutationRead ?? null,
    interferenceFlagged: interferenceFlagged ?? false,
    panelDisagrees: extras?.panelDisagrees ?? false,
    noveltyDecay: extras?.noveltyDecay ?? false,
    earlyDecisive: extras?.earlyDecisive ?? false,
    provenNeutral: extras?.provenNeutral ?? false,
    fdrCaution: extras?.fdrCaution ?? false,
    fdrPoolSize: extras?.fdrPoolSize,
  });
}

/** Should this grade be allowed to train ranking priors? Kept in sync with
 *  MeasurementPresentation.learningEligibility by construction: every
 *  disqualifier learningEligibility checks (maturity, attribution, weather,
 *  weak comparison, seasonal, recrawl, contamination) is also a "shaky" or
 *  "too early" disqualifier here, so solid/decent is a superset-safe proxy -
 *  never wider than the real learningEligibility gate, with ONE deliberate
 *  exception (P4 R10b, v1 289): a proven-neutral 28 day read grades solid
 *  even though its maturity reads "inconclusive" (verdict not won/lost), so
 *  the reliable "this lever did nothing here" LESSON can train priors. Every
 *  integrity disqualifier still demotes it to shaky first. Exposed so a
 *  caller that only has the grade (not the full presentation) can still
 *  apply the same "only solid/decent train priors" rule without re-deriving
 *  it. */
export function gradeAllowsLearning(grade: VerdictReliabilityGrade): boolean {
  return grade === "solid" || grade === "decent";
}
