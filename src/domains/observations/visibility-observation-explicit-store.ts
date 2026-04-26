import { cache } from "react";

import { getRepository } from "@/lib/persistence/repositories";
import type { VisibilityObservationRun } from "./visibility-types";

let _state: VisibilityObservationRun[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await getRepository().getVisibilityObservationRunsExplicit();
});

/** Rows from `visibility-observation-runs.json` (disk-backed until a DB table exists). */
export const getVisibilityObservationRunsExplicit = cache(
  async (): Promise<VisibilityObservationRun[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export function _resetVisibilityObservationRunsExplicitForTests(): void {
  _state = null;
}
