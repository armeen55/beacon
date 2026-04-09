import type { Result } from "./types";

/** Imported-looking row with no visibility ObservationRun id (pre–row-provenance import). */
export function resultVisibilityRowLegacyUnstamped(r: Result): boolean {
  return (
    !r.visibility_observation_run_id &&
    !!(r.source_system || r.import_batch_id)
  );
}
