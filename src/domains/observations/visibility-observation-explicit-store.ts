import { getRepository } from "@/lib/persistence/repositories";
import type { VisibilityObservationRun } from "./visibility-types";

const repo = getRepository();

/** Rows from `visibility-observation-runs.json` (disk-backed until a DB table exists). */
export const visibilityObservationRunsExplicit: VisibilityObservationRun[] =
  await repo.getVisibilityObservationRunsExplicit();
