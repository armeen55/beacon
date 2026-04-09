import type { ObservationRun } from "./types";
import type { VisibilityObservationRun } from "./visibility-types";
import { getObservationRun } from "./read";
import { getVisibilityObservationRun } from "./visibility-read";

export type ResolvedObservation =
  | { kind: "website"; run: ObservationRun }
  | { kind: "visibility"; run: VisibilityObservationRun };

export function resolveObservationById(id: string): ResolvedObservation | null {
  const website = getObservationRun(id);
  if (website) return { kind: "website", run: website };
  const visibility = getVisibilityObservationRun(id);
  if (visibility) return { kind: "visibility", run: visibility };
  return null;
}
