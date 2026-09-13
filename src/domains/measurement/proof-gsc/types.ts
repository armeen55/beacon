import { SHIPMENT_PROOF } from "./shipment-proof";

export type GscWindowMetrics = {
  clicks: number;
  impressions: number;
  /** 0 to 1. */
  ctr: number;
  /** Impressions-weighted average position over the window. */
  position: number;
};

/** The measurement cadence: 7 / 14 / 28 days after the stamp, plus the CONDITIONAL day-56
 *  follow up an unsettled or dangerous change earns (measure-lifecycle owns that rule, and
 *  it is the reason 56 is not part of the standard cadence below). */
export type ProofWindowDay = 7 | 14 | 28 | 56;
export const PROOF_WINDOW_DAYS: Array<7 | 14 | 28> = [7, 14, 28];
/** The pre-ship baseline window the diff in diff pro-rates from. */
export const BASELINE_WINDOW_DAYS = 28;

/** Stored verdict vocabulary (persisted on the record for backward reads; the
 *  kernel recomputes the live directional read from the window deltas). */
export type GscProofVerdict = "measuring" | "won" | "lost" | "inconclusive" | "insufficient_data";
export type GscProofConfidence = "high" | "medium" | "low";

/** One window's stored observational diff in diff across all Search metrics. */
export type ProofWindowResult = {
  day: ProofWindowDay;
  /** YYYY-MM-DD the window closes (shippedAt + day). */
  checkOn: string;
  /** True once that window has finalized GSC data to read. */
  ran: boolean;
  treatedDelta: number;
  controlDelta: number;
  /** treated minus control clicks lift. */
  adjustedLift: number;
  treatedCtrDelta: number;
  controlCtrDelta: number;
  adjustedCtrLift: number;
  treatedPosDelta: number;
  controlPosDelta: number;
  adjustedPosLift: number;
  controlsUsed: number;
  /** TRUE where the comparison was the site's own movement, because too few untouched pages matched. Absent on every matched-page reading. */
  comparedToSite?: boolean;
  treatedPostImpressions?: number;
  treatedImpressionsDelta?: number;
  controlImpressionsDelta?: number;
  adjustedImpressionsLift?: number;
};

/** The baseline snapshot stored on a record (display + kernel input). */
export type ProofBaseline = GscWindowMetrics & { windowDays: number };

/** How many untouched pages have to stand behind a reading before it may be read as this change's own movement. Declared HERE, with the stored window it is asked of, so the verdict kernel, the pooled treatment summaries, the ranking feedback and Results measure one reading against one number. */
export const MIN_CONTROLS = 2;
/** THE ONE ELIGIBILITY VERDICT, and there is no second one. It used to be written twice: the kernel filed `insufficient_evidence` under MIN_CONTROLS while the learner accepted any window with a single comparison page, so five live readings the screen called unreadable were teaching the ranking their comparison's own 75 click fall. FOUR ANSWERS, KEPT APART, because they are four different facts: `unavailable` is nothing closed to read against, `unknown` is a reading that ran and cannot be separated from the rest of the site, `confounded` is a reading whose only comparison WAS the rest of the site, and `eligible` is a reading this account may learn from. A MEASURED ZERO IS NONE OF THE THREE: it is an eligible reading whose answer is nothing, which is evidence about a treatment and not an absence of evidence. PROVENANCE IS NEVER INVENTED: a row that says it used comparison pages and holds no record of which ones cannot support a lesson, so it reads `unknown`; a caller holding no comparison record refuses nothing on it, and a row from before that record existed (no implementation stamp) was never owed one. */
export function learningEligibility(w: { ran?: boolean; controlsUsed?: number; comparedToSite?: boolean } | null | undefined,
  row: Parameters<typeof SHIPMENT_PROOF.of>[0] & { measurementState?: string | null; controlsReceipt?: readonly unknown[] | null } = {}): "eligible" | "unknown" | "unavailable" | "confounded" {
  if (w == null || w.ran === false || row.measurementState === "measurement_unavailable") return "unavailable";
  if ("verification" in row && !SHIPMENT_PROOF.of(row)) return "unknown";
  if (row.measurementState === "insufficient_comparison") return "unknown";
  if (w.comparedToSite === true) return "confounded";
  const used = w.controlsUsed ?? 0;
  return used < MIN_CONTROLS || (row.implementedAt != null && (row.controlsReceipt?.length ?? 0) < used) ? "unknown" : "eligible";
}

/** WHAT KIND OF WORK THIS WAS, in the four facts that are only all in hand at the press: the family the change belongs to, the treatment the producing pass chose, the field it lands on and the cause it was raised against. STRUCTURAL, four plain strings, because Measurement may never name a Decision type and because grouping readings by kind is exactly what nothing here could do before: the one place that asked what this account's own history said read the coarse action family alone, so an answer block added because assistants never read the page and an answer block added because the opening buried the answer counted as the same bet. Stamped at mark time and never re-derived; a row that predates the stamp has the little of it that its own stored fields can honestly carry, and never a guess. */
export type TreatmentSignature = { family: string; treatment: string | null; field: string | null; cause: string | null };

/**
 * WHETHER THIS SHIPMENT CAN BE FAIRLY COMPARED, stored on the row beside the implementation
 * itself. AN IMPLEMENTATION FACT IS A FACT: what the operator applied is recorded whatever the
 * data situation is, and this says, in one word, why a reading may not follow. Recording never
 * waits on it and never refuses because of it.
 *
 *   measuring               controls, baseline and finalized Search data are all on file.
 *   measurement_unavailable Search Console has nothing on file to read this page against.
 *   insufficient_comparison the site was read, but too few untouched pages can stand behind it.
 *   verification_needed     recorded from operator-supplied facts, so no before-state is held
 *                           and the live page has not been read: the check compares forward only.
 *                           Cleared on read the moment that check confirms (shipped-change-store).
 */
export type MeasurementState =
  | "measuring" | "measurement_unavailable" | "insufficient_comparison" | "verification_needed";
