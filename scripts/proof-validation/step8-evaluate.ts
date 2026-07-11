/**
 * Step 8: touch the EVALUATION set exactly once with the LOCKED rules.
 *
 *   - FPR per selection lane (random, shadow), per metric lane, per window,
 *     per tier, per family, with naive Wilson AND date-block bootstrap
 *     intervals (the wider one is binding, protocol L2c), with and without
 *     shock-overlapping units.
 *   - Release gate per C3: point FPR at or below 5 percent AND the
 *     cluster-adjusted 95 percent upper bound at or below 12 percent.
 *   - Synthetic-lift injection suite (protocol Section 3) on the same
 *     frozen rules: detection rate by lift size, tier, window, variant,
 *     direction; MDE = smallest lift with at least 80 percent detection.
 *
 * A second run refuses: the evaluation set is then SPENT (protocol step 12).
 */

import { addDays } from "@/domains/proof-gsc/measure";
import { TRAFFIC_TIERS } from "@/domains/proof-gsc/measure";
import { dailySlice } from "@/domains/proof-gsc/validation/series";
import { injectedPostAgg, type InjectionVariant } from "@/domains/proof-gsc/validation/injection";
import { classifyUnit, regateUnit, type UnitClassification } from "@/domains/proof-gsc/validation/unit-runner";
import { blockBootstrapInterval, wilsonInterval } from "@/domains/proof-gsc/validation/stats";
import type { C4Lane, TrafficTier } from "@/domains/proof-gsc/validation/types";
import {
  RUN_ID,
  evaluationTouchGuard,
  loadFrozenConfig,
  loadSnapshotIndex,
  loadUnits,
  stepOutputPath,
  writeJson,
} from "./lib";

const DELTAS = [0.05, 0.1, 0.2, 0.3, 0.5];
const VARIANTS: InjectionVariant[] = ["instant", "tapered"];

type EvalRow = {
  unitId: string;
  selection: string;
  lane: C4Lane;
  windowDays: number;
  tier: TrafficTier;
  family: string;
  block: string;
  shockOverlap: boolean;
  verdict: string;
  abstention: string | null;
  stat: number | null;
  p: number | null;
  floor: number | null;
  nullSize: number;
};

function cell(rows: EvalRow[], seed: string) {
  const judged = rows.filter((r) => r.verdict !== "insufficient_data");
  const hits = judged.filter((r) => r.verdict === "won" || r.verdict === "lost");
  const n = judged.length;
  const wilson = wilsonInterval(hits.length, n);
  const boot = blockBootstrapInterval({
    units: judged.map((r) => ({ block: r.block, hit: r.verdict === "won" || r.verdict === "lost" })),
    seedString: `${seed}:boot`,
  });
  const fpr = n > 0 ? hits.length / n : null;
  const bindingUpper = Math.max(wilson.upper, boot.upper);
  return {
    n,
    abstained: rows.length - n,
    hits: hits.length,
    fpr,
    wilson95: wilson,
    blockBootstrap95: { lower: boot.lower, upper: boot.upper, resamples: boot.resamples },
    bindingUpper,
    gate:
      n === 0
        ? "no_units"
        : n < 20
          ? "insufficient_units_for_certificate"
          : fpr != null && fpr <= 0.05 && bindingUpper <= 0.12
            ? "PASS"
            : "FAIL",
  };
}

