/**
 * Harness-level tests: placebo design invariants (page-disjoint split,
 * calendar-disjoint sets, reuse cap, unit/donor disjointness), matched-null
 * reproducibility, unit runner gates, and ledger reclassification reason
 * codes. Deterministic synthetic snapshot; no I/O.
 */

import { describe, expect, it } from "vitest";
import { addDays } from "../measure";
import { buildFrozenConfig } from "./frozen-config";
import { buildSeriesIndex } from "./series";
import {
  buildPool,
  buildRandomUnits,
  buildShadowUnits,
  splitPool,
  CALIBRATION_SHIP_DATES,
  EVALUATION_SHIP_DATES,
} from "./placebo-design";
import { buildMatchedNullStats } from "./permutation";
import { classifyUnit, regateUnit } from "./unit-runner";
import { reclassifyLedgerRow, type LedgerRowLite } from "./ledger-reclassify";
import { oldClassifierRead, pickTopTrafficControls } from "./old-classifier";
import type { SnapshotDailyRow } from "./types";
import { fnv1a } from "./rng";

const START = "2025-03-15";
const END = "2026-07-07";

/** A deterministic synthetic tenant: N steady pages with hash-varied levels. */
function synthSnapshot(n: number): SnapshotDailyRow[] {
  const rows: SnapshotDailyRow[] = [];
  for (let p = 0; p < n; p++) {
    const path = p % 3 === 0 ? `/animals/page-${p}` : `/food/page-${p}`;
    const level = 2 + (fnv1a(path) % 5); // 2..6 clicks/day
    const impressions = 30 + (fnv1a(path) % 40); // 30..69/day => 840..1932 per 28d
    for (let d = START; d <= END; d = addDays(d, 1)) {
      // Small deterministic day wobble so variance is nonzero.
      const wobble = (fnv1a(`${path}:${d}`) % 3) - 1;
      rows.push({ path, date: d, clicks: Math.max(0, level + wobble), impressions, position: 6 });
    }
  }
  return rows;
}

const config = buildFrozenConfig({ runId: "test-run", version: "c4-test" });
const index = buildSeriesIndex(synthSnapshot(30), START, END);
const pool = buildPool({ index, excludePaths: new Set(), minBaselineImpressions: 200 });

