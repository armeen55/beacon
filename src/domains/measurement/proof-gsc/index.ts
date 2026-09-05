/**
 * Measurement kernel (proof-gsc) - public facade.
 *
 * This kernel owns the honest measurement: reading GSC windows, evaluating a
 * shipped change against its controls, and producing a verdict + ranking
 * signal. This index is the ONLY surface `src/app` and the other kernels may
 * import. Internal files (kernel math, measure-pass, gsc-window, the control
 * resolution under ./internal) stay private.
 */

// Kernel: verdicts, reads, ranking signal
export type {
  KernelVerdict,
  KernelMetric,
  KernelInput,
  KernelRead,
  LedgerRecordLike,
} from "./kernel";
export {
  MIN_CONTROLS,
  GSC_LAG_DAYS,
  metricFor,
  isMature,
  addDays,
  evaluateWindows,
  verdictPhrase,
  evaluateChange,
  rankingPriors,
  toKernelInput,
  readLedger,
  bandOf,
  learningVerdictOf,
  readRecordsForLearning,
  loadKernelLedger,
} from "./kernel";

// Ledger loading
export {
  loadProofLedger,
  loadProofLedgerPersisted,
  loadProofLedgerCached,
} from "./load-ledger";

// Shipped-change store (the canonical Shipment)
export type { ShippedChangeRecord, ShipmentVerification } from "./shipped-change-store";
export {
  loadShippedChanges,
  loadShippedChangesForTenant,
  upsertShippedChange,
  recordVerification,
  recordPinnedRead,
  pagesUnderMeasurementFromShipments,
} from "./shipped-change-store";

// The finished reading, held still, and the corrections that never overwrite it
export type { PinnedRead } from "./pinned-read";
export { pinFor, applyPinnedRead, withCorrection } from "./pinned-read";

// THE ONE COMPARISON POLICY: who may stand behind a change, and why they qualified
export type { ControlReceipt } from "./contamination";
export { contaminationFor, selectMatchedControls } from "./contamination";

// Verdict schedule
export type { VerdictScheduleRow } from "./verdict-schedule";
export { verdictSchedule } from "./verdict-schedule";

// Change <-> proof linking (surface navigation)
export { findProofForChange, proofResultHref } from "./change-proof-link";

// GSC window reads
export {
  readCumulativeSince,
  readLastFinalizedDate,
  readWindowForPages,
} from "./gsc-window";

// On-use auto measurement scheduling
export { scheduleAutoMeasure } from "./auto-measure-on-use";

// Measure pass (record + measure + capture control meta)
export {
  defaultPacificShipDate,
  measureRecord,
  captureChangeMeta,
  recordShippedChange,
  selectControlPages,
  matchedControlsFor,
  openChangePaths,
} from "./measure-pass";

// THE RECORDING SEAM: implementation truth is stored always, measurement availability travels beside it
export type { MeasurementState } from "./types";
export type { RecordedShipment } from "./record-shipment";
export { recordShipment, recordRepairShipment } from "./record-shipment";
