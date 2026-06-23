/**
 * TASK 3 — Deep Workbench Optimizer surface pins.
 *
 * The Workbench must headline the six operator moves (best/safest/highest-upside/
 * fastest/hold/bigger-later) from the pure optimizer, and the loader must feed it.
 * Source pins (the view is a server component) so a future edit cannot silently
 * drop a bucket or unwire the optimizer back to the old 5-pick BeaconsCall.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("Workbench view renders the optimizer's six moves", () => {
  const src = read("./workbench-view.tsx");
  it("imports the optimizer buckets and renders OptimizerView from data.optimizer", () => {
    expect(src).toContain('from "@/domains/insight/workbench-optimizer"');
    expect(src).toContain("<OptimizerView buckets={optimizer} />");
  });
  it("surfaces all six operator moves", () => {
    for (const label of [
      "Best next move",
      "Quickest win",
      "Biggest potential",
      "Easiest to track",
      "Hold / do not touch",
      "Worth doing later",
    ]) {
      expect(src).toContain(label);
    }
  });
  it("dropped the legacy 5-pick BeaconsCall surface", () => {
    expect(src).not.toContain("BeaconsCall");
  });
});

describe("Workbench loader feeds the optimizer", () => {
  const src = read("./workbench-data.ts");
  it("builds the optimizer over the matrix + proof + GSC ledger and exposes it on WorkbenchData", () => {
    expect(src).toContain("buildOptimizer({ matrix, proof, measuringActions, serp: null })");
    expect(src).toContain("optimizer: OptimizerBuckets");
  });
  it("derives measuringActions from the GSC shipped-change ledger (verdict measuring)", () => {
    expect(src).toContain("loadShippedChanges");
    expect(src).toContain('s.verdict === "measuring"');
  });
});
