/**
 * Portfolio circuit breaker (2026-07-02, BEACON 500 item 80).
 *
 * PURE decision layer. Autonomy without a stop-loss is how a system loses an
 * operator's trust permanently: this module watches the tenant's own settled
 * proof-ledger verdicts and its rollback (revert) history and decides whether
 * autopilot should PAUSE itself.
 *
 * TRIP when either is true:
 *   (a) the last two consecutive settled ship batches each measured net
 *       negative (the SUM of that batch's settled verdict outcomes is below
 *       zero, read off the SAME basis-window lift the proof lane already
 *       computes - see outcomeOf below, no new math invented), or
 *   (b) N rollbacks (autopilot reverts) fired within the trailing 7 days
 *       (default 2).
 *
 * A "batch" = the ships that share a plan/night. shipped_change_proof rows
 * (ShippedChangeRecord) carry no plan/batch id today (checked: no planId /
 * batchId / plan_id / batch_id field anywhere on the record or its store), so
 * per the fallback instruction this groups by Pacific SHIP DATE - every
 * change that shipped on the same calendar night is one batch, exactly like
 * the nightly autopilot pass and the weekly-recap band already reason about
 * "shipped in the last N days" by date.
 *
 * "Settled" mirrors autopilot-policy.ts's own DECIDED_VERDICTS: won, lost, or
 * inconclusive. "measuring" and "insufficient_data" are not settled - a batch
 * with zero settled rows is not judged at all (never counted as negative,
 * never counted as positive; it simply cannot be one of the "last two
 * consecutive" batches yet).
 *
 * FAIL-SAFE DIRECTION: this module never throws. Any malformed input degrades
 * to `{ tripped: false }` with the reason naming the computation problem, so a
 * bug in the breaker itself can never itself pause a healthy tenant. Tripping
 * only ever comes from real settled evidence or a real rollback count.
 *
 * No I/O here. The caller (run-autopilot.ts / the nightly path) loads the
 * settled ledger + the autopilot receipts and passes them in.
 *
 * Pinned by tests/domains/autopilot/circuit-breaker.test.ts.
 */

import { pickProofMetric, type ProofMetric } from "@/domains/proof-gsc/measure";
import { leverLabel } from "./autopilot-policy";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The minimal slice of a ShippedChangeRecord the breaker needs. Pure input -
 *  no store types imported here so this module stays a leaf. */
export type BreakerProofInput = {
  id: string;
  path: string;
  actionType: string;
  /** ISO ship timestamp. */
  shippedAt: string;
  /** Persisted proof verdict: measuring | won | lost | inconclusive | insufficient_data. */
  verdict: string;
  /** The record's proof windows (day + whether it closed + the three lift metrics),
   *  the exact shape run-revert.ts already reads via liftLabelFor/pickProofMetric. */
  windows: ReadonlyArray<{
    day: number;
    ran: boolean;
    adjustedLift: number;
    adjustedCtrLift: number;
    adjustedPosLift: number;
  }>;
};

/** The minimal slice of an AutopilotReceipt the breaker needs for rollback counting. */
export type BreakerReceiptInput = {
  /** "revert" = a rollback; ships and everything else are ignored here. */
  kind?: "ship" | "revert";
  result: "pushed" | "failed";
  /** ISO timestamp. */
  shippedAt: string;
};

export type CircuitBreakerConfig = {
  /** Rollbacks within the trailing window that alone trip the breaker. */
  rollbackTripCount: number;
  /** The trailing window (days) rollbacks are counted over. */
  rollbackWindowDays: number;
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  rollbackTripCount: 2,
  rollbackWindowDays: 7,
};

const DECIDED_VERDICTS = new Set(["won", "lost", "inconclusive"]);

// ---------------------------------------------------------------------------
// Batch outcome (the SAME number the proof lane already computes)
// ---------------------------------------------------------------------------

/**
 * The judged metric's basis-window lift for one settled record, read the
 * exact way run-revert.ts's liftLabelFor does: the longest window that has
 * RUN, on the metric pickProofMetric already assigns this action type (clicks
 * for most levers, CTR for snippet plays, position for rank plays). No new
 * math - this is a straight re-read of adjustedLift / adjustedCtrLift /
 * adjustedPosLift, whichever field the proof lane already uses to judge this
 * lever. Returns null when the record has no closed window (can't happen for
 * a truly settled verdict, but the caller degrades safely either way).
 */
