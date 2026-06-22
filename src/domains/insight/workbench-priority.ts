/**
 * Insight layer — Workbench action-priority (Deep Workbench Optimizer, slice 2).
 * PURE. Turns the per-lever matrix (slice 1) into the "do this first" layer:
 * a single VERDICT chip per lever and five named picks (best single / best
 * bigger / safest / fastest-measurable / highest-upside). Reads ONLY the fields
 * the matrix rows already carry — it can never disagree with a row.
 *
 * Cannibalization is excluded from every pick (it is filtered out of the
 * candidate set below): consolidation is an operator cluster decision, never the
 * one-click headline move — matching the operator correction that
 * cannibalization is one signal, not the headline.
 */

import type { LeverKey, WorkbenchLeverRow } from "./workbench-matrix";

export type VerdictChip =
  | "Ship this now"
  | "Hold this"
  | "Needs SERP check"
  | "Needs Wix mapping"
  | "Manual only"
  | "Do not touch";

export type WorkbenchPick = { lever: LeverKey; oneLine: string } | null;

export type WorkbenchPicks = {
  /** The single highest-leverage move on this page right now. */
  bestSingle: WorkbenchPick;
  /** The bigger content investment (depth / answer / sections) when warranted. */
  bestBigger: WorkbenchPick;
  /** The lowest-risk, most-reversible move. */
  safest: WorkbenchPick;
  /** A change whose effect is observable fastest in Search (title/meta CTR). */
  fastestMeasurable: WorkbenchPick;
  /** The biggest potential upside, regardless of effort (labelled speculative). */
  highestUpside: WorkbenchPick;
};

const RISK_ORDER: Record<WorkbenchLeverRow["risk"], number> = { low: 0, medium: 1, high: 2 };
const CONF_WEIGHT: Record<"high" | "medium" | "low", number> = { high: 1, medium: 0.6, low: 0.3 };
const BODY_LEVERS = new Set<LeverKey>(["answer_block", "h2_sections", "visible_qa"]);

/**
 * How actionable a lever is RIGHT NOW (higher = better): a fully shippable
 * "Ship this now" lever beats one that merely has a draft, which beats one that
 * still needs the analysis endpoint / has no draft. Used only as a tie-break so
 * the headline "do this first" never surfaces a lever the operator can't act on
 * over an equal-estimate one they can.
 */
function actionability(r: WorkbenchLeverRow): number {
  if (decideVerdict(r) === "Ship this now") return 2;
  if (r.proposedSource === "deterministic" || r.proposedSource === "llm_brief") return 1;
  return 0;
}

/**
 * The single verdict chip for a lever. Precedence (highest binding constraint
 * first): not-warranted → SERP guard → no Wix mapping → manual-only path →
 * draft-not-available → fully shippable → otherwise hold.
 */
export function decideVerdict(row: WorkbenchLeverRow): VerdictChip {
  if (!row.needed) {
    return row.status === "ok" ? "Do not touch" : "Hold this";
  }
  if (row.serpGuardLabel) return "Needs SERP check";
  if (row.pushMethod === "blocked_no_mapping") return "Needs Wix mapping";
  if (row.pushMethod === "no_write_path" || row.pushMethod === "manual_cms_edit") {
    return "Manual only";
  }
  if (row.proposedSource === "needs_endpoint") return "Hold this";
  if (
    row.pushMethod === "wix_cms_field" &&
    row.canAutoApply &&
    row.rollbackReady &&
    row.risk === "low"
  ) {
    return "Ship this now";
  }
  return "Hold this";
}

function score(r: WorkbenchLeverRow): number {
  return r.benefit ? r.benefit.estClicksAtStake * CONF_WEIGHT[r.benefit.confidence] : 0;
}

function oneLine(r: WorkbenchLeverRow): string {
  const v = decideVerdict(r).toLowerCase();
  const b = r.benefit
    ? ` (~${r.benefit.estClicksAtStake.toLocaleString()} clicks at stake, ${r.benefit.confidence} confidence)`
    : "";
  return `${r.label}: ${v}${b}`;
}

function toPick(r: WorkbenchLeverRow | undefined | null): WorkbenchPick {
  return r ? { lever: r.lever, oneLine: oneLine(r) } : null;
}

/**
 * Pick the five named moves over the matrix rows. Pure. Cannibalization is
 * excluded from bestSingle/fastest (it is an operator-choice cluster move) and
 * only reaches bestBigger if it carries a leading estimate (it does not today).
 */
export function prioritizeWorkbench(rows: WorkbenchLeverRow[]): WorkbenchPicks {
  const needed = rows.filter((r) => r.needed && r.lever !== "cannibalization");
  if (needed.length === 0) {
    return {
      bestSingle: null,
      bestBigger: null,
      safest: null,
      fastestMeasurable: null,
      highestUpside: null,
    };
  }

  const byScore = [...needed].sort((a, b) => score(b) - score(a));

  // bestSingle: the highest-leverage needed lever; on an estimate tie prefer the
  // lever the operator can actually act on now (shippable / has a draft) over one
  // still waiting on the endpoint, then a faster CMS-field lever over a body lever.
  const bestSingle = [...needed].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    const act = actionability(b) - actionability(a);
    if (act !== 0) return act;
    return (BODY_LEVERS.has(a.lever) ? 1 : 0) - (BODY_LEVERS.has(b.lever) ? 1 : 0);
  })[0];

  // bestBigger: the strongest content-depth play (answer/sections/Q&A).
  const bestBigger = [...needed]
    .filter((r) => BODY_LEVERS.has(r.lever))
    .sort((a, b) => score(b) - score(a))[0];

  // safest: lowest risk; tie-break to a real rollback then to a known push.
  const safest = [...needed].sort(
    (a, b) =>
      RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
      Number(b.rollbackReady) - Number(a.rollbackReady) ||
      Number(b.canAutoApply) - Number(a.canAutoApply),
  )[0];

  // fastestMeasurable: a title/meta CTR field with a benefit (moves + reads in
  // GSC within days), highest-benefit first.
  const fastest = needed
    .filter((r) => (r.lever === "title" || r.lever === "meta") && r.benefit)
    .sort((a, b) => score(b) - score(a))[0];

  // highestUpside: the biggest underlying opportunity. Prefer the depth play
  // when this is a thin/striking page with little recoverable CTR (benefit is
  // small), else the top click lever.
  const topClickScore = byScore[0] ? score(byScore[0]) : 0;
  const highestUpside =
    bestBigger && topClickScore < 100 ? bestBigger : byScore[0];

  return {
    bestSingle: toPick(bestSingle),
    bestBigger: toPick(bestBigger),
    safest: toPick(safest),
    fastestMeasurable: toPick(fastest),
    highestUpside: toPick(highestUpside),
  };
}
