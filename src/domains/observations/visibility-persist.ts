import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { VisibilityObservationRun } from "./visibility-types";

const CAP = 80;

export function appendVisibilityObservationRunSync(
  run: VisibilityObservationRun
): void {
  const path = join(process.cwd(), ".data", "visibility-observation-runs.json");
  let runs: VisibilityObservationRun[] = [];
  if (existsSync(path)) {
    try {
      runs = JSON.parse(readFileSync(path, "utf8")) as VisibilityObservationRun[];
    } catch {
      runs = [];
    }
  }
  const withoutDup = runs.filter((r) => r.run_id !== run.run_id);
  withoutDup.push(run);
  const sorted = withoutDup.sort(
    (a, b) =>
      new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  );
  const trimmed =
    sorted.length > CAP ? sorted.slice(sorted.length - CAP) : sorted;
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(trimmed, null, 2), "utf8");
  renameSync(tmp, path);
}
