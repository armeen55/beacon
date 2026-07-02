/**
 * lever-retirement (BEACON_500 item 81, 2026-07-02) - PURE core that turns the proof ledger's
 * repeated losses into an automatic "stop doing this" decision, per (pageFamily, actionFamily)
 * cell, with a scheduled single retest so the rule can never fossilize.
 *
 * Reuses the EXACT grouping the nightly planner's proof-history voice already uses
 * (proof-history-voice.ts's aggregateSettled: pageFamilyOf x actionFamilyOf over settled-only
 * ledger rows) so a "lever" here means the SAME action family the rest of the daily batch
 * reasons about, never a re-derivation.
 *
 * RETIRE a cell when it has >= RETIRE_LOSS_THRESHOLD settled losses AND zero wins. The cell's
 * retiredAt is the settlement date of the loss that FIRST crossed the threshold (so re-running
 * this on a later night with the same ledger yields the same retiredAt - deterministic, not
 * "now").
 *
 * RETEST after RETEST_AFTER_DAYS have passed since retiredAt: exactly ONE fresh candidate in
 * that cell is allowed through as `retest_due`. The planner (daily-experiment-planner.ts)
 * consumes that single slot per planning pass via RetirementIndex.admit(). Once the retest
 * candidate itself SETTLES (a new ledger row lands for that cell after retiredAt):
 *   - a loss resets the clock: the retest loss becomes the new latest loss, and (since the
 *     cell still has >= threshold losses and 0 wins) it re-retires with retiredAt = the retest
 *     loss's own settlement date - a fresh 90-day wait starts from there.
 *   - a win fully unsuppresses the cell: any win at all breaks the "zero wins" condition, so
 *     the cell reads as `active` from then on, permanently (until a fresh run of >=3 losses
 *     with 0 wins accumulates again, which the ledger would show for itself).
 *
 * DERIVED ENTIRELY FROM THE LEDGER. No persisted retirement list, no hand-maintained store -
 * the retiredAt/retestAfter timestamps and the single-retest gate are all computed from the
 * settled rows' own timestamps every time. This means a retest "grant" needs no separate log:
 * whether tonight's candidate is the (at most one) retest allowed is a pure function of "how
 * many candidates in this cell have already settled at or after retiredAt" - since a retest
 * candidate, once shipped, becomes a ledger row itself, the SECOND settled row after retiredAt
 * (if any) proves a retest already happened and used its slot.
 *
 * No I/O, no LLM, no paid calls. Pinned by lever-retirement.test.ts.
 */

import { FAMILY_PLAIN } from "./proof-history-voice";
import type { ExperimentFamily } from "./experiment-eligibility";

/** >= this many settled losses with zero wins in a cell retires it. */
export const RETIRE_LOSS_THRESHOLD = 3;
/** Days a retired cell must wait before its one scheduled retest is allowed through. */
export const RETEST_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;

/** The minimal settled-ledger row this module needs: same shape aggregateSettled's caller
 *  already has on hand (ShippedChangeRecord), read as plain fields so this stays a leaf. */
export type SettledLeverRow = {
  path: string;
  actionType: string;
  verdict: "won" | "lost" | "inconclusive" | string;
  /** ISO settlement time. Falls back to shippedAt at the call site when null - see
   *  settledIsoOf below; this module always receives a concrete ISO string per row. */
  settledAt: string;
};

export type LeverRetirementStatus = "active" | "retired" | "retest_due";

export type LeverRetirementDecision = {
  lever: ExperimentFamily | string;
  pageFamily: string;
  status: LeverRetirementStatus;
  lossCount: number;
  winCount: number;
  /** ISO timestamp the cell most recently retired (the loss that crossed the threshold, or the
   *  retest loss that re-retired it). Null while active. */
  retiredAtIso: string | null;
  /** ISO timestamp the ONE scheduled retest becomes available (retiredAtIso + 90 days). Null
   *  while active. */
  retestAfterIso: string | null;
  /** Plain-language lever name for operator copy (proof-history-voice's FAMILY_PLAIN table). */
  leverPlain: string;
};