async function main(): Promise<void> {
  evaluationTouchGuard("step8");
  const { index } = loadSnapshotIndex();
  const { config, sha256 } = loadFrozenConfig();
  const step3 = loadUnits();
  const evalUnits = step3.units.filter((u) => u.set === "evaluation");
  const nullPool = step3.poolPaths.evaluation;

  const rows: EvalRow[] = [];
  const classified: UnitClassification[] = [];
  let done = 0;
  for (const unit of evalUnits) {
    for (const lane of config.lanes) {
      const c = classifyUnit({ index, unit, lane, config, nullPoolPaths: nullPool });
      classified.push(c);
      rows.push({
        unitId: unit.id,
        selection: unit.selection,
        lane,
        windowDays: unit.windowDays,
        tier: unit.tier,
        family: unit.family,
        block: unit.shipDate,
        shockOverlap: unit.shockOverlap,
        verdict: c.read.verdict,
        abstention: c.read.abstention,
        stat: c.read.stat,
        p: c.read.permutationP,
        floor: c.read.floor,
        nullSize: c.read.nullSize,
      });
    }
    done += 1;
    if (done % 50 === 0) console.log(`  ... evaluated ${done}/${evalUnits.length} units`);
  }

  // FPR report.
  const fprReport: Record<string, unknown> = {};
  for (const selection of ["random", "shadow"]) {
    for (const lane of config.lanes) {
      for (const w of config.windows) {
        const scope = rows.filter((r) => r.selection === selection && r.lane === lane && r.windowDays === w);
        const key = `${selection}:${lane}:${w}`;
        fprReport[key] = {
          overall: cell(scope, key),
          byTier: Object.fromEntries(
            TRAFFIC_TIERS.map((t) => [t, cell(scope.filter((r) => r.tier === t), `${key}:${t}`)]),
          ),
          byFamily: Object.fromEntries(
            [...new Set(scope.map((r) => r.family))].sort().map((f) => [f, cell(scope.filter((r) => r.family === f), `${key}:${f}`)]),
          ),
          excludingShockOverlap: cell(scope.filter((r) => !r.shockOverlap), `${key}:noshock`),
          shockOverlapOnly: cell(scope.filter((r) => r.shockOverlap), `${key}:shock`),
        };
      }
    }
  }

  // Injection suite on clean no-effect evaluation reads.
  console.log("  running injection suite ...");
  const injectionRows: Array<{
    lane: C4Lane;
    windowDays: number;
    tier: TrafficTier;
    delta: number;
    variant: InjectionVariant;
    direction: "up" | "down";
    n: number;
    detected: number;
  }> = [];
  const injKey = (r: { lane: C4Lane; windowDays: number; tier: TrafficTier; delta: number; variant: InjectionVariant; direction: "up" | "down" }) =>
    `${r.lane}:${r.windowDays}:${r.tier}:${r.delta}:${r.variant}:${r.direction}`;
  const injMap = new Map<string, { n: number; detected: number }>();
  for (const c of classified) {
    if (c.read.verdict !== "no_clear_effect") continue;
    const post = dailySlice(index, c.unit.path, c.unit.shipDate, addDays(c.unit.shipDate, c.unit.windowDays));
    for (const delta of DELTAS) {
      for (const variant of VARIANTS) {
        for (const sign of [1, -1] as const) {
          const injected = injectedPostAgg({
            clicks: post.clicks,
            impressions: post.impressions,
            delta: sign * delta,
            variant,
            windowDays: c.unit.windowDays,
          });
          const read = regateUnit({ base: c, config, treatedPost: injected });
          const detected = sign > 0 ? read.verdict === "won" : read.verdict === "lost";
          const key = injKey({
            lane: c.lane,
            windowDays: c.unit.windowDays,
            tier: c.unit.tier,
            delta,
            variant,
            direction: sign > 0 ? "up" : "down",
          });
          const cur = injMap.get(key) ?? { n: 0, detected: 0 };
          cur.n += 1;
          if (detected) cur.detected += 1;
          injMap.set(key, cur);
        }
      }
    }
  }
  for (const [key, v] of injMap) {
    const [lane, w, tier, delta, variant, direction] = key.split(":");
    injectionRows.push({
      lane: lane as C4Lane,
      windowDays: Number(w),
      tier: tier as TrafficTier,
      delta: Number(delta),
      variant: variant as InjectionVariant,
      direction: direction as "up" | "down",
      n: v.n,
      detected: v.detected,
    });
  }
  injectionRows.sort((a, b) => injKey(a).localeCompare(injKey(b)));

  // MDE per (lane, window, tier): smallest instant up-lift with >= 80
  // percent detection; null when nothing reaches 80 percent at 50 percent.
  const mde: Array<{ lane: C4Lane; windowDays: number; tier: TrafficTier; direction: "up" | "down"; mde: number | null; n: number }> = [];
  for (const lane of config.lanes) {
    for (const w of config.windows) {
      for (const tier of TRAFFIC_TIERS) {
        for (const direction of ["up", "down"] as const) {
          const cells = injectionRows
            .filter((r) => r.lane === lane && r.windowDays === w && r.tier === tier && r.variant === "instant" && r.direction === direction)
            .sort((a, b) => a.delta - b.delta);
          const found = cells.find((r) => r.n > 0 && r.detected / r.n >= 0.8);
          mde.push({ lane, windowDays: w, tier, direction, mde: found?.delta ?? null, n: cells[0]?.n ?? 0 });
        }
      }
    }
  }

  const out = {
    runId: RUN_ID,
    lockedConfigSha256: sha256,
    label: "HELD-OUT EVALUATION, touched exactly once under the locked rules",
    fprReport,
    injection: {
      label: "synthetic multiplicative lifts injected into post-window daily rows of clean no-effect evaluation units",
      deltas: DELTAS,
      rows: injectionRows.map((r) => ({ ...r, rate: r.n > 0 ? r.detected / r.n : null, wilson95: wilsonInterval(r.detected, r.n) })),
      mde,
    },
    rows,
  };
  writeJson(stepOutputPath("step8-evaluation"), out);
  console.log(`[step8] evaluation complete: ${rows.length} unit-lane reads`);
  for (const [key, v] of Object.entries(fprReport)) {
    const o = (v as { overall: ReturnType<typeof cell> }).overall;
    console.log(`  ${key}: n=${o.n} hits=${o.hits} fpr=${o.fpr?.toFixed(3)} upper=${o.bindingUpper.toFixed(3)} gate=${o.gate}`);
  }
}

main().catch((e) => {
  console.error("[step8] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
