/**
 * Measurement kernel: the public facade.
 *
 * Owns honest measurement: the proof-gsc sub-kernel (verdicts, ledger,
 * shipped-change store, GSC windows, auto-measure), the scoreboard + money
 * line, revenue-by-day, URL-change attribution, and the Today command. This
 * index is the ONLY surface `src/app` and `src/components` may import for VALUE
 * imports. Internal files stay private.
 */

// Proof-gsc sub-kernel (re-exported through its own facade)
export {
  isMature,
  loadProofLedger,
  loadProofLedgerPersisted,
  loadProofLedgerCached,
  loadShippedChanges,
  loadShippedChangesForTenant,
  upsertShippedChange,
  recordVerification,
  recordPinnedRead,
  pinFor,
  applyPinnedRead,
  pagesUnderMeasurementFromShipments,
  verdictSchedule,
  findProofForChange,
  proofResultHref,
  readLastFinalizedDate,
  readLedger,
  verdictPhrase,
  scheduleAutoMeasure,
  defaultPacificShipDate,
  measureRecord,
  captureChangeMeta,
  recordShippedChange,
  recordShipment,
  recordRepairShipment,
  selectControlPages,
  matchedControlsFor,
  contaminationFor,
  withCorrection,
  MIN_CONTROLS,
  type MeasurementState,
  type RecordedShipment,
  type KernelRead,
  type ShippedChangeRecord,
  type ShipmentVerification,
  type PinnedRead,
  type ControlReceipt,
} from "./proof-gsc";

// WHAT EACH KIND OF WORK HAS ACTUALLY RETURNED HERE, and the shrunk record the ranking eats. Pure.
export { signatureOfShipment, treatmentLearning, learningFromShipments, type TreatmentGroup } from "./treatment-learning";

// AI outcomes: the daily trend over stored answers, and what they did around one shipped change
export {
  aiOutcomes,
  visibilitySeries,
  type AiOutcomeReport,
} from "./ai-outcomes";

// One shipment's own AI answers, on its own searches, judged on the objective it declared
export {
  aiOutcomeForShipment,
  aiOutcomesForShipments,
  objectiveOfStage,
  type ShipmentAiOutcome,
  type ShipmentObjective,
} from "./shipment-ai-outcome";

// Scoreboard + money line
export { verifyShipmentNow } from "./verify-shipment";
export { buildScoreboard, buildMoneyLine, type Scoreboard } from "./scoreboard/scoreboard";

// Revenue-by-day
export { loadRevenueByDayForTenant } from "./revenue/load-revenue";

