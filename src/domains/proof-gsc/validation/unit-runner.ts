/**
 * End-to-end classification of one placebo unit under the frozen config.
 * Shared by calibration (step 5/6), evaluation (step 8), the injection
 * suite, and the sensitivity pass (step 10) so every consumer runs the
 * IDENTICAL code path. Pure given the series index.
 */

import { addDays } from "../measure";
import type { C4FrozenConfig, C4Lane, C4Read, FloorEntry, PlaceboUnit, WindowAgg } from "./types";
import { classifyC4, computeLaneStat } from "./classifier";
import { buildMatchedNullStats } from "./permutation";
import { windowAgg, windowCovered, type SeriesIndex } from "./series";
import { permutationP } from "./stats";

export type UnitClassification = {
  unit: PlaceboUnit;
  lane: C4Lane;
  read: C4Read;
  /** Retained inputs so injection and jackknife re-gate without rebuilding
   *  the null (the null is independent of the treated page's own outcome). */
  nullStats: number[];
  treatedPre: WindowAgg;
  treatedPost: WindowAgg;
  controls: Array<{ path: string; pre: WindowAgg; post: WindowAgg }>;
  floorEntry: FloorEntry;
  historyComplete: boolean;
};

export function floorEntryFor(config: C4FrozenConfig, lane: C4Lane, windowDays: number, tier: PlaceboUnit["tier"]): FloorEntry {
  return (
    config.floors[lane][String(windowDays)]?.[tier] ?? {
      floor: config.minFloors[lane],
      calibrated: false,
      n: 0,
      widened: false,
    }
  );
}

export function classifyUnit(args: {
  index: SeriesIndex;
  unit: PlaceboUnit;
  lane: C4Lane;
  config: C4FrozenConfig;
  /** Untreated pool paths for the matched null (unit page, controls and
   *  alternates are excluded inside). */
  nullPoolPaths: ReadonlyArray<string>;
}): UnitClassification {
  const { index, unit, config } = args;
  const preStart = addDays(unit.shipDate, -config.preWindowDays);
  const postEnd = addDays(unit.shipDate, unit.windowDays);
  const historyComplete = windowCovered(index, preStart, unit.shipDate) && windowCovered(index, unit.shipDate, postEnd);
  const treatedPre = windowAgg(index, unit.path, preStart, unit.shipDate);
  const treatedPost = windowAgg(index, unit.path, unit.shipDate, postEnd);
  const controls = unit.controls.map((c) => ({
    path: c,
    pre: windowAgg(index, c, preStart, unit.shipDate),
    post: windowAgg(index, c, unit.shipDate, postEnd),
  }));
  const excluded = new Set<string>([unit.path, ...unit.controls, ...unit.alternates]);
  const nullBuild = buildMatchedNullStats({
    index,
    lane: args.lane,
    shipDate: unit.shipDate,
    windowDays: unit.windowDays,
    poolPaths: args.nullPoolPaths.filter((p) => !excluded.has(p)),
    config,
    salt: `${unit.id}:${args.lane}`,
  });
  const floorEntry = floorEntryFor(config, args.lane, unit.windowDays, unit.tier);
  const read = classifyC4({
    lane: args.lane,
    treatedPre,
    treatedPost,
    controls,
    controlsInsufficient: unit.controlsInsufficient,
    historyComplete,
    floorEntry,
    nullStats: nullBuild.stats,
    config,
  });
  return {
    unit,
    lane: args.lane,
    read,
    nullStats: nullBuild.stats,
    treatedPre,
    treatedPost,
    controls,
    floorEntry,
    historyComplete,
  };
}

/** Re-gate a classified unit with a REPLACED treated post window (injection
 *  suite) or a modified control list (jackknife / alternate sets). The null
 *  and floor stay frozen; only the treated read changes. */
export function regateUnit(args: {
  base: UnitClassification;
  config: C4FrozenConfig;
  treatedPost?: WindowAgg;
  controls?: ReadonlyArray<{ pre: WindowAgg; post: WindowAgg }>;
}): C4Read {
  const { base, config } = args;
  return classifyC4({
    lane: base.lane,
    treatedPre: base.treatedPre,
    treatedPost: args.treatedPost ?? base.treatedPost,
    controls: args.controls ?? base.controls,
    controlsInsufficient: (args.controls ?? base.controls).length < config.minControls,
    historyComplete: base.historyComplete,
    floorEntry: base.floorEntry,
    nullStats: base.nullStats,
    config,
  });
}

/** The unit's judged statistic alone (for floor calibration, which needs the
 *  statistic even when the placeholder floors would abstain the verdict). */
export function unitStatOnly(c: UnitClassification, config: C4FrozenConfig): number | null {
  if (!c.historyComplete) return null;
  if (c.treatedPre.impressions < config.minBaselineImpressions) return null;
  if (c.unit.controlsInsufficient || c.controls.length < config.minControls) return null;
  const s = computeLaneStat({
    lane: c.lane,
    treatedPre: c.treatedPre,
    treatedPost: c.treatedPost,
    controls: c.controls,
    minControls: config.minControls,
  });
  return s.ok ? s.stat : null;
}

/** Convenience: the p the unit's stat earns against its own frozen null. */
export function unitPermutationP(c: UnitClassification, stat: number): number {
  return permutationP(stat, c.nullStats);
}
