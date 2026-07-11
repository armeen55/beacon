/**
 * Placebo set construction (runbook step 3, protocol Section 2.3).
 *
 *   - Stratified page-hash split: pages stratified by (traffic tier, page
 *     family), hash-ordered under the protocol's salt "c4val1", assigned
 *     alternating to CALIBRATION and EVALUATION. Page-disjoint by
 *     construction, deterministic, never traffic-ordered.
 *   - Calendar-disjoint: calibration pseudo ship dates live in 2025,
 *     evaluation dates in 2026, with full unit FOOTPRINTS (28d pre + post)
 *     disjoint between the sets, stronger than the protocol minimum.
 *   - Staggered pseudo ship dates: fixed week-aligned block dates at least
 *     4 weeks apart (L2a), so units spread across disjoint calendar blocks.
 *   - Control reuse cap (L2b): within one (set, window, selection lane) a
 *     page serves as a control for at most controlReuseCap units, and unit
 *     pages never serve as controls (unit/donor split per set and window).
 *   - Shadow-selection lane (C9/L3): units picked by mimicking the engine's
 *     decliner selection on PRE period data only: pages whose trailing 28d
 *     clicks dropped at least minDropFraction vs the prior 28d, ranked by
 *     absolute lost clicks.
 *   - Shock-window flags (L5): a unit whose footprint overlaps a shock
 *     window is flagged; step 8 reports FPR with and without flagged units.
 */

import { addDays, trafficTierOf, type TrafficTier } from "../measure";
import type { ShockWindow } from "../algorithm-weather";
import { overlappingShock } from "../algorithm-weather";
import type { C4FrozenConfig, PlaceboUnit } from "./types";
import { pageFamilyOf, preStatsFor, windowAgg, type SeriesIndex } from "./series";
import { selectMatchedControls } from "./matching";
import { hashKey } from "./rng";

export const SPLIT_SALT = "c4val1";
/** Families with fewer pool pages than this collapse into "other". */
export const MIN_FAMILY_PAGES = 8;
/** Share of each set half's pages that become unit pages; the rest are
 *  control donors (keeps unit and control pages disjoint, L2b). 0.45 makes
 *  the donor slot capacity (donors x reuseCap / controls) match the unit
 *  count at this tenant's census (P = 74), maximizing judged units. */
export const UNIT_PAGE_SHARE = 0.45;
/** Placement budget per unit page: calibration has 7 blocks spanning 30
 *  weeks (up to 3 footprint-disjoint placements per page); evaluation has
 *  4 blocks spanning 12 weeks (up to 2). */
export const MAX_PLACEMENTS: Record<"calibration" | "evaluation", number> = {
  calibration: 3,
  evaluation: 2,
};

export type PoolPage = {
  path: string;
  /** Average impressions per 28 days over the whole snapshot (stratification
   *  signal only; per-unit tier is measured at the unit's own pre window). */
  avg28Impressions: number;
  family: string;
  tier: TrafficTier;
};

/** Census the candidate pool: pages averaging at least minBaselineImpressions
 *  per 28 day window across the snapshot, outside the ledger exclusion set.
 *  Rare families are bucketed into "other" so strata stay meaningful. */
export function buildPool(args: {
  index: SeriesIndex;
  excludePaths: ReadonlySet<string>;
  minBaselineImpressions: number;
}): PoolPage[] {
  const raw: PoolPage[] = [];
  for (const path of args.index.pages.keys()) {
    if (args.excludePaths.has(path)) continue;
    const total = windowAgg(args.index, path, args.index.startDate, addDays(args.index.endDate, 1));
    const avg28 = args.index.totalDays > 0 ? (total.impressions * 28) / args.index.totalDays : 0;
    if (avg28 < args.minBaselineImpressions) continue;
    raw.push({ path, avg28Impressions: avg28, family: pageFamilyOf(path), tier: trafficTierOf(avg28) });
  }
  const familyCounts = new Map<string, number>();
  for (const p of raw) familyCounts.set(p.family, (familyCounts.get(p.family) ?? 0) + 1);
  for (const p of raw) {
    if ((familyCounts.get(p.family) ?? 0) < MIN_FAMILY_PAGES) p.family = "other";
  }
  return raw.sort((a, b) => a.path.localeCompare(b.path));
}

