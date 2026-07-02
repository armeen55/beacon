/**
 * Biography page-class detector (2026-07-02, item 73, Wikidata grounding).
 *
 * AI answer engines resolve people to knowledge-graph entities before
 * citing sources. An encyclopedia-style content page about a named person
 * should carry Person JSON-LD, not just Article, but ONLY when the page's
 * OWN signals genuinely describe a person's life, never guessed from a
 * tenant-specific word list (Iranopedia, Ritz, or any future tenant).
 *
 * Detection is 100% derived from the page's own extracted snapshot fields:
 *   - title/H1 shape: looks like a proper-noun person name (not a generic
 *     topic phrase, "Best Persian Restaurants", "How Rugs Are Made", or a
 *     product name, "Iran Map Hoodie", "Faravahar Shirt").
 *   - body signals: birth/death dates, "born"/"died" phrasing, or
 *     occupation phrasing whose SUBJECT is the extracted name itself
 *     ("<Name> is/was a/an <occupation>") in the lead paragraphs.
 *   - existing schema: a page that ALREADY carries Person schema is a
 *     no-op for the detector's purpose (nothing to add); a page carrying
 *     Product schema is a store item and is NEVER classified as biography
 *     regardless of title shape.
 *
 * Name-shape alone is NOT sufficient. Ground-truth against a real content
 * tenant's snapshots showed plenty of 2-4 word Title-Case product names
 * ("Iran Map Hoodie", "Doodool Tala Persian T-Shirt") that pass a naive
 * proper-noun shape test. `isBiography` therefore REQUIRES at least one
 * corroborating body signal (a life date or a name-anchored occupation
 * sentence); title shape alone yields `isBiography: false` (this is a
 * confidence floor, not a "medium" tier, since a name-shaped title with
 * zero corroboration is exactly as common for places, brands, and
 * products as for people, so guessing would produce false positives at
 * any tenant).
 *
 * Pure. No I/O, no LLM, no tenant hardcoding. Every pattern here is
 * English-language grammar/punctuation shape, not a name/topic list.
 */

import type { PageSnapshot } from "./types";

export type BiographyConfidence = "high" | "medium" | "none";

export type BiographyExtractedFields = {
  /** The person's name as it appears in the page's own title/H1. */
  name: string;
  /** ISO-ish date string (whatever precision was found: year, or full date)
   *  extracted from "born ..." phrasing. Null when not confidently found. */
  birthDate: string | null;
  /** Same shape as birthDate, from "died ... / "d. ..." phrasing. */
  deathDate: string | null;
  /** Occupation noun phrase extracted from "<Name> is/was a/an <occupation>"
   *  lead-sentence phrasing. Null when not confidently found. */
  occupation: string | null;
};

export type BiographyDetection = {
  isBiography: boolean;
  confidence: BiographyConfidence;
  /** Human-readable reasons the page matched (or didn't), for operator
   *  surfaces / debugging, never shown as a customer-facing claim. */
  signals: string[];
  extracted: BiographyExtractedFields | null;
};

const NEGATIVE_RESULT: BiographyDetection = {
  isBiography: false,
  confidence: "none",
  signals: [],
  extracted: null,
};

/**
 * A title/H1 "looks like a person name" when it is a short (2-4 word),
 * Title-Case sequence of alphabetic tokens (allowing hyphens/apostrophes
 * inside a token, e.g. "Jean-Paul", "O'Brien"), with NO leading
 * article/number, no punctuation that marks a topic phrase (colon,
 * question mark, comma-separated list, digits), and no trailing common
 * noun that marks a product/place/topic name (Hoodie, Shirt, Rug, Necklace,
 * Guide, Map, Recipe, etc). This is a grammar-shape test, not a name
 * dictionary. The noun-suffix exclusion is a closed, universal set of
 * English common nouns for merchandise/media/topic pages, not a per-tenant
 * word list.
 */
