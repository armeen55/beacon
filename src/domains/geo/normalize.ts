/**
 * Geographic Normalization — canonical city mapping for Beacon.
 *
 * Deterministic normalization of city names and location terms into
 * canonical forms. No external APIs. No over-engineered taxonomy.
 *
 * Designed for the Bay Area / California context of the current dataset,
 * but the pattern is extensible to any metro.
 */

import type { NormalizedCity, GeoConfidence } from "./types";

const CITY_ALIASES: Record<string, string> = {
  "palo alto": "palo alto",
  "east palo alto": "east palo alto",
  "menlo park": "menlo park",
  "atherton": "atherton",
  "woodside": "woodside",
  "portola valley": "portola valley",
  "los altos": "los altos",
  "los altos hills": "los altos hills",
  "mountain view": "mountain view",
  "sunnyvale": "sunnyvale",
  "cupertino": "cupertino",
  "saratoga": "saratoga",
  "san jose": "san jose",
  "san francisco": "san francisco",
  "sf": "san francisco",
  "san mateo": "san mateo",
  "burlingame": "burlingame",
  "hillsborough": "hillsborough",
  "redwood city": "redwood city",
  "san carlos": "san carlos",
  "belmont": "belmont",
  "foster city": "foster city",
  "half moon bay": "half moon bay",
  "daly city": "daly city",
  "pacifica": "pacifica",
  "santa clara": "santa clara",
  "milpitas": "milpitas",
  "campbell": "campbell",
  "los gatos": "los gatos",
  "fremont": "fremont",
  "newark": "newark",
  "union city": "union city",
  "hayward": "hayward",
  "oakland": "oakland",
  "berkeley": "berkeley",
  "walnut creek": "walnut creek",
  "pleasanton": "pleasanton",
  "livermore": "livermore",
  "dublin": "dublin",
  "danville": "danville",
  "san ramon": "san ramon",
  "concord": "concord",
  "emerald hills": "emerald hills",
  "silicon valley": "silicon valley",
  "bay area": "bay area",
  "south bay": "south bay",
  "peninsula": "peninsula",
  "east bay": "east bay",
  "north bay": "north bay",
};

const METRO_MAP: Record<string, string> = {
  "palo alto": "peninsula",
  "east palo alto": "peninsula",
  "menlo park": "peninsula",
  "atherton": "peninsula",
  "woodside": "peninsula",
  "portola valley": "peninsula",
  "redwood city": "peninsula",
  "san carlos": "peninsula",
  "belmont": "peninsula",
  "emerald hills": "peninsula",
  "los altos": "south bay",
  "los altos hills": "south bay",
  "mountain view": "south bay",
  "sunnyvale": "south bay",
  "cupertino": "south bay",
  "saratoga": "south bay",
  "san jose": "south bay",
  "santa clara": "south bay",
  "milpitas": "south bay",
  "campbell": "south bay",
  "los gatos": "south bay",
  "san mateo": "mid-peninsula",
  "burlingame": "mid-peninsula",
  "hillsborough": "mid-peninsula",
  "foster city": "mid-peninsula",
  "san francisco": "san francisco",
  "daly city": "san francisco",
  "pacifica": "san francisco",
  "half moon bay": "coastside",
  "fremont": "east bay",
  "newark": "east bay",
  "union city": "east bay",
  "hayward": "east bay",
  "oakland": "east bay",
  "berkeley": "east bay",
  "walnut creek": "east bay",
  "pleasanton": "east bay",
  "livermore": "east bay",
  "dublin": "east bay",
  "danville": "east bay",
  "san ramon": "east bay",
  "concord": "east bay",
};

// Bay-Area DEFAULT region taxonomy (founder tenant). De-verticalized
// (2026-06-15): this is the legacy default — a non-Bay-Area tenant's own
// region terms are not recognized here, so coverage.ts's region-drop filter
// is a no-op for them (their region-wide labels are treated as cities). The
// proper fix is to thread per-tenant region terms (BusinessConfig) into
// isRegionTerm + computeGeoCoverage — tracked in
// docs/DEVERTICALIZE_FINDINGS_2026-06-15.md (geo/normalize.ts, M-effort).
const REGION_TERMS = new Set([
  "bay area", "silicon valley", "south bay", "peninsula",
  "east bay", "north bay", "mid-peninsula", "coastside",
]);

/**
 * Normalize a raw city/location string to canonical form.
 */
export function normalizeCity(raw: string): NormalizedCity {
  const cleaned = raw.trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,\s*(ca|california)$/i, "")
    .trim();

  if (!cleaned) {
    return { canonical: raw, variants: [], metro: null, state: null, confidence: "low" };
  }

  const canonical = CITY_ALIASES[cleaned] ?? cleaned;
  const metro = METRO_MAP[canonical] ?? (REGION_TERMS.has(canonical) ? canonical : null);
  const confidence: GeoConfidence = CITY_ALIASES[cleaned] ? "high" : "medium";

  return {
    canonical,
    variants: cleaned !== canonical ? [cleaned] : [],
    metro,
    // De-verticalized (2026-06-15): do NOT hardcode "CA" — state is unknown
    // without per-tenant geo config (this field is currently unread; null is
    // honest and prevents future mis-use for non-California tenants).
    state: null,
    confidence,
  };
}

/**
 * Check if a location term is a region rather than a specific city.
 */
export function isRegionTerm(term: string): boolean {
  return REGION_TERMS.has(term.trim().toLowerCase());
}

/**
 * Get the metro/sub-region for a normalized city.
 */
export function getMetro(city: string): string | null {
  return METRO_MAP[city.toLowerCase()] ?? null;
}

/**
 * Normalize a batch of city strings, deduplicating by canonical form.
 */
export function normalizeCities(rawCities: string[]): NormalizedCity[] {
  const seen = new Map<string, NormalizedCity>();
  for (const raw of rawCities) {
    const norm = normalizeCity(raw);
    const existing = seen.get(norm.canonical);
    if (existing) {
      if (norm.variants.length > 0) {
        for (const v of norm.variants) {
          if (!existing.variants.includes(v)) existing.variants.push(v);
        }
      }
    } else {
      seen.set(norm.canonical, norm);
    }
  }
  return [...seen.values()];
}
