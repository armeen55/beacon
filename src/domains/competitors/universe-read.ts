/**
 * Competitor universe resolution.
 *
 * **Intentional `readDotDataJson` use:** When `DATA_SOURCE=file`, the v2 file holds
 * pin/version metadata that is not fully represented in `competitor_config` rows alone.
 * In `DATA_SOURCE=supabase` mode, entries come only from `repo.getCompetitorConfigEntries()`.
 */
import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import { getRepository } from "@/lib/persistence/repositories";
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

const IS_SUPABASE = process.env.DATA_SOURCE === "supabase";
const repo = getRepository();

const _dbConfigEntries = IS_SUPABASE
  ? await repo.getCompetitorConfigEntries()
  : [];

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
 *
 * In supabase mode, entries come from `competitor_config` table; pin is
 * reconstructed (the DB doesn't store version/fingerprint metadata).
 */
export async function loadCompetitorUniverseRuntime(): Promise<CompetitorUniverseRuntime> {
  if (IS_SUPABASE && _dbConfigEntries.length > 0) {
    const fp = computeCompetitorUniverseFingerprint(_dbConfigEntries);
    return buildRuntime("configured_file", _dbConfigEntries, {
      universe_version: null,
      universe_fingerprint: fp,
      legacy_unversioned_file: false,
      fingerprint_mismatch: false,
    });
  }

  if (!IS_SUPABASE) {
    const raw = await readDotDataJson<CompetitorUniverseFile>("competitor-universe");
    const parsed = parseUniverseFile(raw);
    if (parsed) {
      return buildRuntime("configured_file", parsed.entries, parsed.pin);
    }
  }

  if (await hasActiveExperiment()) {
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
