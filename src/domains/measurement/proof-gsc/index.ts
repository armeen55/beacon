/**
 * Measurement kernel (proof-gsc) — public facade.
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
  KernelWindowRead,
  KernelInput,
  KernelRead,
  LedgerRecordLike,
} from "./kernel";
export {
  MIN_CONTROLS,
  GSC_LAG_DAYS,
  metricFor,
  addDays,
  evaluateWindows,
  detectOverlaps,
  verdictPhrase,
  evaluateChange,
  rankingPriors,
  toKernelInput,
  readLedger,
  bandOf,
  splitReads,
  windowStateLine,
  learningVerdictOf,
  readRecordsForLearning,
  loadKernelLedger,
} from "./kernel";

// Read honesty: the group read for overlapping same-page changes
export type { BundleRead } from "./read-honesty";
export { bundleReads } from "./read-honesty";

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
  pagesUnderMeasurementFromShipments,
} from "./shipped-change-store";

// Weekly recap signal
export type { RecapRow } from "./weekly-recap";
export { shippedInLastDays } from "./weekly-recap";

// Verdict schedule
export type { VerdictScheduleRow, VerdictSchedule } from "./verdict-schedule";
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
} from "./measure-pass";
