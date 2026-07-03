/**
 * ablation (BEACON_500 N34, 2026-07-03, R22b) - teammate/signal ablation
 * testing: prove which signals actually improve decisions.
 *
 * WHAT IT PROVES. Beacon's scorer fuses several signal families (GSC demand,
 * search volume, AI-execution/competitor-citation evidence, Clarity friction).
 * A signal is only worth trusting if REMOVING it makes decisions worse. This
 * harness takes the gold library (N36) as the correct-answer set, then, one
 * signal at a time, zeroes that signal across EVERY gold case and re-scores. The
 * marginal contribution of a signal is how many gold cases it stops getting
 * right once the signal is gone.
 *
 * Read the output as: "removing GSC demand drops 4 gold cases" - i.e. GSC demand
 * is load-bearing for 4 of the correct decisions. A signal whose removal drops
 * ZERO cases is not pulling weight on this library (a prompt to either add a case
 * that needs it, or question whether it earns its place). This is the honest,
 * deterministic version of "which teammates actually matter".
 *
 * PURE / deterministic / no I/O / no LLM. It re-runs the same buildDemandGraph
 * the benchmark and production use, over the same fixtures, with one signal
 * masked - never a re-implementation of the scorer.
 *
 * Pinned by ablation.test.ts.
 */

import { buildDemandGraph, type GapKind } from "@/domains/demand-graph/build-graph";
import { goldCases, type GoldCase, type GoldSignals } from "./gold-library";

/** The signals we can ablate (mask to zero) one at a time. Each maps to a real
 *  field family the scorer reads. */
export type AblatableSignal =
  | "gsc_demand"
  | "search_volume"
  | "ai_and_competitor"
  | "clarity_friction";

export const ABLATABLE_SIGNALS: readonly AblatableSignal[] = [
  "gsc_demand",
  "search_volume",
  "ai_and_competitor",
  "clarity_friction",
];

const SIGNAL_LABEL: Record<AblatableSignal, string> = {
  gsc_demand: "GSC demand",
  search_volume: "search volume",
  ai_and_competitor: "AI and competitor evidence",
  clarity_friction: "Clarity friction",
};

/** Return a copy of a case's signals with ONE signal masked to zero. PURE. */
function maskSignal(signals: GoldSignals, signal: AblatableSignal): GoldSignals {
  const demand = { ...signals.demand };
  let ownedPages = signals.ownedPages.map((p) => ({ ...p }));
  let competitorCitations = signals.competitorCitations.map((c) => ({ ...c }));

  switch (signal) {
    case "gsc_demand":
      demand.gscImpressions = 0;
      ownedPages = ownedPages.map((p) => ({ ...p, gscImpressions: 0, gscClicks: 0 }));
      break;
    case "search_volume":
      demand.searchVolume = 0;
      break;
    case "ai_and_competitor":
      demand.aiExecutions = 0;
      ownedPages = ownedPages.map((p) => ({ ...p, aiCitationCount: 0 }));
      competitorCitations = [];
      break;
    case "clarity_friction":
      ownedPages = ownedPages.map((p) => ({
        ...p,
        clarityRageClicks: 0,
        clarityDeadClicks: 0,
        clarityScriptErrors: 0,
      }));
      break;
  }
  return { demand, ownedPages, competitorCitations };
}

/** The top-move gap for a set of signals under the current scorer. PURE. */
function actionFor(signals: GoldSignals): GapKind | "none" {
  const graph = buildDemandGraph({
    demand: [signals.demand],
    ownedPages: signals.ownedPages,
    competitorCitations: signals.competitorCitations,
  });
  return graph.moves[0]?.gap ?? "none";
}

export type SignalContribution = {
  signal: AblatableSignal;
  /** Plain label for the operator surface. */
  label: string;
  /** How many gold cases the scorer stops getting right once this signal is
   *  masked - the signal's marginal contribution to correct decisions. */
  casesDropped: number;
  /** The specific cases that flipped away from their gold action. */
  droppedCases: Array<{ case: string; goldAction: GapKind; ablatedAction: GapKind | "none" }>;
  /** One honest sentence: "Removing GSC demand drops N gold cases." */
  sentence: string;
};

export type AblationReport = {
  /** Baseline: how many gold cases the FULL scorer gets right (no ablation). */
  baselineCorrect: number;
  casesTotal: number;
  /** Per-signal marginal contribution, most load-bearing first. */
  contributions: SignalContribution[];
};

function goldActionMatch(c: GoldCase, action: GapKind | "none"): boolean {
  return action === c.expected.action;
}

/**
 * Run the full ablation over the gold library. For each signal, mask it across
 * every case, re-score, and count how many correct decisions it was holding up.
 * PURE / deterministic.
 */
export function runAblation(): AblationReport {
  const cases = goldCases();
  const baselineCorrect = cases.filter((c) => goldActionMatch(c, actionFor(c.signals))).length;

  const contributions: SignalContribution[] = ABLATABLE_SIGNALS.map((signal) => {
    const droppedCases: SignalContribution["droppedCases"] = [];
    for (const c of cases) {
      // Only count cases the FULL scorer gets right - a case already wrong at
      // baseline cannot be "dropped" by removing a signal.
      if (!goldActionMatch(c, actionFor(c.signals))) continue;
      const ablatedAction = actionFor(maskSignal(c.signals, signal));
      if (!goldActionMatch(c, ablatedAction)) {
        droppedCases.push({ case: c.id, goldAction: c.expected.action, ablatedAction });
      }
    }
    return {
      signal,
      label: SIGNAL_LABEL[signal],
      casesDropped: droppedCases.length,
      droppedCases,
      sentence: `Removing ${SIGNAL_LABEL[signal]} drops ${droppedCases.length} gold ${droppedCases.length === 1 ? "case" : "cases"}.`,
    };
  }).sort((a, b) => b.casesDropped - a.casesDropped || a.signal.localeCompare(b.signal));

  return { baselineCorrect, casesTotal: cases.length, contributions };
}
