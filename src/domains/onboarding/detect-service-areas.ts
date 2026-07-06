/**
 * detect-service-areas — generic place-name detection (2026-07-06).
 *
 * The service-area money-maker's INPUT: from a tenant's OWN signals (the
 * site's structured areaServed/address, plus the place names people actually
 * type into Google), derive the cities/markets a LOCAL business serves — so
 * the local-SEO engine finds the city x service pages the business is missing,
 * with ZERO manual config.
 *
 * There is NO generic city gazetteer in this codebase (geo/normalize.ts is a
 * Bay-Area founder-default alias map, deliberately NOT used here). Detection is
 * therefore HEURISTIC and language/geo-agnostic:
 *
 *   1. The site's own structured places (address locality/region + areaServed)
 *      are the ground truth — these came from the business's own JSON-LD.
 *   2. GSC queries add markets the site hasn't named yet: a query like
 *      "<something> in Austin" or "kitchen remodel Fredericksburg TX" exposes
 *      the place people attach to the business. We pull the trailing/tail
 *      capitalized token group after generic geo prepositions ("in", "near"),
 *      or a trailing US-state abbreviation, as a candidate place. This is a
 *      pattern, not a list — it works for Austin, Boerne, Fredericksburg, or
 *      any place name on Earth, and it recognizes NO specific city.
 *
 * A content/encyclopedia site (no address, no phone, no service-in-place
 * queries) yields an EMPTY service-area list, so the local engine no-ops —
 * byte-identical to a world without this module.
 *
 * PURE FUNCTION. Pinned by detect-service-areas.test.ts.
 */

export type ServiceAreaSignal = { query: string; impressions: number };

export type DetectServiceAreasInput = {
  /** Places the SITE itself declared (address locality/region + areaServed),
   *  already lowercased by the profile deriver. Ground truth. */
  configuredPlaces?: ReadonlyArray<string>;
  /** Top GSC queries by impressions (place names people attach to the biz). */
  queries?: ReadonlyArray<ServiceAreaSignal>;
  /** Cap the returned list. Default 20. */
  max?: number;
};

export type DetectedServiceArea = {
  /** Display-cased place name ("Fredericksburg", "TX"). */
  place: string;
  /** "site" when the business declared it; "search" when only queries show it. */
  source: "site" | "search";
  /** Total GSC impressions the place appeared in (0 for site-only places). */
  impressions: number;
};

// Generic geo prepositions that precede a place in natural-language queries.
// English page-role words, not a geography — "in Austin", "near Boerne".
const GEO_PREPOSITIONS = ["in", "near", "around", "serving"];

// US state postal abbreviations — a generic, finite, non-vertical set. A
// trailing 2-letter token matching one of these marks the token(s) before it
// as a place ("kitchen remodel fredericksburg tx"). This is US-launch scope
// (memory: USA-only at launch); it recognizes NO city, only the 50 state codes.
const US_STATE_ABBR = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
]);

// Generic English stopwords that are never a place name, so a preposition-tail
// like "in stock" or "near me" never becomes a city. Not a vertical vocabulary.
const NON_PLACE_WORDS = new Set([
  "me", "you", "my", "your", "the", "a", "an", "stock", "person", "general",
  "town", "city", "area", "home", "house", "store", "shop", "online", "us",
  "usa", "america", "google", "reviews", "hours", "open", "now", "today",
]);

/** Title-case a lowercase place, upper-casing 2-letter state codes. */
function displayCasePlace(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 2 && US_STATE_ABBR.has(trimmed.toLowerCase())) {
    return trimmed.toUpperCase();
  }
  return trimmed
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Clean a token to a comparable lowercase word (strip punctuation). */
function cleanToken(tok: string): string {
  return tok.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Pull candidate place phrases from ONE query. Generic pattern only:
 *   • a group of 1-3 capitalizable words following "in/near/around/serving",
 *   • or the 1-2 words immediately before a trailing US-state abbreviation.
 * Returns lowercased place phrases (may be empty). Recognizes no specific place.
 */
export function extractPlacesFromQuery(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lower = words.map(cleanToken);
  const out: string[] = [];

  // Pattern A: <preposition> <place words...>
  for (let i = 0; i < lower.length - 1; i += 1) {
    if (!GEO_PREPOSITIONS.includes(lower[i]!)) continue;
    const parts: string[] = [];
    for (let j = i + 1; j < lower.length && parts.length < 3; j += 1) {
      const w = lower[j]!;
      if (!w || NON_PLACE_WORDS.has(w)) break;
      parts.push(w);
    }
    if (parts.length > 0) out.push(parts.join(" "));
  }

  // Pattern B: <place words> <state-abbr> at the tail. Skip a trailing token
  // that is ALSO a generic English preposition/stopword ("in" = Indiana, "me"
  // = Maine): in a real query those are far more often the English word, so
  // "plumber near me" / "best in class" must NOT read the tail as a state and
  // capture the words before it as a bogus place. Every non-word state code
  // (tx, ca, ny, or, oh, ...) still fires.
  const last = lower[lower.length - 1]!;
  if (
    US_STATE_ABBR.has(last) &&
    !NON_PLACE_WORDS.has(last) &&
    !GEO_PREPOSITIONS.includes(last)
  ) {
    // the state code itself is a market signal
    out.push(last);
    const before: string[] = [];
    for (let j = lower.length - 2; j >= 0 && before.length < 2; j -= 1) {
      const w = lower[j]!;
      if (!w || NON_PLACE_WORDS.has(w)) break;
      before.unshift(w);
    }
    if (before.length > 0) out.push(before.join(" "));
  }

  return out.filter((p) => p.length >= 2 && !NON_PLACE_WORDS.has(p));
}

/**
 * Detect a local business's service areas. PURE.
 *
 * Empty-safe: no configured places AND no place-carrying queries → [] (a
 * content site is a byte-identical no-op here). Site-declared places rank
 * first (ground truth), then query-detected markets by impressions.
 */
export function detectServiceAreas(
  input: DetectServiceAreasInput,
): DetectedServiceArea[] {
  const max = input.max ?? 20;
  const byPlace = new Map<string, DetectedServiceArea>();

  // 1. Site-declared places are ground truth (source: "site").
  for (const raw of input.configuredPlaces ?? []) {
    const key = raw.trim().toLowerCase();
    if (key.length < 2 || NON_PLACE_WORDS.has(key)) continue;
    if (!byPlace.has(key)) {
      byPlace.set(key, { place: displayCasePlace(key), source: "site", impressions: 0 });
    }
  }

  // 2. Query-detected markets add + reinforce (source stays "site" if already
  //    declared; otherwise "search"). Impressions accumulate for ranking.
  for (const q of input.queries ?? []) {
    const impr = Number.isFinite(q.impressions) ? Math.max(0, q.impressions) : 0;
    for (const place of extractPlacesFromQuery(q.query)) {
      const key = place.trim().toLowerCase();
      if (key.length < 2 || NON_PLACE_WORDS.has(key)) continue;
      const existing = byPlace.get(key);
      if (existing) {
        existing.impressions += impr;
      } else {
        byPlace.set(key, { place: displayCasePlace(key), source: "search", impressions: impr });
      }
    }
  }

  const all = [...byPlace.values()];
  // Site-declared first (ground truth), then by impressions, then stable alpha.
  all.sort(
    (a, b) =>
      (a.source === "site" ? 0 : 1) - (b.source === "site" ? 0 : 1) ||
      b.impressions - a.impressions ||
      a.place.localeCompare(b.place),
  );
  return all.slice(0, max);
}
