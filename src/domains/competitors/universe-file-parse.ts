import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";
import type {
  CompetitorUniversePin,
  ConfiguredCompetitorEntry,
} from "./universe-types";
import {
  type CompetitorUniverseFile,
  isUniverseFileV2,
} from "./universe-schema";

export function parseUniverseFile(
  raw: CompetitorUniverseFile | null | undefined
): { entries: ConfiguredCompetitorEntry[]; pin: CompetitorUniversePin } | null {
  if (!raw?.competitors?.length) return null;
  const entries = raw.competitors.filter(Boolean);
  if (isUniverseFileV2(raw)) {
    const recomputed = computeCompetitorUniverseFingerprint(entries);
    const mismatch = raw.universe_fingerprint !== recomputed;
    return {
      entries,
      pin: {
        universe_version: raw.universe_version,
        universe_fingerprint: raw.universe_fingerprint,
        legacy_unversioned_file: false,
        fingerprint_mismatch: mismatch,
      },
    };
  }
  const fingerprint = computeCompetitorUniverseFingerprint(entries);
  return {
    entries,
    pin: {
      universe_version: 1,
      universe_fingerprint: fingerprint,
      legacy_unversioned_file: true,
      fingerprint_mismatch: false,
    },
  };
}
