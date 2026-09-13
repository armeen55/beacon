/** Cross-surface counts from full-ledger reads: history stays visible;
 * only qualified applied units count as wins. Revert bookkeeping is not a new treatment. */
import { bandOf, readRecordsForLearning, type LedgerRecordLike } from "@/domains/measurement/proof-gsc/kernel";

/** The minimal shape of a shipped-change ledger row this module needs - structurally
 *  satisfied by ShippedChangeRecord (proof-gsc/shipped-change-store.ts). */
export type LedgerLifecycleRow = {
  id: string;
  path: string;
  page?: string;
  shippedAt: string;
  /** THE STAMP the measurement windows count from, on every Shipment. Optional so a
   *  legacy row still reads exactly as it did, counting from its ship date. */
  implementedAt?: string | null;
  /** The live check, when one ran: only a change confirmed on the page may file as a win. */
  verification?: LedgerRecordLike["verification"];
  before?: LedgerRecordLike["before"]; after?: LedgerRecordLike["after"];
  componentsApplied?: LedgerRecordLike["componentsApplied"];
  controlsReceipt?: LedgerRecordLike["controlsReceipt"];
  measurementState?: string | null;
  verdict: string;
  windows: ReadonlyArray<{
    day: number;
    ran: boolean;
    controlsUsed?: number | null;
    adjustedLift?: number;
    adjustedCtrLift?: number;
    adjustedPosLift?: number;
    adjustedImpressionsLift?: number;
    treatedPostImpressions?: number;
  }>;
  baseline?: { impressions?: number | null; clicks?: number | null } | null;
  /** The frozen finished reading, passed through UNTOUCHED so these counts serve the same tuple
   *  /results serves. Unknown-typed on purpose: Decision never reads inside a Measurement record. */
  pinnedRead?: unknown;
  /** Bug #14 (2026-07-06): a revert executor records "the old version was put back" as
   *  its OWN ledger row with actionType `revert_<original>` (run-revert.ts). That row is
   *  bookkeeping, NOT a distinct operator change - excludeRevertBookkeeping below drops
   *  it from every count so a ship + its revert reads as ONE change, never two. Optional:
   *  a legacy row without actionType is treated as a real change (never a false drop). */
  actionType?: string | null;
  /** 2026-07-11 quarantine: the classifier version behind this verdict, or null
   *  (uncalibrated). Optional so a legacy/partial row reads as null -> fail-closed:
   *  a mature won/lost measured under the failed self-test lands in the measuring
   *  bucket, never "won"/"learned". Carried straight off ShippedChangeRecord. */
  calibrationVersion?: string | null;
};

/** The prefix run-revert.ts stamps on a revert's own ledger row's actionType
 *  (REVERT_ACTION_PREFIX). Kept here as a pure constant so the count choke point never
 *  reaches into the server-only revert executor. */
const REVERT_LEDGER_ACTION_PREFIX = "revert_";

/** True for the ledger row OF a revert itself (revert_edit_title, revert_edit_meta, ...).
 *  Pure; mirrors run-revert.ts's isRevertRecord without importing that server-only module. */
function isRevertLedgerRow(row: Pick<LedgerLifecycleRow, "actionType">): boolean {
  return (row.actionType ?? "").startsWith(REVERT_LEDGER_ACTION_PREFIX);
}

/**
 * Bug #14 - drop revert bookkeeping rows before ANY count or overlap detection. A revert both double-counts (a second shipped-change row for one underlying change)
 * AND poisons overlap detection (its same-path ship flags the original as attribution limited), so it must be removed at the single choke point every surface reads from.
 * The genuine measurement history is untouched: the ORIGINAL row (with its restored- version note) stays; only the revert's own `revert_*` row is filtered. Returns the
 * SAME array reference when there is nothing to drop, so a no-revert ledger is byte identical (no re-sort, no new object).
 */
function excludeRevertBookkeeping<T extends Pick<LedgerLifecycleRow, "actionType">>(
  rows: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return rows.some(isRevertLedgerRow) ? rows.filter((r) => !isRevertLedgerRow(r)) : rows;
}

export type LedgerLifecycleStage = "won" | "learned" | "measuring";

/** Map a lifecycle row to the kernel's ledger-record shape. Full records already
 *  carry every field; a minimal row falls back to safe defaults. */
