import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";
import { parseUniverseFile } from "./universe-file-parse";
import type { CompetitorUniverseFile } from "./universe-schema";
import type { ObservationCompetitorUniverseFields } from "./universe-types";

/**
 * Pin fields for CLI tools (e.g. scan-owned-pages) without importing server-only `seed-data.server`.
 * If `.data/competitor-universe.json` is missing or empty → empty scope.
 */
export function observationUniverseFieldsForCli(
  raw: CompetitorUniverseFile | null | undefined
): ObservationCompetitorUniverseFields {
  const parsed = parseUniverseFile(raw);
  if (!parsed) {
    const fp = computeCompetitorUniverseFingerprint([]);
    return {
      competitor_universe_version: 0,
      competitor_universe_fingerprint: fp,
      competitor_universe_scope: "empty",
      competitor_universe_pin_status: "pinned",
    };
  }
  return {
    competitor_universe_version: parsed.pin.universe_version,
    competitor_universe_fingerprint: parsed.pin.universe_fingerprint,
    competitor_universe_scope: "configured_file",
    competitor_universe_pin_status: "pinned",
  };
}
