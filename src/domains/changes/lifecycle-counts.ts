/**
 * lifecycle-counts (2026-07-02, FP3 - "the app contradicts itself") - THE one place a
 * lifecycle-stage count is computed. PURE, no I/O; the app-side loader
 * (src/app/(shell)/lifecycle-counts-data.ts) feeds it the canonical stores once per
 * request and every surface reads the result.
 *
 * THE ONE-COUNT RULE
 * ------------------
 * A shipped change is DECIDED exactly when its measurement is mature: the 28 day
 * window closed, the read had at least 2 comparison pages and 200 baseline
 * impressions, the stored verdict is "won" or "lost", and no overlapping edit on the
 * same page weakened attribution (deriveMeasurementMaturity === "mature_result",
 * the SAME resolver Results has always used to place a row in "Wins" or "What we
 * learned"). "won" is the subset of decided whose verdict is "won".
 *
 * EVERYTHING ELSE that has shipped is MEASURING: still collecting, an early 7 or 14
 * day read, waiting on Google data, a 28 day window that closed too thin to call,
 * or an attribution-limited overlap. This is the same set Results shows as
 * "In flight", so a link that promises "16 measuring" lands on a list showing 16,
 * never 25 (the FP3 killer finding).
 *
 * REVERTS ARE NOT CHANGES (bug #14, 2026-07-06): when a losing change is reverted,
 * the executor records "I put the old version back" as its OWN ledger row with
 * actionType `revert_<original>` (run-revert.ts). That row is bookkeeping, not a
 * distinct operator change, so splitLedgerLifecycle drops every `revert_*` row BEFORE
 * counting or overlap detection (excludeRevertBookkeeping). A ship + its revert reads
 * as ONE change everywhere, and the revert never inflates Wins. The genuine measurement
 * history survives: the ORIGINAL row (carrying its restored-version note) is kept.
 *
 * TONIGHT: picked = the active plan's selected changes (accepted plan first, else
 * the preview). applied = picked minus the items still waiting on the operator's
 * edit (ready_to_apply / verification_pending / verification_failed) - byte-for-byte
 * the same formula the "Tonight: N of M applied" progress bar on Today's checklist
 * uses (execution-checklist.ts summary.left), so the two can never disagree.
 *
 * TO DO: the canonical Changes list's own open count (changes-data.ts summary.todo,
 * computed after fusion + dedupe). It is threaded through here so it comes from one
 * place, never re-derived.
 *
 * No surface may re-derive its own version of any of these numbers. Consumers:
 * Today (src/app/(shell)/page.tsx tiles + standup + measuring strip), the Changes
 * list (changes-data.ts canonical annotations), the worklist Tonight chip, and the
 * Results page (header strip + the three bands themselves via splitLedgerLifecycle).
 */