function toLedgerRecordLike(row: LedgerLifecycleRow): LedgerRecordLike & { operatorVerdictOverride?: string | null; pinnedRead?: unknown } {
  return {
    id: row.id,
    page: row.page ?? row.path,
    path: row.path,
    actionType: row.actionType ?? "change",
    shippedAt: row.shippedAt,
    implementedAt: row.implementedAt ?? null,
    verification: row.verification ?? null, before: row.before, after: row.after, componentsApplied: row.componentsApplied,
    controlsReceipt: row.controlsReceipt, measurementState: row.measurementState,
    baseline: { impressions: row.baseline?.impressions ?? 0, clicks: row.baseline?.clicks ?? 0 },
    pinnedRead: row.pinnedRead ?? null,
    windows: row.windows.map((w) => ({
      day: w.day,
      ran: w.ran,
      adjustedLift: w.adjustedLift,
      adjustedCtrLift: w.adjustedCtrLift,
      adjustedPosLift: w.adjustedPosLift,
      adjustedImpressionsLift: w.adjustedImpressionsLift,
      controlsUsed: w.controlsUsed ?? 0,
      treatedPostImpressions: w.treatedPostImpressions,
    })),
  };
}

type LedgerLifecycleSplit<T> = { won: T[]; promising: T[]; learned: T[]; measuring: T[] };

/**
 * Split a whole ledger into the three Results bands - the ONE band membership rule, from the SAME kernel read the Results page renders (bandOf). Results renders
 * these arrays directly and countLedgerLifecycle counts them, so a band heading count and a cross-surface count can never diverge.
 */
export function splitLedgerLifecycle<T extends LedgerLifecycleRow>(
  rows: ReadonlyArray<T>,
  now: Date = new Date(),
): LedgerLifecycleSplit<T> {
  // Bug #14 - filter revert bookkeeping FIRST so it neither double-counts nor poisons same-page overlap detection (a revert's ship must not flag the original it
  // restored as attribution limited). No-revert ledgers pass through untouched.
  const real = excludeRevertBookkeeping(rows);
  const reads = readRecordsForLearning(real.map(toLedgerRecordLike), now);
  const out: LedgerLifecycleSplit<T> = { won: [], promising: [], learned: [], measuring: [] };
  // A WIN NOBODY CONFIRMED ON THE LIVE PAGE IS NOT A WIN (operator, 2026-09-01): Today printed "6 wins" and Changes "6 clear wins" off
  // reads whose live page was never read back, beside a Results page saying nothing was verified. A finished improving read files as
  // won only when the change was confirmed live; otherwise it is finished context and counts with what was learned.
  real.forEach((row, i) => { const band = bandOf(reads[i]); out[band === "won" && reads[i].learning.eligible !== true ? "learned" : band].push(row); });
  return out;
}

/** THE ONE PROOF NUMBER A LEDGER ROW CAN PRINT. "It worked" beside a page name is a verdict with nothing behind it,
 *  and the row already carries the read: the newest window that actually ran, against the comparison pages nobody
 *  changed. Null while a change is still collecting, which is the honest answer. PURE; the STORED lift, never re-derived. */
export function ledgerProofLine(row: Pick<LedgerLifecycleRow, "windows">): string | null {
  const read = [...row.windows].filter((w) => w.ran && (w.controlsUsed ?? 0) > 0 && w.adjustedLift != null).sort((a, b) => b.day - a.day)[0];
  const lift = read ? Math.round(read.adjustedLift!) : null;
  return lift == null ? null : lift === 0 ? "clicks level with similar pages that were not changed" : `clicks ${lift > 0 ? `+${lift}` : lift} against similar pages that were not changed`;
}

/** The three ledger-derived counts, from the same split Results renders. */
export function countLedgerLifecycle(
  rows: ReadonlyArray<LedgerLifecycleRow>,
  now: Date = new Date(),
): { measuring: number; decided: number; won: number } {
  const split = splitLedgerLifecycle(rows, now);
  return {
    // A promising (pre-28-day) improvement is still in flight, never decided.
    measuring: split.measuring.length + split.promising.length,
    decided: split.won.length + split.learned.length,
    won: split.won.length,
  };
}
