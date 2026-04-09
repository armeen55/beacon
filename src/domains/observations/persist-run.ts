import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ObservationRun } from "./types";

const CAP = 50;

/**
 * Append a website observation row to `.data/observation-runs.json` (scan + verify passes).
 * Mirrors `scripts/scan-owned-pages.ts` so server actions stay consistent with CLI.
 */
export function appendObservationRunSync(run: ObservationRun): void {
  const dir = join(process.cwd(), ".data");
  const path = join(dir, "observation-runs.json");
  let runs: ObservationRun[] = [];
  if (existsSync(path)) {
    try {
      runs = JSON.parse(readFileSync(path, "utf8")) as ObservationRun[];
    } catch {
      runs = [];
    }
  }
  runs.push(run);
  if (runs.length > CAP) runs = runs.slice(-CAP);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(runs, null, 2), "utf8");
  renameSync(tmp, path);
}