const GENERIC_LEADING_WORDS = new Set([
  "the", "a", "an", "how", "why", "what", "when", "where", "who",
  "top", "best", "guide", "list", "history", "everything", "shop",
]);

/**
 * Common-noun title TAILS that mark a product/place/media page rather than
 * a person's name, even when every token is individually Title-Case
 * (e.g. "Iran Map Hoodie", "Faravahar Shirt", "Gabba Rug"). Closed,
 * vertical-neutral set of English merchandise/reference nouns, not a
 * brand/topic list.
 */
const NON_PERSON_TAIL_NOUNS = new Set([
  "hoodie", "shirt", "t-shirt", "tshirt", "sweatshirt", "necklace",
  "pendant", "rug", "carpet", "poster", "mug", "hat", "bag", "jewelry",
  "bracelet", "ring", "map", "flag", "recipe", "guide", "review",
  "restaurant", "restaurants", "hotel", "hotels", "airport", "museum",
  "market", "bazaar", "festival", "holiday", "cuisine", "dish", "food",
]);

const TITLE_CASE_TOKEN = /^[A-Z][a-zA-Z'.-]*$/;

export function looksLikePersonName(rawTitle: string): boolean {
  const title = (rawTitle ?? "").trim();
  if (!title) return false;
  // Strip a trailing " - Site Name" / " | Site Name" suffix before shape-testing.
  const bare = title.split(/\s[|–—-]\s/)[0]?.trim() ?? title;
  if (!bare || /[:?,;]/.test(bare) || /\d/.test(bare)) return false;

  const tokens = bare.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;

  const firstWord = tokens[0]!.toLowerCase();
  if (GENERIC_LEADING_WORDS.has(firstWord)) return false;

  const lastWord = tokens[tokens.length - 1]!.toLowerCase();
  if (NON_PERSON_TAIL_NOUNS.has(lastWord)) return false;

  // Every token must be Title-Case shaped, OR a short connector particle
  // ("de", "van", "bin", "al") that legitimately appears lowercase inside
  // real names, but never as the first token.
  const CONNECTOR = new Set(["de", "van", "der", "bin", "al", "ibn", "la", "el"]);
  return tokens.every((tok, i) => {
    if (TITLE_CASE_TOKEN.test(tok)) return true;
    return i > 0 && CONNECTOR.has(tok.toLowerCase());
  });
}

/** Matches a 4-digit year, optionally with a full "Month D, YYYY" prefix. */
const DATE_FRAGMENT =
  "(?:[A-Z][a-z]+\\s+\\d{1,2},?\\s+)?(\\d{3,4})(?:\\s*(?:BC|BCE|AD|CE))?";

const BORN_PATTERN = new RegExp(
  `\\bborn\\b[^.]{0,40}?${DATE_FRAGMENT}`,
  "i",
);
const DIED_PATTERN = new RegExp(
  `\\b(?:died|d\\.)\\b[^.]{0,40}?${DATE_FRAGMENT}`,
  "i",
);
/** "(1930-2020)" or "(1930-2020)" (en dash) lifespan-parenthetical shorthand. */
const LIFESPAN_PAREN = /\((\d{3,4})\s*(?:BC|BCE|AD|CE)?\s*[–—-]\s*(\d{3,4})\s*(?:BC|BCE|AD|CE)?\)/;

const OCCUPATION_STOPWORDS = new Set([
  "important", "well", "well-known", "famous", "popular", "type", "kind",
  "part", "member", "result", "way", "means", "form", "must-have",
  "must", "great", "perfect", "good", "fun", "nice", "beautiful",
]);

/**
 * Human-occupation morphology check (2026-07-02, ground-truth fix). A
 * ground-truth run against a real content tenant showed "<Name> is a
 * powerful bird" / "is a striking species" / "is a venomous snake"
 * matching the bare "is/was a/an <noun>" pattern on WILDLIFE reference
 * pages whose title happens to be Title-Case 2-word-shaped ("Booted
 * Eagle", "Caspian Horse"). An occupation phrase must look like a HUMAN
 * role: either it ends in a standard English agent-noun suffix
 * (-er/-or/-ist/-ian/-ess, e.g. "writer", "actor", "novelist",
 * "historian", "actress") or it is one of a small closed set of common
 * irregular human-role nouns that don't fit those suffixes (poet, chef,
 * monk, judge, ...). This is derived from English word-formation
 * morphology, not a topic/brand vocabulary list.
 */
const AGENT_NOUN_SUFFIXES = [
  "er", "or", "ist", "ian", "ess", "eur", "ier",
];
const IRREGULAR_HUMAN_ROLES = new Set([
  "poet", "chef", "monk", "judge", "king", "queen", "shah", "emperor",
  "empress", "priest", "rabbi", "imam", "scholar", "sage", "prophet",
  "diplomat", "president", "minister", "senator", "athlete", "artist",
  "novelist", "playwright", "physician", "surgeon", "philosopher",
]);

function isHumanOccupationNoun(wordLower: string): boolean {
  if (!wordLower) return false;
  if (IRREGULAR_HUMAN_ROLES.has(wordLower)) return true;
  return AGENT_NOUN_SUFFIXES.some(
    (suf) => wordLower.endsWith(suf) && wordLower.length > suf.length + 2,
  );
}

function firstMatchYear(text: string, pattern: RegExp): string | null {
  const m = pattern.exec(text);
  if (!m) return null;
  const year = m[1];
  if (!year) return null;
  return year;
}

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a name-anchored occupation pattern: "<Name> [(dates)] is/was/became
 * a/an <occupation>". REQUIRES the extracted name (or its first token,
 * e.g. "Jonas" alone later in the same paragraph) to be the grammatical
 * subject. This is what rules out unrelated "is a" sentences elsewhere in
 * marketing/product copy ("This is a must-have shirt") or reference-page
 * copy about a non-human subject. An optional parenthetical lifespan
 * between the name and the verb is tolerated: "Jonas Kettering
 * (1904-1978) was a poet" is extremely common real biography phrasing.
 *
 * Captures exactly ONE word (never a multi-word phrase): an earlier
 * version tried to also capture a leading adjective ("celebrated
 * ceramicist") or a second occupation word, and needed a growing list of
 * exclusions to avoid swallowing trailing prose ("sculptor based [in
 * Shiraz]" instead of "sculptor", or "poet who" instead of "poet"). A
 * single-word capture directly after the verb is simpler and strictly
 * safer: it costs a little richness (an adjective before the occupation
 * noun is not captured) but never over-matches into the next clause.
 */
function buildOccupationPattern(name: string): RegExp {
  const firstToken = name.split(/\s+/)[0] ?? name;
  const namePart = escapeRegExp(name);
  const firstTokenPart = escapeRegExp(firstToken);
  // `(?:\s*\([^)]{0,30}\))?` tolerates one optional short parenthetical
  // (typically a lifespan) right after the name before the verb.
  return new RegExp(
    `\\b(?:${namePart}|${firstTokenPart})(?:\\s*\\([^)]{0,30}\\))?\\s+(?:is|was|became|is\\s+known\\s+as|was\\s+known\\s+as)\\s+an?\\s+([a-z]+)\\b`,
    "i",
  );
}

/**
 * Extract birth/death/occupation from the page's lead text (title, H1,
 * meta description, and sampled body paragraphs concatenated, in that
 * priority order so a title-carried lifespan wins over a stray body date).
 * Every field is independently optional; nothing is invented when a
 * pattern doesn't confidently match.
 */
function extractFields(
  snap: PageSnapshot,
  name: string,
): BiographyExtractedFields {
  const leadParagraphs = (snap.body_paragraph_sample ?? []).slice(0, 3).join(" ");
  const title = snap.title ?? "";
  const h1 = snap.h1 ?? "";
  const meta = snap.meta_description ?? "";
  const haystack = [title, h1, meta, leadParagraphs].join(" ");

  let birthDate: string | null = null;
  let deathDate: string | null = null;

  // Roundup guard: a page listing MULTIPLE people ("Top 15 Famous Iranian
  // Scientists") repeats "Born ..." once per list entry. A single
  // biography subject has at most one "born" mention in its lead text;
  // two or more is the signature of a multi-person list page, and any
  // date extracted there would be mixing different people's life events.
  // Ground-truthed against a real content tenant's roundup pages.
  const bornMatches = haystack.match(new RegExp(BORN_PATTERN.source, "gi")) ?? [];
  const isRoundupPage = bornMatches.length > 1;

  if (!isRoundupPage) {
    const lifespan = LIFESPAN_PAREN.exec(haystack);
    if (lifespan) {
      birthDate = lifespan[1] ?? null;
      deathDate = lifespan[2] ?? null;
    }
    if (!birthDate) birthDate = firstMatchYear(haystack, BORN_PATTERN);
    if (!deathDate) deathDate = firstMatchYear(haystack, DIED_PATTERN);
  }

  let occupation: string | null = null;
  const occPattern = buildOccupationPattern(name);
  const occMatch = occPattern.exec(leadParagraphs || haystack);
  if (occMatch) {
    const word = occMatch[1]?.trim().toLowerCase() ?? "";
    if (
      word &&
      word.length <= 30 &&
      !OCCUPATION_STOPWORDS.has(word) &&
      isHumanOccupationNoun(word)
    ) {
      occupation = word;
    }
  }

  return { name, birthDate, deathDate, occupation };
}

/**
 * Detect whether a page is biography-shaped and, when it is, extract the
 * confidently-derivable Person fields.
 *
 * `isBiography` requires a name-shaped title/H1 AND at least one
 * corroborating body signal (a birth/death date or a name-anchored
 * occupation sentence). Title shape alone is NOT enough (ground-truthed
 * against a real content tenant: plenty of Title-Case 2-4 word product/
 * place names pass a naive name-shape test with no way to rule them out
 * from the title alone).
 *
 *   - "high": at least one corroborating signal found (life date and/or
 *     occupation).
 *   - "medium": reserved for a future stronger-title-only heuristic;
 *     never returned today (isBiography is false without corroboration).
 *   - "none": doesn't look like a person page, or no corroboration.
 *
 * Pages that already carry Person schema still classify (callers use this
 * for coverage diffing, not just gap-finding), but `signals` notes it.
 * Pages carrying Product schema are NEVER classified as biography: a
 * store item's title can coincidentally look name-shaped.
 */
export function detectBiographyPage(snap: PageSnapshot): BiographyDetection {
  const rawName = (snap.h1?.trim() || snap.title?.trim() || "");
  if (!rawName) return NEGATIVE_RESULT;

  const isProductPage = (snap.schema_types ?? []).some(
    (t) => t.trim().toLowerCase() === "product",
  );
  if (isProductPage) return NEGATIVE_RESULT;

  const nameShaped = looksLikePersonName(rawName);
  if (!nameShaped) return NEGATIVE_RESULT;

  const name = (snap.h1?.trim() || snap.title?.trim() || "")
    .split(/\s[|–—-]\s/)[0]!
    .trim();

  const extracted = extractFields(snap, name);

  const hasLifeDate = Boolean(extracted.birthDate || extracted.deathDate);
  const hasOccupation = Boolean(extracted.occupation);

  // Corroboration required, see module and function docstring.
  if (!hasLifeDate && !hasOccupation) return NEGATIVE_RESULT;

  const signals: string[] = ["title_shape=person_name"];
  if (hasLifeDate) signals.push("body_signal=birth_or_death_date");
  if (hasOccupation) signals.push("body_signal=occupation_phrasing");

  const alreadyHasPersonSchema = (snap.schema_types ?? []).some(
    (t) => t.trim().toLowerCase() === "person",
  );
  if (alreadyHasPersonSchema) signals.push("existing_schema=Person");

  return {
    isBiography: true,
    confidence: "high",
    signals,
    extracted,
  };
}