/** Stratified alternating hash split (protocol 2.3 rule 2). */
export function splitPool(pool: ReadonlyArray<PoolPage>): {
  calibration: PoolPage[];
  evaluation: PoolPage[];
} {
  const byStratum = new Map<string, PoolPage[]>();
  for (const p of pool) {
    const key = `${p.tier}::${p.family}`;
    const list = byStratum.get(key) ?? [];
    list.push(p);
    byStratum.set(key, list);
  }
  const calibration: PoolPage[] = [];
  const evaluation: PoolPage[] = [];
  for (const key of [...byStratum.keys()].sort()) {
    const pages = byStratum.get(key)!;
    pages.sort((a, b) => hashKey(a.path, SPLIT_SALT) - hashKey(b.path, SPLIT_SALT));
    pages.forEach((p, i) => (i % 2 === 0 ? calibration : evaluation).push(p));
  }
  return { calibration, evaluation };
}

export type SetDesign = {
  set: "calibration" | "evaluation";
  shipDates: string[];
};

/** Frozen block dates. Calibration footprints end 2025-12-31; evaluation
 *  footprints start 2026-02-04: fully calendar disjoint. All Wednesdays,
 *  spacing at least 4 weeks (L2a). */
export const CALIBRATION_SHIP_DATES = [
  "2025-05-07", "2025-06-11", "2025-07-16", "2025-08-20", "2025-09-24", "2025-10-29", "2025-12-03",
];
export const EVALUATION_SHIP_DATES = ["2026-03-04", "2026-04-01", "2026-04-29", "2026-05-27"];

/** Minimum separation between two placements on the SAME page so their
 *  footprints (28d pre + up to 28d post) never overlap. */
const SAME_PAGE_MIN_SEPARATION_DAYS = 56;

/** Greedy deterministic placement dates for one page: start at the
 *  hash-picked date, add compatible dates (at least 56 days from every
 *  chosen one) in hash-rotated order, up to maxPlacements. */
function placementDatesFor(dates: ReadonlyArray<string>, key: number, maxPlacements: number): string[] {
  const chosen: string[] = [dates[key % dates.length]!];
  const rotated = [...dates.slice(key % dates.length), ...dates.slice(0, key % dates.length)];
  for (const d of rotated) {
    if (chosen.length >= maxPlacements) break;
    const ok = chosen.every(
      (c) => Math.abs(Date.parse(d) - Date.parse(c)) / 86_400_000 >= SAME_PAGE_MIN_SEPARATION_DAYS,
    );
    if (ok && !chosen.includes(d)) chosen.push(d);
  }
  return chosen.sort();
}

export type BuildUnitsResult = {
  units: PlaceboUnit[];
  /** Pages reserved as control donors for this (set, window). */
  donorPaths: string[];
  unitPagePaths: string[];
};

/**
 * Build the RANDOM-page lane units for one (set, window): unit/donor split,
 * placement assignment, matched controls with the reuse cap, shock flags.
 * Units whose strict matching failed are still emitted (controlsInsufficient
 * true) so abstentions are counted honestly.
 */
export function buildRandomUnits(args: {
  index: SeriesIndex;
  setPages: ReadonlyArray<PoolPage>;
  design: SetDesign;
  windowDays: number;
  config: C4FrozenConfig;
  shocks: ReadonlyArray<ShockWindow>;
}): BuildUnitsResult {
  const { index, design, windowDays, config } = args;
  const salt = `${design.set}:${windowDays}:unitsplit`;
  const ordered = [...args.setPages].sort((a, b) => hashKey(a.path, salt) - hashKey(b.path, salt));
  const unitCount = Math.floor(ordered.length * UNIT_PAGE_SHARE);
  const unitPages = ordered.slice(0, unitCount);
  const donors = ordered.slice(unitCount);
  const donorPaths = donors.map((d) => d.path);

  // Placements: every unit page gets up to MAX_PLACEMENTS footprint
  // disjoint block dates, hash-assigned.
  const placements: Array<{ page: PoolPage; date: string }> = [];
  for (const page of unitPages) {
    const k = hashKey(page.path, `${salt}:date`);
    for (const date of placementDatesFor(design.shipDates, k, MAX_PLACEMENTS[design.set])) {
      placements.push({ page, date });
    }
  }
  placements.sort(
    (a, b) =>
      hashKey(`${a.page.path}::${a.date}`, salt) - hashKey(`${b.page.path}::${b.date}`, salt),
  );

  const usage = new Map<string, number>();
  const units: PlaceboUnit[] = [];
  for (const pl of placements) {
    units.push(
      buildOneUnit({
        index,
        set: design.set,
        selection: "random",
        windowDays,
        path: pl.page.path,
        family: pl.page.family,
        shipDate: pl.date,
        donorPaths,
        usage,
        config,
        shocks: args.shocks,
      }),
    );
  }
  return { units, donorPaths, unitPagePaths: unitPages.map((p) => p.path) };
}

