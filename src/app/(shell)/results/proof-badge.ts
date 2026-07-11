import type { MeasurementPresentation } from "@/domains/proof-gsc/measurement-maturity";
import { displayProofOutcome, type CalibratableRecord } from "@/domains/proof-gsc/verdict-calibration";

/**
 * proof-badge (operator-experience fix batch C, item C2) - collapses the
 * measurement-maturity domain's rich internal vocabulary (Collecting data,
 * Too early to call, Early positive signal, Interim negative signal, Waiting
 * for Google data, Directional only, and more) down to exactly SIX words a
 * reader can hold in their head:
 *
 *   Waiting        - any pre-verdict state (nothing final yet)
 *   Leaning good   - an early or interim read pointing positive
 *   Leaning bad    - an early or interim read pointing negative
 *   Helped         - final, positive
 *   Did not help   - final, negative
 *   No clear change - final, neither
 *
 * Display mapping ONLY. The domain's MeasurementMaturity enum, tone, and
 * headline strings are untouched (still pinned by measurement-maturity.test.ts)
 * - this module reads them and picks a plain word, it never writes them back.
 * The precise internal state (pres.headline, pres.explanation) still renders
 * inside the expanded card detail so nothing honest is lost, just not
 * shouted at the reader in fifteen different ways.
 */

export type ProofBadge = "Waiting" | "Leaning good" | "Leaning bad" | "Helped" | "Did not help" | "No clear change";

export function proofBadgeLabel(pres: Pick<MeasurementPresentation, "maturity" | "direction" | "verdict">): ProofBadge {
  const { maturity, direction, verdict } = pres;

  if (maturity === "mature_result") {
    if (verdict === "helped") return "Helped";
    if (verdict === "did_not_help") return "Did not help";
    return "No clear change";
  }
  if (maturity === "inconclusive") return "No clear change";

  if (maturity === "early_checkpoint" || maturity === "interim_checkpoint" || maturity === "attribution_limited") {
    if (direction === "positive") return "Leaning good";
    if (direction === "negative") return "Leaning bad";
    return "Waiting";
  }

  // scheduled / collecting / blocked_data - nothing to lean on yet.
  return "Waiting";
}

/**
 * Secondary text for the badge: when still pre-verdict, name the date the
 * next checkpoint opens (the "the date it matures as secondary text" spec).
 * Null once a final verdict exists (Helped / Did not help / No clear change),
 * there is nothing left to wait for.
 */
export function proofBadgeMaturesOn(pres: Pick<MeasurementPresentation, "maturity" | "nextCheckpoint">): string | null {
  if (pres.maturity === "mature_result" || pres.maturity === "inconclusive") return null;
  return pres.nextCheckpoint ? `matures ${pres.nextCheckpoint}` : null;
}

/** Same collapse, for the legacy proofMaturityLabel fallback path (no
 *  MeasurementPresentation available - pre-Move-2 records). Verdict is the
 *  stored ShippedChangeRecord verdict; basisDay is the latest ran window. */
export function proofBadgeLabelFromVerdict(verdict: string, basisDay: number | null): ProofBadge {
  if (verdict === "won") return basisDay != null && basisDay < 28 ? "Leaning good" : "Helped";
  if (verdict === "lost") return basisDay != null && basisDay < 28 ? "Leaning bad" : "Did not help";
  if (verdict === "inconclusive") return "No clear change";
  return "Waiting"; // measuring / insufficient_data / stale
}

/**
 * Fail-closed calibration quarantine (2026-07-11): true when a record's stored
 * won/lost is UNCALIBRATED (measured under thresholds that failed Beacon's
 * self-test). The card must then render the neutral "No clear change" badge, never
 * "Helped"/"Did not help", and a neutral pill tone, never red/green. Reads the
 * shared selector (verdict-calibration.ts). Today this is true for every won/lost.
 */
export function isUncalibratedDecidedRecord(record: CalibratableRecord): boolean {
  return displayProofOutcome(record).kind === "no_clear_effect_uncalibrated";
}

/**
 * Fail-closed calibration quarantine, review fix 1 (2026-07-11): the verdict a
 * Results card's PRESENTATION must be built from. An uncalibrated won/lost reads
 * as "inconclusive" so buildMeasurementPresentation yields exactly the neutral
 * presentation a mature inconclusive row gets (direction neutral, "No clear
 * result" headline, neutral tone, neutral grade sentence) - never "This helped."
 * or "Likely helping (high confidence)" off a quarantined verdict. A calibrated
 * or non-decided verdict passes through untouched. The STORED verdict is never
 * changed; this only shapes what the card says.
 */
export function presentationVerdictFor(record: CalibratableRecord): string {
  return isUncalibratedDecidedRecord(record) ? "inconclusive" : record.verdict;
}