export function outcomeOf(record: BreakerProofInput): { metric: ProofMetric; value: number } | null {
  const basis = [...record.windows].filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
  if (basis == null) return null;
  const metric = pickProofMetric(record.actionType);
  const value =
    metric === "ctr" ? basis.adjustedCtrLift : metric === "position" ? basis.adjustedPosLift : basis.adjustedLift;
  if (!Number.isFinite(value)) return null;
  return { metric, value };
}

/** One night's worth of ships, judged together. */
export type SettledBatch = {
  /** Pacific YYYY-MM-DD ship date - the batch key. */
  batchDate: string;
  /** Every settled (won/lost/inconclusive) record in this batch. */
  records: BreakerProofInput[];
  /** Sum of each settled record's own judged-metric outcome. Mixed metrics
   *  (clicks vs CTR vs position) are summed as-is per record's own metric -
   *  the sign is what matters for net-negative, and each record already
   *  carries its own correctly-scaled number from the proof lane. */
  netOutcome: number;
  /** Per-metric totals, for the plain-English reason line. */
  clicksTotal: number;
  ctrTotal: number;
  positionTotal: number;
};

function pacificDateOf(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * Group settled proof records into per-night batches (Pacific ship date),
 * newest batch first. Unsettled (measuring / insufficient_data) and
 * unparsable-date records are excluded - a batch is only ever built from
 * verdicts that actually landed.
 */
export function groupIntoSettledBatches(records: ReadonlyArray<BreakerProofInput>): SettledBatch[] {
  const byDate = new Map<string, BreakerProofInput[]>();
  for (const r of records) {
    if (!DECIDED_VERDICTS.has(r.verdict)) continue;
    const date = pacificDateOf(r.shippedAt);
    if (date == null) continue;
    const bucket = byDate.get(date) ?? [];
    bucket.push(r);
    byDate.set(date, bucket);
  }
  const batches: SettledBatch[] = [];
  for (const [batchDate, recs] of byDate.entries()) {
    let netOutcome = 0;
    let clicksTotal = 0;
    let ctrTotal = 0;
    let positionTotal = 0;
    for (const r of recs) {
      const outcome = outcomeOf(r);
      if (outcome == null) continue;
      netOutcome += outcome.value;
      if (outcome.metric === "clicks") clicksTotal += outcome.value;
      else if (outcome.metric === "ctr") ctrTotal += outcome.value;
      else positionTotal += outcome.value;
    }
    batches.push({ batchDate, records: recs, netOutcome, clicksTotal, ctrTotal, positionTotal });
  }
  return batches.sort((a, b) => (a.batchDate < b.batchDate ? 1 : -1)); // newest first
}

// ---------------------------------------------------------------------------
// Rollback counting
// ---------------------------------------------------------------------------

/** How many rollback (revert) receipts landed in the trailing window. Pure. */
export function countRollbacksInWindow(
  receipts: ReadonlyArray<BreakerReceiptInput>,
  now: Date,
  windowDays: number,
): { count: number; timestamps: string[] } {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const timestamps: string[] = [];
  for (const r of receipts) {
    if (r.kind !== "revert") continue;
    if (r.result !== "pushed") continue;
    const t = Date.parse(r.shippedAt);
    if (!Number.isFinite(t)) continue;
    if (t >= cutoff && t <= now.getTime()) timestamps.push(r.shippedAt);
  }
  timestamps.sort();
  return { count: timestamps.length, timestamps };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type BreakerEvidenceBatch = {
  batchDate: string;
  changeCount: number;
  netOutcome: number;
  /** Plain labels of the levers in this batch, for the reason line. */
  leverLabels: string[];
};

export type CircuitBreakerEvidence = {
  /** The batches cited (present when tripped by consecutive-negative). */
  batches: BreakerEvidenceBatch[];
  /** The rollback timestamps cited (present when tripped by rollback count). */
  rollbacks: string[];
};

export type CircuitBreakerResult = {
  tripped: boolean;
  /** Plain-English reason with the real numbers. Empty string when not tripped
   *  and there is nothing notable to say. */
  reason: string;
  evidence: CircuitBreakerEvidence;
  /** ISO timestamp of the earliest evidence cited (the batch/rollback that
   *  started the trip), or null when not tripped. */
  sinceIso: string | null;
};

function safeResult(reason: string): CircuitBreakerResult {
  return { tripped: false, reason, evidence: { batches: [], rollbacks: [] }, sinceIso: null };
}

function fmtOutcome(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${abs}`;
}

function batchLeverLabels(batch: SettledBatch): string[] {
  const seen = new Set<string>();
  for (const r of batch.records) seen.add(leverLabel(r.actionType));
  return [...seen];
}

/**
 * The pure trip decision. Deterministic given its inputs. Never throws:
 * malformed input (non-array records/receipts, a bad config) degrades to a
 * safe not-tripped result with a diagnostic reason, exactly per the fail-safe
 * direction - a bug here must never itself cause a pause.
 */
export function evaluateCircuitBreaker(args: {
  proofRecords: ReadonlyArray<BreakerProofInput>;
  receipts: ReadonlyArray<BreakerReceiptInput>;
  now: Date;
  config?: Partial<CircuitBreakerConfig>;
}): CircuitBreakerResult {
  try {
    if (!Array.isArray(args.proofRecords) || !Array.isArray(args.receipts)) {
      return safeResult("I could not read the settled results or rollback history, so I did not pause.");
    }
    if (!(args.now instanceof Date) || !Number.isFinite(args.now.getTime())) {
      return safeResult("I could not read the current time, so I did not pause.");
    }
    const config: CircuitBreakerConfig = {
      rollbackTripCount: Math.max(
        1,
        Math.round(args.config?.rollbackTripCount ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.rollbackTripCount),
      ),
      rollbackWindowDays: Math.max(
        1,
        Math.round(args.config?.rollbackWindowDays ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.rollbackWindowDays),
      ),
    };

    // ---- Gate (b): rollback count within the trailing window ----
    const rollbacks = countRollbacksInWindow(args.receipts, args.now, config.rollbackWindowDays);
    if (rollbacks.count >= config.rollbackTripCount) {
      const dayWord = config.rollbackWindowDays === 1 ? "day" : "days";
      return {
        tripped: true,
        reason: `I paused myself. I had to put a change back ${rollbacks.count} times in the last ${config.rollbackWindowDays} ${dayWord}. That is too many corrections too fast, so I stopped shipping and reverting on my own until you take a look.`,
        evidence: { batches: [], rollbacks: rollbacks.timestamps },
        sinceIso: rollbacks.timestamps[0] ?? null,
      };
    }

    // ---- Gate (a): two consecutive settled batches net negative ----
    const batches = groupIntoSettledBatches(args.proofRecords);
    if (batches.length >= 2) {
      const [latest, prior] = batches; // newest first
      if (latest.netOutcome < 0 && prior.netOutcome < 0) {
        const combined = latest.netOutcome + prior.netOutcome;
        const metric =
          Math.abs(latest.clicksTotal) + Math.abs(prior.clicksTotal) >=
          Math.abs(latest.ctrTotal) + Math.abs(prior.ctrTotal) + Math.abs(latest.positionTotal) + Math.abs(prior.positionTotal)
            ? "clicks a month worse"
            : "worse, weighted across click rate and ranking";
        const evidenceBatches: BreakerEvidenceBatch[] = [latest, prior].map((b) => ({
          batchDate: b.batchDate,
          changeCount: b.records.length,
          netOutcome: b.netOutcome,
          leverLabels: batchLeverLabels(b),
        }));
        return {
          tripped: true,
          reason: `I paused myself. The last two batches of changes I shipped, on ${prior.batchDate} and ${latest.batchDate}, both measured net negative: ${fmtOutcome(prior.netOutcome)} and ${fmtOutcome(latest.netOutcome)}, a combined ${fmtOutcome(Math.abs(combined)).replace("-", "")} ${metric}. That did not work. I stopped so we do not lose more.`,
          evidence: { batches: evidenceBatches, rollbacks: [] },
          sinceIso: prior.records.map((r) => r.shippedAt).sort()[0] ?? null,
        };
      }
    }

    return safeResult("");
  } catch (e) {
    // Fail-safe: a computation error must never itself trip the breaker.
    const detail = e instanceof Error ? e.message : String(e);
    return safeResult(`I could not check my recent results (${detail}), so I did not pause.`);
  }
}
