/**
 * benchmark (BEACON_500 N33, 2026-07-03, R22b) - the known-case regression
 * benchmark, run deterministically over the gold library (N36).
 *
 * WHAT IT PROVES. For every gold case we know the correct decision (the expert
 * answer). This harness runs the REAL pure pipeline - buildDemandGraph (the
 * scorer), assessAbstention (the ship-or-hold gate), planDependencies (the
 * prerequisite ordering) - over each frozen fixture and scores whether Beacon
 * AGREES with the expert on four axes:
 *   1. action     - did it classify the right gap (create / edit / answer / …)?
 *   2. disposition- did it ship the ones it should and hold the ones it should?
 *   3. rank band  - did the move land in roughly the right place in the list?
 *   4. dependency - did it hold the ones a prerequisite should block?
 *
 * A REGRESSION is simply a drop in the score: a change to the scorer, the
 * abstention gate, or the planner that makes Beacon disagree with a known-good
 * case it used to get right. The report lists every miss with what was expected
 * and what came out, so a red run points straight at the case that broke.
 *
 * PURE / deterministic / no I/O / no LLM / no clock. It calls the same functions
 * production does, never a re-implementation, so the benchmark can never quietly
 * drift away from the logic it is meant to guard.
 *
 * Pinned by benchmark.test.ts.
 */

import { buildDemandGraph, type GapKind, type MoveCandidate } from "@/domains/demand-graph/build-graph";
import { assessAbstention } from "@/domains/recommendations/abstention";
import { planDependencies } from "@/domains/experiments/dependency-planner";
import { goldCases, goldDependencyCandidates, type GoldCase } from "./gold-library";

export type BenchmarkMiss = {
  case: string;
  /** Which axis disagreed. */
  axis: "action" | "disposition" | "rank_band" | "dependency";
  expected: string;
  got: string;
};

export type BenchmarkReport = {
  /** Prevents this trained-on, source-visible fixture suite from being presented
   * as an unseen or blind validation result. */
  evidenceClass: "known_case_regression";
  /** How many (case × axis) checks agreed with the expert. */
  passed: number;
  /** Total (case × axis) checks. */
  total: number;
  /** How many WHOLE cases got every axis right (the "N of N right" headline). */
  casesPassed: number;
  /** Total gold cases. */
  casesTotal: number;
  misses: BenchmarkMiss[];
};

/** Coarse rank band from a move's score RELATIVE to the strongest move in the
 *  library. Score-relative (not index-based) so the band reflects real priority
 *  the way the operator's worklist does: a move worth a fraction of a percent of
 *  the top move is genuinely "bottom" even if it happens to sort above two
 *  tied-at-zero cases. Deliberately coarse (three wide buckets) so a healthy
 *  tweak to the scoring math never flips a band and reads as a false regression.
 *  A non-positive top score puts everything in the bottom band. */
function rankBandOf(score: number, topScore: number): "top" | "mid" | "bottom" {
  if (!(topScore > 0)) return "bottom";
  const frac = score / topScore;
  if (frac >= 0.5) return "top";
  if (frac >= 0.1) return "mid";
  return "bottom";
}

/** The scorer's chosen move for a single-case graph is its top-ranked move. */
function topMoveFor(c: GoldCase): MoveCandidate | null {
  const graph = buildDemandGraph({
    demand: [c.signals.demand],
    ownedPages: c.signals.ownedPages,
    competitorCitations: c.signals.competitorCitations,
  });
  return graph.moves[0] ?? null;
}

/**
 * Run the benchmark over the whole gold library and return a deterministic
 * score report. PURE.
 */
export function runBenchmark(): BenchmarkReport {
  const cases = goldCases();
  const misses: BenchmarkMiss[] = [];

  // ── Rank band: score every case's top move together, so the band reflects the
  //    move's place in ONE ranked list (the way the operator sees the worklist),
  //    not a per-case absolute. Ties break by case id for a stable order. ──
  const scored = cases
    .map((c) => ({ c, move: topMoveFor(c) }))
    .map((x) => ({ ...x, score: x.move?.score ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => (b.score - a.score) || a.c.id.localeCompare(b.c.id));
  const topScore = scored[0]?.score ?? 0;
  const bandByCase = new Map<string, "top" | "mid" | "bottom">();
  scored.forEach((x) => bandByCase.set(x.c.id, rankBandOf(x.score, topScore)));

  // ── Dependency: run the planner once over the whole library batch. ──
  const plan = planDependencies(goldDependencyCandidates());
  const dependencyHeld = new Set(plan.held.map((h) => h.id));

  let casesPassed = 0;
  let passed = 0;
  let total = 0;

  for (const c of cases) {
    const move = topMoveFor(c);
    const gotAction: GapKind | "none" = move?.gap ?? "none";
    const abstention = assessAbstention(c.expected.evidence);
    const gotBand = bandByCase.get(c.id) ?? "bottom";
    const gotDepHeld = dependencyHeld.has(c.id);

    let caseClean = true;

    // 1. action
    total += 1;
    if (gotAction === c.expected.action) passed += 1;
    else {
      caseClean = false;
      misses.push({ case: c.id, axis: "action", expected: c.expected.action, got: gotAction });
    }

    // 2. disposition. "ship" means the abstention gate says ready. "hold" is
    //    correct either when abstention holds it OR when the move itself is a
    //    non-actionable bucket (healthy / low_demand) the operator should sit on.
    total += 1;
    const isNonActionableBucket = gotAction === "healthy" || gotAction === "low_demand";
    const gotDisposition: "ship" | "hold" =
      c.expected.disposition === "hold"
        ? abstention.state === "watching" || isNonActionableBucket
          ? "hold"
          : "ship"
        : abstention.state === "ready" && !isNonActionableBucket
          ? "ship"
          : "hold";
    if (gotDisposition === c.expected.disposition) passed += 1;
    else {
      caseClean = false;
      misses.push({
        case: c.id,
        axis: "disposition",
        expected: c.expected.disposition,
        got: gotDisposition,
      });
    }

    // 3. rank band
    total += 1;
    if (gotBand === c.expected.rankBand) passed += 1;
    else {
      caseClean = false;
      misses.push({ case: c.id, axis: "rank_band", expected: c.expected.rankBand, got: gotBand });
    }

    // 4. dependency hold
    total += 1;
    const wantDepHeld = !!c.expected.dependencyHeld;
    if (gotDepHeld === wantDepHeld) passed += 1;
    else {
      caseClean = false;
      misses.push({
        case: c.id,
        axis: "dependency",
        expected: wantDepHeld ? "held" : "not_held",
        got: gotDepHeld ? "held" : "not_held",
      });
    }

    if (caseClean) casesPassed += 1;
  }

  return { evidenceClass: "known_case_regression", passed, total, casesPassed, casesTotal: cases.length, misses };
}

/**
 * The one honest operator line the benchmark earns. First person, a concrete
 * count, plain English, no dashes, no lab words. Rendered on a diagnostics-only
 * surface (never a primary customer screen). PURE.
 *
 * Example: "I checked myself against 8 known-good cases and got 8 right."
 */
export function benchmarkOperatorLine(report: BenchmarkReport): string {
  if (report.casesPassed === report.casesTotal) {
    return `I rechecked ${report.casesTotal} known cases and still get all ${report.casesPassed} right. This catches regressions, but it is not a blind test.`;
  }
  return `I rechecked ${report.casesTotal} known cases and now miss ${report.casesTotal - report.casesPassed}. This regression must be fixed before release.`;
}
