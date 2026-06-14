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
import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";
import { normalizeCompetitorDomain } from "./universe-normalize";
import type {
  CompetitorUniverseRuntime,
  CompetitorUniversePin,
} from "./universe-types";
import type { CompetitorUniverseFile } from "./universe-schema";
import { parseUniverseFile } from "./universe-file-parse";

const IS_SUPABASE = process.env.DATA_SOURCE === "supabase";

/**
 * Audit #4 (2026-06-10): competitor_config rows are PER-TENANT (the table
 * carries tenant_id). The prior module-level top-level `await
 * repo.getCompetitorConfigEntries()` read EVERY tenant's rows ONCE at
 * import and froze them for the whole serverless instance — so every
 * tenant's /competitors page showed the first-loaded mix. Now resolved
 * per-call and filtered to the ambient tenant, cached per-tenant.
 */
const _dbEntriesByTenant = new Map<
  string,
  CompetitorUniverseRuntime["entries"]
>();

async function loadTenantConfigEntries(): Promise<
  CompetitorUniverseRuntime["entries"]
> {
  if (!IS_SUPABASE) return [];
  let tenantId: string;
  try {
    const { currentTenantId } = await import("@/lib/tenant-context");
    tenantId = await currentTenantId();
  } catch {
    return [];
  }
  const cached = _dbEntriesByTenant.get(tenantId);
  if (cached) return cached;
  const all = await getRepository().getCompetitorConfigEntries();
  // Defensive tenant filter (rows carry tenant_id even if the TS type
  // doesn't surface it). Never serve another tenant's competitor set.
  const mine = all.filter((e) => {
    const t = (e as { tenant_id?: string }).tenant_id;
    return t == null || t === tenantId;
  });
  // If the rows DO carry tenant_id, drop the permissive null-pass entries
  // when any row matched this tenant (prevents legacy null rows leaking).
  const strict = mine.filter(
    (e) => (e as { tenant_id?: string }).tenant_id === tenantId,
  );
  const result = strict.length > 0 ? strict : mine.filter((e) => (e as { tenant_id?: string }).tenant_id == null);
  _dbEntriesByTenant.set(tenantId, result);
  return result;
}

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
  const dbConfigEntries = await loadTenantConfigEntries();
  if (IS_SUPABASE && dbConfigEntries.length > 0) {
    const fp = computeCompetitorUniverseFingerprint(dbConfigEntries);
    return buildRuntime("configured_file", dbConfigEntries, {
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
  // De-verticalized (2026-06-15): a tenant with no configured competitor
  // universe (and no active import) gets an HONEST EMPTY universe — NOT the
  // bundled builder demo competitors (De Mattei Construction, Palo Alto
  // Builders, Silicon Valley Custom Homes), which would surface a Bay-Area
  // builder's rivals on every other vertical's /competitors page. The empty
  // runtime renders as "No competitor universe configured — treat cited
  // external domains as uncategorized", identical to the empty-import path.
  const emptyFp = computeCompetitorUniverseFingerprint([]);
  return buildRuntime("empty_import_mode", [], {
    universe_version: 0,
    universe_fingerprint: emptyFp,
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
