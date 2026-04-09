import type { Result } from "@/domains/results/types";
import type { VisibilityObservationRun } from "./visibility-types";
import {
  getVisibilityObservationRun,
  latestVisibilityObservationRun,
} from "./visibility-read";

/**
 * Pick the visibility ObservationRun that best matches the current Sample history
 * grid: dominant stamped `visibility_observation_run_id`, else latest known run.
 */
export function primaryVisibilityRunForResults(
  sampleResults: Result[]
): VisibilityObservationRun | null {
  const counts = new Map<string, number>();
  for (const r of sampleResults) {
    const id = r.visibility_observation_run_id?.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestId = id;
      bestN = n;
    }
  }
  if (bestId) {
    const resolved = getVisibilityObservationRun(bestId);
    if (resolved) return resolved;
  }
  return latestVisibilityObservationRun();
}