describe("placebo design", () => {
  const { calibration, evaluation } = splitPool(pool);

  it("splits page-disjoint, deterministically, covering the whole pool", () => {
    const c = new Set(calibration.map((p) => p.path));
    const e = new Set(evaluation.map((p) => p.path));
    for (const p of c) expect(e.has(p)).toBe(false);
    expect(c.size + e.size).toBe(pool.length);
    const again = splitPool(pool);
    expect(again.calibration.map((p) => p.path)).toEqual(calibration.map((p) => p.path));
  });

  it("keeps calibration and evaluation unit FOOTPRINTS calendar-disjoint", () => {
    const calEnd = CALIBRATION_SHIP_DATES.map((d) => addDays(d, 28)).sort().at(-1)!;
    const evalStart = EVALUATION_SHIP_DATES.map((d) => addDays(d, -28)).sort()[0]!;
    expect(calEnd < evalStart).toBe(true);
  });

  it("builds units with donor-only controls, the reuse cap, and no same-page footprint overlap", () => {
    const res = buildRandomUnits({
      index,
      setPages: evaluation,
      design: { set: "evaluation", shipDates: EVALUATION_SHIP_DATES },
      windowDays: 28,
      config,
      shocks: [],
    });
    const unitPages = new Set(res.unitPagePaths);
    const donorSet = new Set(res.donorPaths);
    const usage = new Map<string, number>();
    for (const u of res.units) {
      for (const c of u.controls) {
        expect(unitPages.has(c)).toBe(false);
        expect(donorSet.has(c)).toBe(true);
        usage.set(c, (usage.get(c) ?? 0) + 1);
      }
    }
    for (const [, n] of usage) expect(n).toBeLessThanOrEqual(config.controlReuseCap);
    const byPage = new Map<string, string[]>();
    for (const u of res.units) {
      const dates = byPage.get(u.path) ?? [];
      dates.push(u.shipDate);
      byPage.set(u.path, dates);
    }
    for (const [, dates] of byPage) {
      if (dates.length === 2) {
        const gap = Math.abs(Date.parse(dates[0]!) - Date.parse(dates[1]!)) / 86_400_000;
        expect(gap).toBeGreaterThanOrEqual(56);
      }
      expect(dates.length).toBeLessThanOrEqual(2);
    }
    // Deterministic rebuild.
    const again = buildRandomUnits({
      index,
      setPages: evaluation,
      design: { set: "evaluation", shipDates: EVALUATION_SHIP_DATES },
      windowDays: 28,
      config,
      shocks: [],
    });
    expect(again.units.map((u) => u.id)).toEqual(res.units.map((u) => u.id));
  });

  it("shadow lane picks pre-period decliners only", () => {
    // Give one evaluation unit page a real pre-period crash before one date.
    const crashedPath = "/food/page-1";
    const rows = synthSnapshot(30).map((r) =>
      r.path === crashedPath && r.date >= "2026-03-04" ? { ...r, clicks: 0 } : r,
    );
    const idx2 = buildSeriesIndex(rows, START, END);
    const pool2 = buildPool({ index: idx2, excludePaths: new Set(), minBaselineImpressions: 200 });
    const { evaluation: eval2 } = splitPool(pool2);
    const rand = buildRandomUnits({
      index: idx2,
      setPages: eval2,
      design: { set: "evaluation", shipDates: ["2026-04-29"] },
      windowDays: 28,
      config,
      shocks: [],
    });
    const shadow = buildShadowUnits({
      index: idx2,
      unitPagePaths: rand.unitPagePaths,
      pagesByPath: new Map(eval2.map((p) => [p.path, p])),
      design: { set: "evaluation", shipDates: ["2026-04-29"] },
      windowDays: 28,
      donorPaths: rand.donorPaths,
      config,
      shocks: [],
    });
    if (rand.unitPagePaths.includes(crashedPath)) {
      expect(shadow.map((u) => u.path)).toContain(crashedPath);
    }
    for (const u of shadow) expect(u.selection).toBe("shadow");
  });
});

describe("matched null and unit runner", () => {
  it("null build is reproducible and unit-correct per lane", () => {
    const poolPaths = pool.map((p) => p.path);
    const one = buildMatchedNullStats({
      index, lane: "ctr", shipDate: "2026-04-01", windowDays: 28, poolPaths, config, salt: "u1",
    });
    const two = buildMatchedNullStats({
      index, lane: "ctr", shipDate: "2026-04-01", windowDays: 28, poolPaths, config, salt: "u1",
    });
    expect(one.stats).toEqual(two.stats);
    // CTR stats live on the 0 to 1 scale; synthetic CTVs are small.
    for (const s of one.stats) expect(Math.abs(s)).toBeLessThan(0.5);
    const clicks = buildMatchedNullStats({
      index, lane: "clicks", shipDate: "2026-04-01", windowDays: 28, poolPaths, config, salt: "u1",
    });
    expect(clicks.stats.length).toBeGreaterThan(0);
  });

  it("classifyUnit + regateUnit share the frozen null and controls", () => {
    const { evaluation } = splitPool(pool);
    const res = buildRandomUnits({
      index,
      setPages: evaluation,
      design: { set: "evaluation", shipDates: EVALUATION_SHIP_DATES },
      windowDays: 28,
      config,
      shocks: [],
    });
    const unit = res.units.find((u) => !u.controlsInsufficient);
    if (!unit) throw new Error("expected at least one matched unit");
    const c = classifyUnit({ index, unit, lane: "clicks", config, nullPoolPaths: pool.map((p) => p.path) });
    expect(["no_clear_effect", "insufficient_data"]).toContain(c.read.verdict);
    const regated = regateUnit({ base: c, config });
    expect(regated.verdict).toBe(c.read.verdict);
  });
});