/**
 * Shadow-selection lane (C9/L3): at each block date, mimic the engine's
 * decliner selection using PRE period data only: trailing 28d clicks vs the
 * prior 28d, drop of at least minDropFraction, prior window at least
 * minPriorWindowClicks, ranked by absolute lost clicks (the engine ranks
 * revival targets by what they are losing). Controls come from the same
 * donor pool with a separate reuse ledger.
 */
export function buildShadowUnits(args: {
  index: SeriesIndex;
  unitPagePaths: ReadonlyArray<string>;
  pagesByPath: ReadonlyMap<string, PoolPage>;
  design: SetDesign;
  windowDays: number;
  donorPaths: ReadonlyArray<string>;
  config: C4FrozenConfig;
  shocks: ReadonlyArray<ShockWindow>;
}): PlaceboUnit[] {
  const { index, design, windowDays, config } = args;
  const usage = new Map<string, number>();
  const units: PlaceboUnit[] = [];
  const used = new Set<string>();
  for (const date of design.shipDates) {
    const decliners: Array<{ path: string; drop: number }> = [];
    for (const path of args.unitPagePaths) {
      const recent = windowAgg(index, path, addDays(date, -28), date);
      const prior = windowAgg(index, path, addDays(date, -56), addDays(date, -28));
      if (prior.clicks < config.shadowSelection.minPriorWindowClicks) continue;
      const drop = prior.clicks - recent.clicks;
      if (drop < prior.clicks * config.shadowSelection.minDropFraction) continue;
      decliners.push({ path, drop });
    }
    decliners.sort(
      (a, b) => b.drop - a.drop || hashKey(a.path, `${design.set}:shadow`) - hashKey(b.path, `${design.set}:shadow`),
    );
    for (const d of decliners.slice(0, config.shadowSelection.topKPerDate)) {
      const key = `${d.path}::${date}`;
      if (used.has(key)) continue;
      used.add(key);
      const family = args.pagesByPath.get(d.path)?.family ?? "other";
      units.push(
        buildOneUnit({
          index,
          set: design.set,
          selection: "shadow",
          windowDays,
          path: d.path,
          family,
          shipDate: date,
          donorPaths: args.donorPaths,
          usage,
          config,
          shocks: args.shocks,
        }),
      );
    }
  }
  return units;
}

function buildOneUnit(args: {
  index: SeriesIndex;
  set: "calibration" | "evaluation";
  selection: "random" | "shadow";
  windowDays: number;
  path: string;
  family: string;
  shipDate: string;
  donorPaths: ReadonlyArray<string>;
  usage: Map<string, number>;
  config: C4FrozenConfig;
  shocks: ReadonlyArray<ShockWindow>;
}): PlaceboUnit {
  const { index, config } = args;
  const treatedPre = preStatsFor(index, args.path, args.shipDate, config.preWindowDays);
  const candidates = args.donorPaths.map((p) => preStatsFor(index, p, args.shipDate, config.preWindowDays));
  const id = `${args.set}:${args.selection}:${args.windowDays}:${args.path}:${args.shipDate}`;
  const matched = selectMatchedControls({
    treated: treatedPre,
    candidates,
    bands: config.matching,
    minControls: config.minControls,
    maxControls: config.maxControls,
    alternateCount: config.alternateCount,
    usage: args.usage,
    reuseCap: config.controlReuseCap,
    salt: id,
  });
  const footprintStart = addDays(args.shipDate, -config.preWindowDays);
  const footprintEnd = addDays(args.shipDate, args.windowDays);
  return {
    id,
    set: args.set,
    selection: args.selection,
    windowDays: args.windowDays,
    path: args.path,
    shipDate: args.shipDate,
    tier: trafficTierOf(treatedPre.impressions),
    family: args.family,
    controls: matched.controls,
    alternates: matched.alternates,
    controlsInsufficient: matched.insufficient,
    shockOverlap: overlappingShock(footprintStart, footprintEnd, args.shocks) != null,
  };
}