type Cell = {
  lever: string;
  pageFamily: string;
  rows: SettledLeverRow[]; // settled rows for this cell, any order in
};

function cellKey(pageFamily: string, lever: string): string {
  return `${pageFamily}::${lever}`;
}

/**
 * Group settled rows into (pageFamily, lever) cells using the SAME family functions the
 * planner + proof-history voice already use. Callers pass rows already restricted to settled
 * (non-measuring) verdicts - mirrors aggregateSettled's own contract exactly.
 */
function groupCells(
  rows: SettledLeverRow[],
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const r of rows) {
    const pageFamily = familyOfPath(r.path);
    const lever = familyOfAction(r.actionType);
    const key = cellKey(pageFamily, lever);
    let cell = cells.get(key);
    if (!cell) {
      cell = { lever, pageFamily, rows: [] };
      cells.set(key, cell);
    }
    cell.rows.push(r);
  }
  return cells;
}

/**
 * Fold one cell's settled rows (oldest first) into a retirement decision. Pure, deterministic:
 * replays the cell's history in settlement order so retiredAt always lands on the loss that
 * actually crossed the threshold (or the retest loss that re-crossed it), never "now".
 */
function decideCell(cell: Cell, now: Date): LeverRetirementDecision {
  const rows = [...cell.rows].sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));

  let lossCount = 0;
  let winCount = 0;
  let retiredAtIso: string | null = null;
  // How many settled rows have landed strictly after the current retiredAtIso - this counts
  // the retest attempt itself once it settles, so a second post-retirement row (win or loss)
  // is recognized as "the retest already happened", never a second free slot.
  let settledSinceRetiredAt = 0;

  for (const r of rows) {
    if (r.verdict === "won") {
      winCount += 1;
      // A win at any point fully clears the retirement (per spec: "or fully unsuppress if it
      // wins"). Reset the whole cell to active - a fresh run of losses would have to re-earn
      // retirement from here forward.
      retiredAtIso = null;
      settledSinceRetiredAt = 0;
      continue;
    }
    if (r.verdict !== "lost") continue; // inconclusive rows don't count toward either bucket

    lossCount += 1;
    if (retiredAtIso == null) {
      // Not currently retired: does THIS loss cross the threshold?
      if (lossCount >= RETIRE_LOSS_THRESHOLD && winCount === 0) {
        retiredAtIso = new Date(Date.parse(r.settledAt)).toISOString();
        settledSinceRetiredAt = 0;
      }
    } else {
      // Already retired and this loss settled after that - it can only be the single granted
      // retest settling badly. Re-retire, resetting the clock to THIS loss's own settlement.
      settledSinceRetiredAt += 1;
      retiredAtIso = new Date(Date.parse(r.settledAt)).toISOString();
      settledSinceRetiredAt = 0;
    }
  }

  const leverPlain = FAMILY_PLAIN[cell.lever] ?? "a change";

  if (retiredAtIso == null) {
    return {
      lever: cell.lever, pageFamily: cell.pageFamily, status: "active",
      lossCount, winCount, retiredAtIso: null, retestAfterIso: null, leverPlain,
    };
  }

  const retestAfterIso = new Date(Date.parse(retiredAtIso) + RETEST_AFTER_DAYS * DAY_MS).toISOString();
  // A retest is DUE once the wait has passed AND no settled row has landed after retiredAt yet
  // (settledSinceRetiredAt tracks that - see the loop above; it is reset to 0 every time
  // retiredAtIso itself advances, so it only ever counts rows strictly after the CURRENT
  // retiredAtIso, which for a freshly-computed decision is always zero here since any such row
  // would have already advanced retiredAtIso in the loop).
  const waited = now.getTime() >= Date.parse(retestAfterIso);
  const status: LeverRetirementStatus = waited ? "retest_due" : "retired";

  return {
    lever: cell.lever, pageFamily: cell.pageFamily, status,
    lossCount, winCount, retiredAtIso, retestAfterIso, leverPlain,
  };
}