describe("old classifier baseline", () => {
  it("reproduces deployed control choice (top traffic) and two-chance flagging shape", () => {
    const controls = pickTopTrafficControls({
      index,
      candidates: pool.map((p) => p.path),
      excludePath: pool[0]!.path,
      shipDate: "2026-04-01",
    });
    expect(controls).toHaveLength(3);
    const read = oldClassifierRead({
      index,
      path: pool[0]!.path,
      shipDate: "2026-04-01",
      controls,
      lastFinalizedDate: END,
    });
    expect(typeof read.flagged).toBe("boolean");
    expect(read.clicksVerdict).toBeDefined();
    expect(read.ctrVerdict).toBeDefined();
  });
});

describe("ledger reclassification", () => {
  const baseRow: LedgerRowLite = {
    id: "/food/page-1::2026-06-20",
    path: "/food/page-1",
    page: "https://example.com/food/page-1",
    actionType: "edit_title",
    shippedAt: "2026-06-20",
    verdict: "won",
    confidence: "medium",
    controlPages: ["/food/page-4", "/food/page-7", "/food/page-10"],
    donorPoolKept: ["/food/page-13", "/food/page-16"],
    baseline: { clicks: 100, impressions: 1400 },
    windows: [],
    verifiedLive: true,
    canonicalVerifyOutcome: "verified_live",
    lastVerifyAttemptState: null,
    operatorVerdictOverride: null,
  };

  it("an open primary window renders MEASURING with INSUFFICIENT_HISTORY (C7)", () => {
    const out = reclassifyLedgerRow({
      index,
      row: baseRow,
      config,
      lastFinalizedDate: "2026-07-07",
      treatedPaths: new Set([baseRow.path]),
      nullPoolPaths: pool.map((p) => p.path),
    });
    expect(out.bindingVerdict).toBe("measuring");
    expect(out.changed).toBe(true);
    expect(out.primaryReason).toBe("INSUFFICIENT_HISTORY");
    expect(out.judgedLane).toBe("ctr");
    expect(out.verification).toBe("crawl_verified");
    // Context read exists for the closed 7 day window and is labeled by its window.
    expect(out.contextRead?.windowDays).toBe(7);
  });

  it("a crawl not_found row is excluded from win and loss counts (L11)", () => {
    const out = reclassifyLedgerRow({
      index,
      row: { ...baseRow, canonicalVerifyOutcome: null, lastVerifyAttemptState: "not_found", verifiedLive: false },
      config,
      lastFinalizedDate: "2026-07-07",
      treatedPaths: new Set([baseRow.path]),
      nullPoolPaths: pool.map((p) => p.path),
    });
    expect(out.excludedFromWinLoss).toBe(true);
    expect(out.primaryReason).toBe("NOT_VERIFIED_LIVE");
  });

  it("a closed primary window produces a real C4 read with exactly one reason code on change", () => {
    const out = reclassifyLedgerRow({
      index,
      row: { ...baseRow, shippedAt: "2026-04-01" },
      config,
      lastFinalizedDate: "2026-07-07",
      treatedPaths: new Set([baseRow.path]),
      nullPoolPaths: pool.map((p) => p.path),
    });
    expect(out.bindingVerdict).not.toBe("measuring");
    if (out.changed) {
      expect(out.primaryReason).not.toBeNull();
    }
    // A placebo-quiet page must never reclassify to a decided verdict under
    // placeholder (uncalibrated) floors.
    expect(["no_clear_effect", "insufficient_data"]).toContain(out.bindingVerdict);
  });

  it("drops contaminated stored controls and refills only from the predeclared donor pool", () => {
    const out = reclassifyLedgerRow({
      index,
      row: { ...baseRow, shippedAt: "2026-04-01" },
      config,
      lastFinalizedDate: "2026-07-07",
      treatedPaths: new Set([baseRow.path, "/food/page-4"]),
      nullPoolPaths: pool.map((p) => p.path),
    });
    expect(out.controlsUsed).not.toContain("/food/page-4");
    expect(out.controlsDropped.map((d) => d.path)).toContain("/food/page-4");
  });
});
