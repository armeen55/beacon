/**
 * Measurement kernel — public facade.
 *
 * Owns honest measurement: the proof-gsc sub-kernel (verdicts, ledger,
 * shipped-change store, GSC windows, auto-measure), the scoreboard + money
 * line, revenue-by-day, URL-change attribution, and the Today command. This
 * index is the ONLY surface `src/app` and `src/components` may import for VALUE
 * imports. Internal files stay private.
 */

// Proof-gsc sub-kernel (re-exported through its own facade)
export {
  loadProofLedger,
  loadProofLedgerPersisted,
  loadProofLedgerCached,
  loadShippedChanges,
  upsertShippedChange,
  shippedInLastDays,
  verdictSchedule,
  findProofForChange,
  proofResultHref,
  readLastFinalizedDate,
  readLedger,
  verdictPhrase,
  windowStateLine,
  bundleReads,
  splitReads,
  scheduleAutoMeasure,
  defaultPacificShipDate,
  measureRecord,
  captureChangeMeta,
  recordShippedChange,
  type KernelRead,
  type BundleRead,
  type ShippedChangeRecord,
} from "./proof-gsc";

// Scoreboard + money line
export { buildScoreboard, buildMoneyLine, type Scoreboard } from "./scoreboard/scoreboard";

// Revenue-by-day
export { loadRevenueByDayForTenant } from "./revenue/load-revenue";

// URL-change attribution
export {
  getWatchingUrlOutcomes,
  ensureUrlChangeOutcomesSeeded,
} from "./attribution/url-change-outcome";

// Today command
export { buildTodayCommand, commandAllowsCelebration } from "./today/today-command";
