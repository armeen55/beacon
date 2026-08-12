/**
 * Shared persisted measurement types (CORE 100K). Leaf module: NO imports, so
 * the store, the GSC reader, and the measure pass can all depend on it without a
 * cycle. These describe what is stored on a shipped-change record; the verdict
 * math itself lives in kernel.ts.
 */

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
  treatedPostImpressions?: number;
  treatedImpressionsDelta?: number;
  controlImpressionsDelta?: number;
  adjustedImpressionsLift?: number;
};

/** The baseline snapshot stored on a record (display + kernel input). */
export type ProofBaseline = GscWindowMetrics & { windowDays: number };

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
 */
export type MeasurementState =
  | "measuring" | "measurement_unavailable" | "insufficient_comparison" | "verification_needed";
