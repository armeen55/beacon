import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import type { CompetitorUniverseRuntime, CompetitorUniverseOrigin } from "./universe-types";
import { splitCitedDomainsByUniverse, type CitedDomainRow } from "./universe-split";
import { competitorUniverseDriftNote } from "./universe-drift-copy";

/** Serializable summary for Results / client banners. */
export type ResultsCompetitorUniverseSummary = {
  origin: CompetitorUniverseOrigin;
  activeConfiguredCount: number;
  configuredNamesPreview: string[];
  topCitedConfiguredCount: number;
  topCitedUncategorizedCount: number;
  topCitedImportEntityCount: number;
  currentUniverseVersion: number | null;
  currentUniverseFingerprintShort: string | null;
  currentUniverseLegacyUnversionedFile: boolean;
  currentUniverseFingerprintMismatch: boolean;
  visibilityRunPinStatus: string | null;
  visibilityRunUniverseVersion: number | null;
  visibilityRunUniverseFingerprintShort: string | null;
  competitorUniverseDriftNote: string | null;
};

export function buildResultsCompetitorUniverseSummary(
  runtime: CompetitorUniverseRuntime,
  topExternalDomains: CitedDomainRow[],
  importCompetitorDomains: string[],
  primaryVisibilityRun: VisibilityObservationRun | null
): ResultsCompetitorUniverseSummary {
  const split = splitCitedDomainsByUniverse(
    topExternalDomains,
    runtime.domainToLabel,
    importCompetitorDomains
  );
  const names = runtime.entries
    .filter((e) => e.status === "active")
    .map((e) => e.display_name)
    .slice(0, 5);
  const drift = competitorUniverseDriftNote(runtime, primaryVisibilityRun);
  return {
    origin: runtime.origin,
    activeConfiguredCount: Object.keys(runtime.domainToLabel).length,
    configuredNamesPreview: names,
    topCitedConfiguredCount: split.configuredInSample.length,
    topCitedUncategorizedCount: split.uncategorizedSample.length,
    topCitedImportEntityCount: split.importRowDomainsInSample.length,
    currentUniverseVersion: runtime.pin.universe_version,
    currentUniverseFingerprintShort: runtime.pin.universe_fingerprint?.slice(0, 14) ?? null,
    currentUniverseLegacyUnversionedFile: runtime.pin.legacy_unversioned_file,
    currentUniverseFingerprintMismatch: !!runtime.pin.fingerprint_mismatch,
    visibilityRunPinStatus: primaryVisibilityRun?.competitor_universe_pin_status ?? null,
    visibilityRunUniverseVersion: primaryVisibilityRun?.competitor_universe_version ?? null,
    visibilityRunUniverseFingerprintShort:
      primaryVisibilityRun?.competitor_universe_fingerprint?.slice(0, 14) ?? null,
    competitorUniverseDriftNote: drift,
  };
}
