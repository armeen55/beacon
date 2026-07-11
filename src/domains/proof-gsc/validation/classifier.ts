/**
 * The C4 candidate classifier. PURE, deterministic, frozen-config driven.
 *
 * Verdict rules (all binding conditions from proof-validation-protocol.md):
 *   - Exactly ONE judged metric per unit (L7). CTR-lever action types are
 *     judged on CTR; position-lever action types REMAP to clicks (C5: the
 *     position lane has no validated null, so it never judges); everything
 *     else is clicks. Impressions can never move the verdict (C8: the
 *     upgrade path does not exist here, deleted not gated).
 *   - Clicks lane statistic is variance stabilized (L8):
 *       stat = [log(postClicks + 1) - log(preClicks * scale + 1)]
 *              - mean over controls of the same quantity.
 *   - CTR lane statistic is the absolute CTR diff in diff, guarded so a
 *     window with zero impressions is MISSING data, never a 0 rate.
 *   - The permutation gate GATES THE VERDICT (C6): won/lost additionally
 *     requires the two sided matched-null permutation p at or below alpha.
 *   - Explicit abstention: insufficient history, insufficient baseline, no
 *     clean controls (C10: no fallback admission), missing rate data, thin
 *     null. An uncalibrated tier renders no_clear_effect only (C3).
 */

import { pickProofMetric } from "../measure";
import type { WindowAgg, C4Lane, C4Read, C4FrozenConfig, FloorEntry } from "./types";
import { log1pSafe, mean, permutationP } from "./stats";

/** The single ship-time judged metric for an action type (C4 mapping).
 *  Derives from the deployed pickProofMetric so the action-type mapping can
 *  never drift; the ONE change is that position-lever actions REMAP to the
 *  clicks lane (C5: no validated position null, so it never judges). */
export function judgedLaneOf(actionType: string): C4Lane {
  return pickProofMetric(actionType) === "ctr" ? "ctr" : "clicks";
}

export type LaneStatInput = {
  lane: C4Lane;
  treatedPre: WindowAgg;
  treatedPost: WindowAgg;
  controls: ReadonlyArray<{ pre: WindowAgg; post: WindowAgg }>;
  /** Post window length divided by pre window length (scales pre clicks). */
  minControls: number;
};

export type LaneStat =
  | { ok: true; stat: number; validControls: number }
  | { ok: false; reason: "missing_rate_data"; validControls: number };

/**
 * The judged diff in diff statistic for one unit. For the CTR lane a control
 * whose pre or post window has zero impressions is MISSING (no rate exists);
 * per the predeclared missing-data rule (L4) missing controls are never
 * replaced at read time, and the read abstains when survivors fall below
 * minControls. For the clicks lane a zero is a real value (GSC semantics).
 */
export function computeLaneStat(input: LaneStatInput): LaneStat {
  const { treatedPre, treatedPost, controls } = input;
  const scale = treatedPre.windowDays > 0 ? treatedPost.windowDays / treatedPre.windowDays : 1;
  if (input.lane === "clicks") {
    const d = (pre: WindowAgg, post: WindowAgg) => log1pSafe(post.clicks) - log1pSafe(pre.clicks * scale);
    const controlDeltas = controls.map((c) => d(c.pre, c.post));
    return {
      ok: true,
      stat: d(treatedPre, treatedPost) - mean(controlDeltas),
      validControls: controls.length,
    };
  }
  // CTR lane.
  const hasRate = (w: WindowAgg) => w.impressions > 0;
  if (!hasRate(treatedPre) || !hasRate(treatedPost)) {
    return { ok: false, reason: "missing_rate_data", validControls: 0 };
  }
  const valid = controls.filter((c) => hasRate(c.pre) && hasRate(c.post));
  if (valid.length < input.minControls) {
    return { ok: false, reason: "missing_rate_data", validControls: valid.length };
  }
  const controlDeltas = valid.map((c) => c.post.ctr - c.pre.ctr);
  return {
    ok: true,
    stat: treatedPost.ctr - treatedPre.ctr - mean(controlDeltas),
    validControls: valid.length,
  };
}

export type ClassifyInput = {
  lane: C4Lane;
  treatedPre: WindowAgg;
  treatedPost: WindowAgg;
  controls: ReadonlyArray<{ pre: WindowAgg; post: WindowAgg }>;
  /** From matching: true when strict matching found < minControls. */
  controlsInsufficient: boolean;
  /** Pre and post windows fully inside finalized snapshot coverage. */
  historyComplete: boolean;
  floorEntry: FloorEntry;
  /** Matched-null statistics in the SAME unit as the treated stat (C6/L10). */
  nullStats: ReadonlyArray<number>;
  config: Pick<C4FrozenConfig, "minBaselineImpressions" | "minControls"> & {
    permutation: Pick<C4FrozenConfig["permutation"], "alpha" | "minNullStats">;
  };
};

/**
 * One C4 read. The ONLY paths to "won"/"lost" are through the floor AND the
 * permutation gate on the single judged metric; every other outcome is
 * no_clear_effect or an explicit abstention. Pinned by tests (demote-only:
 * nothing here can upgrade a verdict).
 */
export function classifyC4(input: ClassifyInput): C4Read {
  const abstain = (reason: C4Read["abstention"] & string): C4Read => ({
    verdict: "insufficient_data",
    stat: null,
    permutationP: null,
    nullSize: 0,
    floor: null,
    abstention: reason,
  });

  if (!input.historyComplete) return abstain("insufficient_history");
  if (input.treatedPre.impressions < input.config.minBaselineImpressions) {
    return abstain("insufficient_baseline");
  }
  if (input.controlsInsufficient || input.controls.length < input.config.minControls) {
    return abstain("no_clean_controls");
  }
  const laneStat = computeLaneStat({
    lane: input.lane,
    treatedPre: input.treatedPre,
    treatedPost: input.treatedPost,
    controls: input.controls,
    minControls: input.config.minControls,
  });
  if (!laneStat.ok) return abstain("missing_rate_data");
  if (input.nullStats.length < input.config.permutation.minNullStats) {
    return abstain("thin_null");
  }
  const p = permutationP(laneStat.stat, input.nullStats);
  const floor = input.floorEntry.floor;
  let verdict: C4Read["verdict"] = "no_clear_effect";
  if (input.floorEntry.calibrated && p <= input.config.permutation.alpha) {
    if (laneStat.stat >= floor) verdict = "won";
    else if (laneStat.stat <= -floor) verdict = "lost";
  }
  return {
    verdict,
    stat: laneStat.stat,
    permutationP: p,
    nullSize: input.nullStats.length,
    floor,
    abstention: null,
  };
}
