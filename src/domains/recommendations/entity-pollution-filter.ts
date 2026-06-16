/**
 * Step 1.4 (master plan) — entity pollution filter.
 *
 * Drops directories ("Houzz", "Yelp", etc.) and obvious generic nouns
 * ("General Contractors", "Home Builders") from competitor-style surfaces
 * — leaderboards, compare dropdowns, recommendation co-mention rollups —
 * WITHOUT removing them from the entity registry. Directories remain
 * valid citation sources elsewhere (page citation history, evidence
 * audits); they just don't rank against real builders.
 *
 * Decision priority (operator-locked):
 *   1. Trust metadata first. `entity_type === "directory_source"` and
 *      blocklisted domains short-circuit to "exclude as directory".
 *   2. A real entity row tagged `competitor` / `brand` with any domain
 *      is KEPT even if its name sounds generic. Some real companies are
 *      called "Custom Home US" / "Bay Builders" — we trust metadata.
 *   3. Only when there's no metadata (raw mention string with no entity
 *      row) do we fall back to a strict generic-noun list.
 *
 * The filter is intentionally narrow. Non-rendering surfaces
 * (citation source tracking, raw observations, evidence detail views)
 * MUST NOT call this — directories are valid sources there.
 */

import type { TrackedEntity } from "@/domains/tracked-entities/types";

/**
 * Domains that should never rank as direct competitors regardless of
 * `entity_type` setting in the registry. Mirrors the curated list in
 * `src/adapters/profound/entity-seed.ts:DIRECTORY_DOMAINS` so the two
 * stay aligned by intent. Lower-cased keys.
 */
export const DIRECTORY_DOMAINS_FOR_FILTER: ReadonlySet<string> = new Set([
  "houzz.com",
  "yelp.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "buildzoom.com",
  "bbb.org",
  "diamondcertified.org",
  "generalcontractors.org",
  "homebuilderdigest.com",
  "homeguide.com",
]);

/**
 * Strict list of generic-noun names — only consulted when there's no
 * tracked-entity row to inform the decision. Keep short and high-signal;
 * anything ambiguous belongs in metadata, not here.
 */
const GENERIC_NOUN_NAMES: ReadonlySet<string> = new Set([
  "general contractors",
  "local contractors",
  "home builders",
  "custom home builders",
  "bay area builders",
  "architects",
]);

/**
 * Directory/aggregator BRAND NAMES — the name-based fallback companion to
 * `DIRECTORY_DOMAINS_FOR_FILTER`. Consulted only when a mention has no
 * tracked-entity row (so metadata can't tell us it's a directory) and the
 * raw mention string is just the brand name (e.g. "Angi", "Yelp"). Without
 * this, a directory mentioned in AI answers but never seeded as an entity
 * leaked onto the competitor compare-dropdown — e.g. Iranopedia (a Persian
 * culture/food site) defaulting its "Who AI thinks they are" comparison to
 * "Angi" (a home-services marketplace), a nonsensical competitor. Directory
 * status is vertical-agnostic, so this list is safe for every tenant. Keys
 * are normalized (lower-case); include the common display variants.
 */
const DIRECTORY_NAMES_FOR_FILTER: ReadonlySet<string> = new Set([
  "houzz",
  "yelp",
  "angi",
  "angie's list",
  "angies list",
  "homeadvisor",
  "home advisor",
  "thumbtack",
  "buildzoom",
  "bbb",
  "better business bureau",
  "diamond certified",
  "homeguide",
  "home guide",
  "trustpilot",
  "tripadvisor",
]);

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * True when the entity is itself a directory (per metadata or domain).
 * Safe to call without a name fallback — a directory always belongs in
 * citation-source surfaces, never on the competitor leaderboard.
 */
export function isDirectoryEntity(entity: TrackedEntity): boolean {
  if (entity.entity_type === "directory_source") return true;
  const domain = normalizeDomain(entity.domain);
  if (domain && DIRECTORY_DOMAINS_FOR_FILTER.has(domain)) return true;
  return false;
}

/**
 * Composite "exclude from competitor ranking" decision.
 *
 * - When `entity` is supplied, metadata wins:
 *     directory_source / blocklisted-domain  → exclude
 *     competitor / brand with any domain      → keep (even if name is
 *       generic-sounding — real companies exist with vague names)
 *     other / no-metadata                     → fall through to name list
 * - When `entity` is null/undefined, fall through to the strict
 *   generic-noun list. Any plain mention not on that list is kept.
 *
 * Operator-facing copy (for any debug surface that explains why a row
 * is missing): "directory source, not competitor" or "excluded from
 * competitor ranking" — never "removed from data."
 */
export function shouldExcludeFromCompetitorRanking(
  name: string,
  entity?: TrackedEntity | null,
): boolean {
  if (entity) {
    if (isDirectoryEntity(entity)) return true;
    if (entity.entity_type === "competitor" || entity.entity_type === "brand") {
      // Real business with metadata. Trust it.
      return false;
    }
    // Other entity types ("domain", "page") — fall through to name check.
  }
  const normalized = normalizeName(name);
  return (
    GENERIC_NOUN_NAMES.has(normalized) ||
    DIRECTORY_NAMES_FOR_FILTER.has(normalized)
  );
}

/**
 * Build a lookup over `trackedEntities` keyed by normalized name + each
 * alias. Used by callers that receive a raw mention string and want to
 * resolve it to an entity row before deciding whether to exclude it.
 *
 * Entries are first-write-wins so a manually-curated row beats any
 * later auto-discovered duplicate.
 */
export function buildEntityLookupByName(
  trackedEntities: ReadonlyArray<TrackedEntity>,
): Map<string, TrackedEntity> {
  const out = new Map<string, TrackedEntity>();
  for (const e of trackedEntities) {
    const key = normalizeName(e.name);
    if (!out.has(key)) out.set(key, e);
    for (const alias of e.aliases ?? []) {
      const aKey = normalizeName(alias);
      if (!out.has(aKey)) out.set(aKey, e);
    }
  }
  return out;
}

/**
 * Convenience: combine `buildEntityLookupByName` + the exclusion decision
 * for the common call site that just iterates raw mention strings.
 */
export function makeCompetitorRankingFilter(
  trackedEntities: ReadonlyArray<TrackedEntity>,
): (name: string) => boolean {
  const lookup = buildEntityLookupByName(trackedEntities);
  return (name: string) => {
    const entity = lookup.get(normalizeName(name)) ?? null;
    return !shouldExcludeFromCompetitorRanking(name, entity);
  };
}
