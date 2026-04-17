/**
 * Phase 1 — Schema-experiment matching ladder.
 *
 * Given a URL whose citations moved (or a post-deploy scan diff observed on
 * that URL), find the changelog entry that best explains it, using a 5-rung
 * specificity ladder. ONLY considers entries with
 * `change_family === "schema_experiment"` — legacy free-text entries stay on
 * their existing path.
 *
 *   1. exact    — URL + schema_types_added EQUALS scan delta + scan within 48h
 *   2. strong   — URL + schema_types_added SUPERSET-of scan delta + within 72h
 *   3. partial  — URL + asset_type match + any schema_* change_type within 7d
 *   4. fallback — URL match + free-text "schema" in change_description within 7d
 *   5. none     — nothing matches
 *
 * Pure function — no I/O, no side effects. Call this from the event-attributor
 * when `event.scope === "page_level"` AND the child ChangelogEntry has
 * `change_family === "schema_experiment"`. Non-schema events never call this.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { AssetType } from "@/lib/constants";
import type { SchemaMatchSpecificity } from "@/domains/events/types";

export type MatchSchemaExperimentInput = {
  /** URL whose citations moved. Full URL or absolute path; both work. */
  url: string;
  /** Asset type as classified by `classifyAssetType(url)`. */
  assetType: AssetType;
  /** Candidate pool. The matcher filters internally. */
  changelog: ChangelogEntry[];
  /** ISO 8601 timestamp of when the scan / movement was observed. */
  scanTimestamp: string;
  /**
   * Schema types that appeared on the page between the previous scan and
   * this scan (from snapshot diff). Empty array = no schema change on the
   * page this scan cycle; the matcher still runs for partial/fallback rules.
   */
  schemaTypesAddedOnPage: string[];
};

export type MatchSchemaExperimentResult = {
  entry: ChangelogEntry;
  specificity: SchemaMatchSpecificity;
} | null;

export function matchSchemaExperiment(
  opts: MatchSchemaExperimentInput,
): MatchSchemaExperimentResult {
  const {
    url,
    assetType,
    changelog,
    scanTimestamp,
    schemaTypesAddedOnPage,
  } = opts;

  const targetPath = normalizePath(url);
  const targetScanMs = parseTs(scanTimestamp);
  if (targetScanMs == null) return null;

  // Entries whose URL matches the target (exact path match). Every rule
  // requires this so compute once.
  const urlMatches = changelog.filter(
    (c) => c.url != null && normalizePath(c.url) === targetPath,
  );

  // Rule 1 — exact: schema_experiment + schema_types_added exactly equals
  // the page delta + scan within 48h.
  for (const c of urlMatches) {
    if (c.change_family !== "schema_experiment") continue;
    if (!c.schema_types_added) continue;
    if (!setsEqual(c.schema_types_added, schemaTypesAddedOnPage)) continue;
    if (hoursBetween(c.timestamp, scanTimestamp) > 48) continue;
    return { entry: c, specificity: "exact" };
  }

  // Rule 2 — strong: schema_experiment + schema_types_added is a SUPERSET of
  // the page delta + scan within 72h. (Covers the case where the operator's
  // deploy included more types than the detector observed on the page — e.g.
  // some types failed to render due to a cache miss — but at least the
  // observed delta is a subset of what was claimed.)
  for (const c of urlMatches) {
    if (c.change_family !== "schema_experiment") continue;
    if (!c.schema_types_added) continue;
    if (!isSupersetOf(c.schema_types_added, schemaTypesAddedOnPage)) continue;
    // Skip exact matches here since rule 1 already handled them.
    if (setsEqual(c.schema_types_added, schemaTypesAddedOnPage)) continue;
    if (hoursBetween(c.timestamp, scanTimestamp) > 72) continue;
    return { entry: c, specificity: "strong" };
  }

  // Rule 3 — partial: same asset_type + any schema_* change_type within 7d.
  // Useful when schema_types_added wasn't populated (e.g. entry created via
  // the legacy path but still known to be schema-related).
  for (const c of urlMatches) {
    if (c.asset_type !== assetType) continue;
    if (!c.change_type) continue;
    if (!c.change_type.startsWith("schema_")) continue;
    if (hoursBetween(c.timestamp, scanTimestamp) > 7 * 24) continue;
    return { entry: c, specificity: "partial" };
  }

  // Rule 4 — fallback: URL match + free-text "schema"/"json-ld" in the
  // description within 7d. This catches all legacy rows whose structured
  // fields were never populated.
  const fallbackRegex = /\b(schema|json-?ld)\b/i;
  for (const c of urlMatches) {
    if (!fallbackRegex.test(c.change_description)) continue;
    if (hoursBetween(c.timestamp, scanTimestamp) > 7 * 24) continue;
    return { entry: c, specificity: "fallback" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Specificity → confidence mapping — consumed by the event-attributor when
// converting the matcher's output into `c_scope` + `confidence_source`.
// ---------------------------------------------------------------------------

export const SPECIFICITY_SCOPE_MULTIPLIER: Record<
  SchemaMatchSpecificity,
  number
> = {
  exact: 1.0,
  strong: 0.85,
  partial: 0.65,
  fallback: 0.4,
  none: 0,
};

export function confidenceSourceFromSpecificity(
  specificity: SchemaMatchSpecificity,
): "measured" | "inference" {
  return specificity === "exact" || specificity === "strong"
    ? "measured"
    : "inference";
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

/** Strip scheme+host + trailing slash + lowercase. Matches detect-findings.norm. */
function normalizePath(u: string): string {
  return u
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function parseTs(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function hoursBetween(a: string, b: string): number {
  const aMs = parseTs(a);
  const bMs = parseTs(b);
  if (aMs == null || bMs == null) return Infinity;
  return Math.abs(aMs - bMs) / (60 * 60 * 1000);
}

function setsEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const A = new Set(a);
  for (const x of b) if (!A.has(x)) return false;
  return true;
}

function isSupersetOf<T>(superset: T[], subset: T[]): boolean {
  if (subset.length === 0) return false; // empty deltas don't count as strong
  const S = new Set(superset);
  for (const x of subset) if (!S.has(x)) return false;
  return true;
}
