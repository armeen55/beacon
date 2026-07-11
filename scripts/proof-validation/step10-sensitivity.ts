/**
 * Step 10: sensitivity. Part of the single evaluation pass (runs once,
 * after step 8, no rule changes).
 *   (a) control jackknife: drop each control from each judged evaluation
 *       unit and each ledger row read; report verdict flip fractions.
 *   (b) alternate matched sets: swap predeclared alternates in for the
 *       worst-ranked controls; report flip fractions.
 *   (c) FPR splits by tier and family are in step 8's report; referenced.
 */

import { classifyUnit, regateUnit } from "@/domains/proof-gsc/validation/unit-runner";
import { judgedLaneOf } from "@/domains/proof-gsc/validation/classifier";
import { ledgerReadAtWindow } from "@/domains/proof-gsc/validation/ledger-reclassify";
import { reclassifyLedgerRow } from "@/domains/proof-gsc/validation/ledger-reclassify";
import {
  RUN_ID,
  evaluationTouchGuard,
  loadFrozenConfig,
  loadLedgerRows,
  loadManifest,
  loadSnapshotIndex,
  loadUnits,
  stepOutputPath,
  writeJson,
} from "./lib";
import { toLite } from "./step9-reclassify";

async function main(): Promise<void> {
  evaluationTouchGuard("step10");
  const { index } = loadSnapshotIndex();
  const { config, sha256 } = loadFrozenConfig();
  const manifest = loadManifest();
  const step3 = loadUnits();
  const evalUnits = step3.units.filter((u) => u.set === "evaluation");
  const nullPool = step3.poolPaths.evaluation;

  // (a) + (b) on evaluation units.
  let judged = 0;
  let anyFlip = 0;
  let flipToAbstention = 0;
  let flipToOtherVerdict = 0;
  let altEligible = 0;
  let altFlip = 0;
  const fragileUnits: string[] = [];
  for (const unit of evalUnits) {
    for (const lane of config.lanes) {
      const base = classifyUnit({ index, unit, lane, config, nullPoolPaths: nullPool });
      if (base.read.verdict === "insufficient_data") continue;
      judged += 1;
      let flippedAbst = false;
      let flippedVerdict = false;
      for (let i = 0; i < base.controls.length; i++) {
        const dropped = base.controls.filter((_, j) => j !== i);
        const read = regateUnit({ base, config, controls: dropped });
        if (read.verdict === base.read.verdict) continue;
        if (read.verdict === "insufficient_data") flippedAbst = true;
        else flippedVerdict = true;
      }
      if (flippedAbst || flippedVerdict) {
        anyFlip += 1;
        fragileUnits.push(`${unit.id}:${lane}`);
      }
      if (flippedAbst) flipToAbstention += 1;
      if (flippedVerdict) flipToOtherVerdict += 1;
      // (b) alternates: replace the worst-ranked control with the best
      // predeclared alternate (and both, when two alternates exist).
      if (unit.alternates.length > 0 && base.controls.length >= config.minControls) {
        altEligible += 1;
        const variants: string[][] = [];
        const paths = base.controls.map((c) => c.path);
        variants.push([...paths.slice(0, -1), unit.alternates[0]!]);
        if (unit.alternates.length > 1 && paths.length >= 2) {
          variants.push([...paths.slice(0, -2), unit.alternates[0]!, unit.alternates[1]!]);
        }
        let flipped = false;
        for (const v of variants) {
          const c2 = classifyUnit({ index, unit: { ...unit, controls: v }, lane, config, nullPoolPaths: nullPool });
          if (c2.read.verdict !== base.read.verdict) flipped = true;
        }
        if (flipped) altFlip += 1;
      }
    }
  }

  // (a) on ledger rows: jackknife the context read (and the binding read
  // when its window closed).
  const ledger = loadLedgerRows().map(toLite);
  const treatedPaths = new Set(ledger.map((r) => r.path));
  const ledgerNullPool = [...step3.poolPaths.calibration, ...step3.poolPaths.evaluation];
  const ledgerRows: Array<{ id: string; window: number; baseVerdict: string; fragile: boolean }> = [];
  for (const row of ledger) {
    const rec = reclassifyLedgerRow({
      index,
      row,
      config,
      lastFinalizedDate: manifest.maxDate,
      treatedPaths,
      nullPoolPaths: ledgerNullPool,
    });
    const windows = rec.contextRead ? [rec.contextRead.windowDays] : [];
    if (rec.bindingRead != null) windows.push(config.primaryWindowDays);
    for (const w of windows) {
      const controls = rec.controlsUsed;
      if (controls.length < config.minControls) continue;
      const baseRead = ledgerReadAtWindow({
        index,
        rowId: row.id,
        path: row.path,
        shipDate: row.shippedAt.slice(0, 10),
        judgedLane: judgedLaneOf(row.actionType),
        controls,
        windowDays: w,
        config,
        lastFinalizedDate: manifest.maxDate,
        nullPoolPaths: ledgerNullPool,
      });
      let fragile = false;
      for (let i = 0; i < controls.length; i++) {
        const read = ledgerReadAtWindow({
          index,
          rowId: row.id,
          path: row.path,
          shipDate: row.shippedAt.slice(0, 10),
          judgedLane: judgedLaneOf(row.actionType),
          controls: controls.filter((_, j) => j !== i),
          windowDays: w,
          config,
          lastFinalizedDate: manifest.maxDate,
          nullPoolPaths: ledgerNullPool,
        });
        if (read.verdict !== baseRead.verdict) fragile = true;
      }
      ledgerRows.push({ id: row.id, window: w, baseVerdict: baseRead.verdict, fragile });
    }
  }

  const out = {
    runId: RUN_ID,
    lockedConfigSha256: sha256,
    evaluationJackknife: {
      judgedUnitLanes: judged,
      anyFlip,
      anyFlipFraction: judged > 0 ? anyFlip / judged : null,
      flipToAbstention,
      flipToOtherVerdict,
      fragileUnits,
    },
    alternateSets: {
      eligible: altEligible,
      flipped: altFlip,
      flipFraction: altEligible > 0 ? altFlip / altEligible : null,
    },
    ledgerJackknife: {
      reads: ledgerRows.length,
      fragile: ledgerRows.filter((r) => r.fragile).length,
      rows: ledgerRows,
    },
    fprSplitsReference: "per tier and per family FPR splits live in step8-evaluation.json (fprReport.byTier / byFamily)",
  };
  writeJson(stepOutputPath("step10-sensitivity"), out);
  console.log(`[step10] eval jackknife: ${anyFlip}/${judged} unit-lanes flip under a single-control drop`);
  console.log(`  alternates: ${altFlip}/${altEligible} flip`);
  console.log(`  ledger: ${out.ledgerJackknife.fragile}/${ledgerRows.length} reads fragile`);
}

main().catch((e) => {
  console.error("[step10] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
