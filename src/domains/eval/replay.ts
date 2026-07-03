/**
 * replay (BEACON_500 N35, 2026-07-03, R22b) - historical policy replay: the
 * regression DETECTOR that runs before new planner/scorer logic ships.
 *
 * WHAT IT PROVES. Given a captured set of PRIOR decisions - a frozen fixture of
 * {input signals, the action Beacon decided at capture time} - this re-runs the
 * CURRENT scorer over each captured input and flags any DIVERGENCE from the
 * prior decision. If today's logic would decide differently than it did when the
 * decision was captured, that is surfaced as a divergence with the case, the old
 * action, and the new one. A change that flips a settled decision has to be
 * looked at on purpose, never by accident.
 *
 * This is the "does the new policy quietly change old calls?" check. It is
 * deliberately narrower than the benchmark (N33): the benchmark asks "is Beacon
 * RIGHT?" against expert gold; the replay asks "did Beacon CHANGE?" against its
 * own recorded history. A divergence is not automatically a bug - a genuine
 * improvement diverges too - but it must be a CONSCIOUS change, so the replay
 * makes every flip visible instead of silent.
 *
 * PURE / deterministic / no I/O / no network / no clock. The captured decisions
 * are passed in (a fixture, or a real captured set a caller loaded elsewhere);
 * this module only diffs. The default captured set is derived deterministically
 * from the gold library so the suite has a self-contained baseline that can
 * never drift from the fixtures it guards.
 *
 * Pinned by replay.test.ts.
 */

import { buildDemandGraph, type GapKind } from "@/domains/demand-graph/build-graph";
import type { GoldSignals } from "./gold-library";
import { goldCases } from "./gold-library";

/** One captured historical decision: the exact input signals and the action the
 *  scorer decided for them at capture time. This is what a policy replay diffs
 *  against - the recorded truth, not an expert opinion. */
export type CapturedDecision = {
  id: string;
  signals: GoldSignals;
  /** The gap the scorer chose when this decision was captured. */
  decidedAction: GapKind;
};

export type ReplayDivergence = {
  case: string;
  /** The action recorded at capture time. */
  priorAction: GapKind;
  /** The action the CURRENT logic decides for the same input. */
  currentAction: GapKind | "none";
};

export type ReplayReport = {
  /** How many captured decisions the current logic reproduces exactly. */
  matched: number;
  /** Total captured decisions replayed. */
  total: number;
  /** Every decision the current logic would now decide differently. Empty means
   *  the new logic reproduces every historical call (a clean, non-diverging
   *  change - byte-identical policy behavior on the captured set). */
  divergences: ReplayDivergence[];
};

/** Re-run the current scorer over one captured input and return its action. */
function currentActionFor(signals: GoldSignals): GapKind | "none" {
  const graph = buildDemandGraph({
    demand: [signals.demand],
    ownedPages: signals.ownedPages,
    competitorCitations: signals.competitorCitations,
  });
  return graph.moves[0]?.gap ?? "none";
}

/**
 * Replay a captured decision set against the CURRENT scorer. Returns a
 * deterministic diff: matched count + every divergence. PURE.
 */
export function replayDecisions(captured: readonly CapturedDecision[]): ReplayReport {
  const divergences: ReplayDivergence[] = [];
  let matched = 0;
  for (const d of captured) {
    const current = currentActionFor(d.signals);
    if (current === d.decidedAction) {
      matched += 1;
    } else {
      divergences.push({ case: d.id, priorAction: d.decidedAction, currentAction: current });
    }
  }
  return { matched, total: captured.length, divergences };
}

/**
 * The default captured decision set, derived deterministically from the gold
 * library's expected actions. This gives the replay a self-contained baseline
 * that stays in lockstep with the fixtures: capturing the library's own expert
 * actions means a clean replay proves the current scorer still reproduces the
 * classification the library was built around. A caller with a REAL captured
 * history (a prior-release snapshot) can pass its own set instead. PURE.
 */
export function goldCapturedDecisions(): CapturedDecision[] {
  return goldCases().map((c) => ({
    id: c.id,
    signals: c.signals,
    decidedAction: c.expected.action,
  }));
}

/** Convenience: replay the gold-derived baseline. PURE. */
export function replayGoldBaseline(): ReplayReport {
  return replayDecisions(goldCapturedDecisions());
}