import {
  deriveMeasurementMaturity,
  detectMeasurementOverlaps,
  isMatureOutcome,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { displayProofOutcome } from "@/domains/proof-gsc/verdict-calibration";
// Relocated from the retired experiments domain (CORE 100K): the legacy plan
// item-status union, kept only for the historical execution-block reader below.
type DailyExperimentItemStatus =
  | "ready_to_apply"
  | "verification_pending"
  | "verification_failed"
  | "verified_live"
  | "activation_pending"
  | "active"
  | "gsc_submission_pending"
  | "gsc_submitted"
  | "skipped"
  | "rolled_back";

export type LifecycleCounts = {
  /** Open ideas on the canonical Changes list (suggested + blocked, post-dedupe). */
  toDo: number;
  /** Changes on tonight's active plan (accepted first, else the preview). */
  tonightPicked: number;
  /** Tonight's picks no longer waiting on the operator's edit (same formula as the
   *  "Tonight: N of M applied" progress line). */
  tonightApplied: number;
  /** Shipped changes without a final read yet - Results' "In flight" set. */
  measuring: number;
  /** Shipped changes with a final read (mature won or lost). Includes `won`. */
  decided: number;
  /** Decided changes whose verdict is "won" - Results' "Wins" band. */
  won: number;
};

/** The minimal shape of a shipped-change ledger row this module needs - structurally
 *  satisfied by ShippedChangeRecord (proof-gsc/shipped-change-store.ts). */
export type LedgerLifecycleRow = {
  id: string;
  path: string;
  shippedAt: string;
  verdict: string;
  windows: ReadonlyArray<{ day: number; ran: boolean; controlsUsed?: number | null }>;
  baseline?: { impressions?: number | null } | null;
  /** Bug #14 (2026-07-06): a revert executor records "I put the old version back" as
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
export function isRevertLedgerRow(row: Pick<LedgerLifecycleRow, "actionType">): boolean {
  return (row.actionType ?? "").startsWith(REVERT_LEDGER_ACTION_PREFIX);
}

/**
 * Bug #14 - drop revert bookkeeping rows before ANY count or overlap detection.
 * A revert both double-counts (a second shipped-change row for one underlying change)
 * AND poisons overlap detection (its same-path ship flags the original as attribution
 * limited), so it must be removed at the single choke point every surface reads from.
 * The genuine measurement history is untouched: the ORIGINAL row (with its restored-
 * version note) stays; only the revert's own `revert_*` row is filtered. Returns the
 * SAME array reference when there is nothing to drop, so a no-revert ledger is byte
 * identical (no re-sort, no new object).
 */
export function excludeRevertBookkeeping<T extends Pick<LedgerLifecycleRow, "actionType">>(
  rows: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return rows.some(isRevertLedgerRow) ? rows.filter((r) => !isRevertLedgerRow(r)) : rows;
}

export type LedgerLifecycleStage = "won" | "learned" | "measuring";

/**
 * Classify ONE ledger row. Mirrors the Results bands exactly: mature + won -> "won"
 * (the Wins band), mature + lost -> "learned" (What we learned), everything else ->
 * "measuring" (In flight). `overlap` comes from detectMeasurementOverlaps over the
 * whole ledger (an overlapping edit caps maturity, so an overlapped row is always
 * measuring). latestGscDate is passed as null on purpose: it only distinguishes
 * collecting from blocked_data, and both count as measuring here.
 */
export function ledgerLifecycleStage(
  row: LedgerLifecycleRow,
  overlap: OverlapContext | null,
  now: Date = new Date(),
): LedgerLifecycleStage {
  const basisWin = [...row.windows].filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
  const maturity = deriveMeasurementMaturity({
    shippedAt: row.shippedAt,
    now,
    latestGscDate: null,
    windows: row.windows.map((w) => ({ day: w.day, ran: w.ran })),
    verdict: row.verdict,
    controlsUsed: basisWin?.controlsUsed ?? 0,
    baselineImpressions: row.baseline?.impressions ?? 0,
    overlap,
    live: true,
  });
  if (!isMatureOutcome(maturity)) return "measuring";
  // Fail-closed calibration quarantine (2026-07-11): a mature won/lost measured
  // under thresholds that failed Beacon's self-test is NOT a trustworthy win or
  // loss. displayProofOutcome is the shared selector: a calibrated win/loss keeps
  // its band; an uncalibrated one returns "no_clear_effect_uncalibrated" and lands
  // in the SAME in-flight bucket as inconclusive/measuring - so every count tile
  // that reads this split collapses together at once (the one-count rule), never
  // claiming a "won" or a loss ("learned") the ledger cannot stand behind.
  const outcome = displayProofOutcome({ verdict: row.verdict, calibrationVersion: row.calibrationVersion });
  if (outcome.kind === "won") return "won";
  if (outcome.kind === "lost") return "learned";
  return "measuring";
}

export type LedgerLifecycleSplit<T> = { won: T[]; learned: T[]; measuring: T[] };

/**
 * Split a whole ledger into the three Results bands - the ONE band membership rule.
 * Results renders these arrays directly, and countLedgerLifecycle below counts them,
 * so a band heading count and a cross-surface count can never diverge.
 */
export function splitLedgerLifecycle<T extends LedgerLifecycleRow>(
  rows: ReadonlyArray<T>,
  now: Date = new Date(),
): LedgerLifecycleSplit<T> {
  // Bug #14 - filter revert bookkeeping FIRST so it neither double-counts nor poisons
  // the same-page overlap detection below (a revert's ship must not flag the original it
  // restored as attribution limited). No-revert ledgers pass through untouched.
  const real = excludeRevertBookkeeping(rows);
  const overlapById = detectMeasurementOverlaps(
    real.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })),
  );
  const out: LedgerLifecycleSplit<T> = { won: [], learned: [], measuring: [] };
  for (const row of real) {
    out[ledgerLifecycleStage(row, overlapById.get(row.id) ?? null, now)].push(row);
  }
  return out;
}

/** The three ledger-derived counts, from the same split Results renders. */
export function countLedgerLifecycle(
  rows: ReadonlyArray<LedgerLifecycleRow>,
  now: Date = new Date(),
): { measuring: number; decided: number; won: number } {
  const split = splitLedgerLifecycle(rows, now);
  return {
    measuring: split.measuring.length,
    decided: split.won.length + split.learned.length,
    won: split.won.length,
  };
}

/** The minimal plan shape tonight's counts need - structurally satisfied by
 *  DailyExperimentPlanRecord (experiments/daily-plan-types.ts). */
export type TonightPlanLike = {
  selected: ReadonlyArray<{ id: string }>;
  execution?: { items?: Record<string, { status?: DailyExperimentItemStatus }> } | null;
};

/** An item still waiting on the operator's edit - the exact `summary.left` set from
 *  execution-checklist.ts, reused as a rule (not re-invented) so the worklist chip
 *  and Today's "Tonight: N of M applied" progress line always agree. */
const LEFT_STATUSES: ReadonlySet<DailyExperimentItemStatus> = new Set([
  "ready_to_apply",
  "verification_pending",
  "verification_failed",
]);

export function tonightCounts(
  acceptedPlan: TonightPlanLike | null,
  previewPlan: TonightPlanLike | null,
): { picked: number; applied: number } {
  const plan = acceptedPlan ?? previewPlan;
  if (!plan) return { picked: 0, applied: 0 };
  const picked = plan.selected.length;
  // A preview plan has no execution state yet - nothing can be applied before approval.
  if (!acceptedPlan) return { picked, applied: 0 };
  const left = plan.selected.filter((e) => {
    const status = plan.execution?.items?.[e.id]?.status ?? "ready_to_apply";
    return LEFT_STATUSES.has(status);
  }).length;
  return { picked, applied: picked - left };
}

/** Compose the full sextuple from the canonical stores' already-loaded rows. PURE. */
export function computeLifecycleCounts(input: {
  ledger: ReadonlyArray<LedgerLifecycleRow>;
  acceptedPlan: TonightPlanLike | null;
  previewPlan: TonightPlanLike | null;
  /** The canonical Changes list's own open count (changes-data.ts summary.todo). */
  backlogToDo: number;
  now?: Date;
}): LifecycleCounts {
  const ledgerCounts = countLedgerLifecycle(input.ledger, input.now ?? new Date());
  const tonight = tonightCounts(input.acceptedPlan, input.previewPlan);
  return {
    toDo: input.backlogToDo,
    tonightPicked: tonight.picked,
    tonightApplied: tonight.applied,
    ...ledgerCounts,
  };
}
