import type { ConfiguredCompetitorEntry } from "./universe-types";

/** Legacy on-disk shape (pre-versioning). */
export type CompetitorUniverseFileV1 = {
  version: 1;
  updated_at: string;
  competitors: ConfiguredCompetitorEntry[];
};

/** Versioned workspace file. */
export type CompetitorUniverseFileV2 = {
  file_schema: 2;
  universe_version: number;
  universe_fingerprint: string;
  updated_at: string;
  competitors: ConfiguredCompetitorEntry[];
};

export type CompetitorUniverseFile = CompetitorUniverseFileV1 | CompetitorUniverseFileV2;

export function isUniverseFileV2(
  f: CompetitorUniverseFile | null | undefined
): f is CompetitorUniverseFileV2 {
  return f != null && (f as CompetitorUniverseFileV2).file_schema === 2;
}
