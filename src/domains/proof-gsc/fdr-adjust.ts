/**
 * fdr-adjust (BEACON_500 P4 R10b, v1 item 291, 2026-07-03) - with many
 * simultaneous measurements, some wins are luck. This module holds the
 * champagne on the ones closest to that line.
 *
 * When N changes are measured at once, judging each win at the same
 * individual bar guarantees a few false winners just from how many
 * comparisons ran. The standard step-up adjustment (Benjamini-Hochberg at a
 * 10 percent rate - the name lives ONLY in this comment, never on a surface)
 * re-ranks the pool of mature win rows by how surprising each lift is and
 * keeps only the wins that survive the pool-wide bar. A win that clears the
 * individual bar but LOSES it after adjustment gets `fdrCaution: true` plus
 * the honest sentence ("With 12 changes measured at once, one or two will
 * look like winners by chance; this one is close enough to that line that I
 * am holding the champagne."). N10 demotes an fdrCaution win from solid to
 * decent; the stored verdict, windows, and clocks are NEVER touched.
 *
 * How surprising each lift is: the permutation-null read (item 37) is the
 * preferred source when a row has one (an empirical read against every
 * untreated page sharing the same window). Rows without one fall back to a
 * conservative approximation off the basis window's own click lift - the
 * lift in units of the expected window clicks' natural counting noise (a
 * Poisson-scale z, mapped through the same normal curve bayesian-read.ts
 * already carries).
 *
 * Applied at LEDGER LOAD (load-ledger.ts), the only place all simultaneous
 * measurements are in hand at once - measureRecord sees one record and can
 * not rank a pool. Computed-only, recomputed on every load, never persisted
 * (recordToRow omits it). PURE - no I/O. Pinned by fdr-adjust.test.ts.
 */

import { standardNormalCdf } from "./bayesian-read";

export type FdrRead = {
  /** True when this win cleared the individual bar but lost it after the
   *  pool-wide adjustment - hold the champagne. */
  fdrCaution: boolean;
  /** How many mature win rows were adjusted together. */
  poolSize: number;
  /** The row's own "how surprising" figure, 0-1 (smaller = more surprising).
   *  Kept for tests/debug; never rendered raw on a surface. */
  pValue: number;
  /** The honest sentence, non-null only when fdrCaution. */
  sentence: string | null;
};

/** The pool-wide rate: at most this fraction of surviving wins should be
 *  luck. 10 percent per the item spec. */
export const FDR_Q = 0.1;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * One row's "how surprising is this lift" figure. Prefers the empirical
 * permutation-null read (item 37); falls back to the Poisson-scale
 * approximation off the basis window's click lift. PURE.
 */
export function winPValue(args: {
  permutationRead?: { nGreater: number; nTotal: number } | null;
  /** The basis window's control-adjusted clicks lift. */
  adjustedLift: number;
  /** The pre-window clicks pro-rated to the basis window's length - the
   *  expected clicks had the change done nothing. */
  expectedWindowClicks: number;
}): number {
  const perm = args.permutationRead;
  if (perm && perm.nTotal > 0) return clamp01(perm.nGreater / perm.nTotal);
  const z = args.adjustedLift / Math.sqrt(Math.max(args.expectedWindowClicks, 1));
  return clamp01(1 - standardNormalCdf(z));
}

/**
 * The step-up adjustment: sort ascending, find the largest rank k whose
 * figure clears (k / poolSize) x q, keep everything at or above that rank.
 * Returns the ids that SURVIVE the pool-wide bar. PURE.
 */
export function benjaminiHochbergSignificant(
  rows: ReadonlyArray<{ id: string; p: number }>,
  q: number = FDR_Q,
): Set<string> {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let k = -1;
  for (let i = 0; i < m; i++) {
    if (sorted[i].p <= ((i + 1) / m) * q) k = i;
  }
  const out = new Set<string>();
  for (let i = 0; i <= k; i++) out.add(sorted[i].id);
  return out;
}

/** The honest champagne sentence, with the real pool count. No lab words. */
export function fdrCautionSentence(poolSize: number): string {
  return `With ${poolSize} changes measured at once, one or two will look like winners by chance; this one is close enough to that line that I am holding the champagne.`;
}

/**
 * The full pool read: every row gets an FdrRead; only rows that cleared the
 * individual bar (p <= q) but lost the pool-wide one carry fdrCaution. Rows
 * that never cleared the individual bar are NOT cautioned here - their
 * weakness is already surfaced by the permutation "normal noise" line and
 * N10's own noise demotion. PURE.
 */
export function computeFdrCautions(
  rows: ReadonlyArray<{ id: string; p: number }>,
  q: number = FDR_Q,
): Map<string, FdrRead> {
  const survivors = benjaminiHochbergSignificant(rows, q);
  const out = new Map<string, FdrRead>();
  for (const r of rows) {
    const fdrCaution = r.p <= q && !survivors.has(r.id);
    out.set(r.id, {
      fdrCaution,
      poolSize: rows.length,
      pValue: r.p,
      sentence: fdrCaution ? fdrCautionSentence(rows.length) : null,
    });
  }
  return out;
}

/** The minimal record shape the ledger pass needs - structural so this pure
 *  module never imports the (server-only) store. */
type FdrLedgerRow = {
  id: string;
  verdict: string;
  windows: ReadonlyArray<{ day: number; ran: boolean; adjustedLift: number }>;
  baseline: { clicks: number; windowDays: number };
  permutationRead?: { nGreater: number; nTotal: number } | null;
  fdrRead?: FdrRead | null;
};

/**
 * The ledger pass: pick the pool (mature win rows - stored verdict "won"
 * with a closed 28 day window), score each, run the adjustment, and return
 * NEW records with `fdrRead` attached to pool rows. Everything else is
 * returned untouched (never cautioned, never restated). A pool of fewer than
 * two rows returns the input unchanged - one measurement has no multiplicity
 * to adjust for. PURE.
 */
export function attachFdrToLedger<T extends FdrLedgerRow>(records: ReadonlyArray<T>): T[] {
  const pool = records.filter(
    (r) => r.verdict === "won" && (r.windows ?? []).some((w) => w.day === 28 && w.ran),
  );
  if (pool.length < 2) return [...records];

  const scored = pool.map((r) => {
    const w28 = (r.windows ?? []).find((w) => w.day === 28 && w.ran)!;
    const baselineDays =
      r.baseline?.windowDays && r.baseline.windowDays > 0 ? r.baseline.windowDays : 28;
    const expectedWindowClicks = Math.max(0, r.baseline?.clicks ?? 0) * (28 / baselineDays);
    return {
      id: r.id,
      p: winPValue({
        permutationRead:
          r.permutationRead && r.permutationRead.nTotal > 0 ? r.permutationRead : null,
        adjustedLift: w28.adjustedLift ?? 0,
        expectedWindowClicks,
      }),
    };
  });
  const cautions = computeFdrCautions(scored);
  return records.map((r) => {
    const read = cautions.get(r.id);
    return read ? { ...r, fdrRead: read } : r;
  });
}