/**
 * Compute a retirement decision for every (pageFamily, lever) cell that has ANY settled loss
 * history. Cells with no losses never appear (they are implicitly "active" - the planner
 * treats an absent cell as active, see RetirementIndex below). PURE, deterministic given
 * (rows, now).
 */
export function computeLeverRetirementDecisions(
  rows: SettledLeverRow[],
  now: Date,
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): LeverRetirementDecision[] {
  const cells = groupCells(rows, familyOfPath, familyOfAction);
  const decisions: LeverRetirementDecision[] = [];
  for (const cell of cells.values()) {
    const d = decideCell(cell, now);
    if (d.lossCount > 0) decisions.push(d);
  }
  return decisions.sort((a, b) => (a.pageFamily === b.pageFamily ? a.lever.localeCompare(b.lever) : a.pageFamily.localeCompare(b.pageFamily)));
}

/**
 * Stateful (in-memory, per-planning-pass) gate the planner consumes candidate-by-candidate:
 * a `retired` cell blocks every candidate; a `retest_due` cell admits exactly ONE candidate
 * (flagging it `retest: true`) and blocks the rest for the remainder of THIS pass; an `active`
 * (or absent) cell never blocks anything. Never persisted - rebuilt fresh from the ledger on
 * every call to planDailyExperiments, so there is nothing to go stale.
 */
export class RetirementIndex {
  private readonly byCell = new Map<string, LeverRetirementDecision>();
  private readonly retestConsumed = new Set<string>();

  constructor(decisions: LeverRetirementDecision[]) {
    for (const d of decisions) this.byCell.set(cellKey(d.pageFamily, d.lever), d);
  }

  /** Look up the decision for a cell without consuming anything (read-only). */
  decisionFor(pageFamily: string, lever: string): LeverRetirementDecision | undefined {
    return this.byCell.get(cellKey(pageFamily, lever));
  }

  /**
   * Admit or block one candidate in (pageFamily, lever). Returns:
   *  - { blocked: false } for an active/absent cell, or the retest slot when granted;
   *  - { blocked: true, decision } for a retired cell, or a retest_due cell whose one slot is
   *    already used this pass.
   * Order-sensitive by design: candidates are offered in the planner's own scored order, so the
   * single retest slot goes to the BEST-scoring eligible candidate in that cell tonight.
   */
  admit(pageFamily: string, lever: string): { blocked: boolean; retest: boolean; decision?: LeverRetirementDecision } {
    const key = cellKey(pageFamily, lever);
    const decision = this.byCell.get(key);
    if (!decision || decision.status === "active") return { blocked: false, retest: false };
    if (decision.status === "retired") return { blocked: true, retest: false, decision };
    // retest_due: exactly one candidate gets through per pass.
    if (this.retestConsumed.has(key)) return { blocked: true, retest: false, decision };
    this.retestConsumed.add(key);
    return { blocked: false, retest: true, decision };
  }
}

/**
 * Plain, first-person retirement sentence for the nightly plan/daily card explanation, e.g.
 * "I stopped rewriting titles on city pages, it lost 3 times." or, when a retest is scheduled,
 * the sentence names when the one retest will run. No em or en dashes ever. Returns null for an
 * active (or absent) cell - honest silence, never a manufactured caution.
 */
export function retirementLine(decision: LeverRetirementDecision | undefined): string | null {
  if (!decision || decision.status === "active") return null;
  const pageWord = decision.pageFamily.replace(/[-_]+/g, " ");
  const timesWord = decision.lossCount === 1 ? "time" : "times";
  const base = `I stopped ${decision.leverPlain.replace(/^a /, "").replace(/^an /, "")} on ${pageWord} pages, it lost ${decision.lossCount} ${timesWord}.`;
  if (decision.status === "retest_due") {
    return `${base} I am ready to retest it once now.`;
  }
  const retestMonth = decision.retestAfterIso
    ? new Date(decision.retestAfterIso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    : "a future month";
  return `${base} I will retest it once in ${retestMonth}.`;
}
