import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import { hasActiveExperiment } from "@/lib/seed-data.server";
import {
  DEMO_CONFIGURED_COMPETITOR_ENTRIES,
  DEMO_COMPETITOR_UNIVERSE_FINGERPRINT,
} from "./universe-defaults";
import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";
import { normalizeCompetitorDomain } from "./universe-normalize";
import type {
  CompetitorUniverseRuntime,
  CompetitorUniversePin,
} from "./universe-types";
import type { CompetitorUniverseFile } from "./universe-schema";
import { parseUniverseFile } from "./universe-file-parse";

function buildRuntime(
  origin: CompetitorUniverseRuntime["origin"],
  entries: CompetitorUniverseRuntime["entries"],
  pin: CompetitorUniversePin
): CompetitorUniverseRuntime {
  const domainToLabel: Record<string, string> = {};
  for (const e of entries) {
    if (e.status !== "active") continue;
    const k = normalizeCompetitorDomain(e.domain);
    if (!k) continue;
    domainToLabel[k] = e.display_name;
  }
  return { origin, entries, domainToLabel, pin };
}

/**
 * Load workspace competitor universe: file wins when present and non-empty;
 * else empty when an import experiment is active; else explicit demo defaults.
 */
export function loadCompetitorUniverseRuntime(): CompetitorUniverseRuntime {
  const raw = readDotDataJson<CompetitorUniverseFile>("competitor-universe");
  const parsed = parseUniverseFile(raw);
  if (parsed) {
    return buildRuntime("configured_file", parsed.entries, parsed.pin);
  }
  if (hasActiveExperiment()) {
    const emptyFp = computeCompetitorUniverseFingerprint([]);
    return buildRuntime("empty_import_mode", [], {
      universe_version: 0,
      universe_fingerprint: emptyFp,
      legacy_unversioned_file: false,
      fingerprint_mismatch: false,
    });
  }
  return buildRuntime("demo_defaults_explicit", DEMO_CONFIGURED_COMPETITOR_ENTRIES, {
    universe_version: null,
    universe_fingerprint: DEMO_COMPETITOR_UNIVERSE_FINGERPRINT,
    legacy_unversioned_file: false,
    fingerprint_mismatch: false,
  });
}

export function activeConfiguredDomainSet(
  runtime: CompetitorUniverseRuntime
): Set<string> {
  return new Set(Object.keys(runtime.domainToLabel));
}

/** Shape matches `GapLedgerCompetitorUniverseContext` (avoid importing gap-ledger here). */
export function competitorUniverseForGapLedger(
  runtime: CompetitorUniverseRuntime
): {
  origin: CompetitorUniverseRuntime["origin"];
  activeConfiguredCount: number;
  configuredDomainToLabel: Record<string, string>;
  universe_version: number | null;
  universe_fingerprint: string | null;
  legacy_unversioned_file: boolean;
  fingerprint_mismatch?: boolean;
} {
  return {
    origin: runtime.origin,
    activeConfiguredCount: Object.keys(runtime.domainToLabel).length,
    configuredDomainToLabel: runtime.domainToLabel,
    universe_version: runtime.pin.universe_version,
    universe_fingerprint: runtime.pin.universe_fingerprint,
    legacy_unversioned_file: runtime.pin.legacy_unversioned_file,
    fingerprint_mismatch: runtime.pin.fingerprint_mismatch,
  };
}
