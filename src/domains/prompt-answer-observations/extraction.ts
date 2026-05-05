/**
 * Pure extractors for observation schema v2 + v2.1
 * (Commits 4 + 6, 2026-04-24).
 *
 * Deterministic functions compute structured fields from an answer text
 * + entity list + citation domains. Called from both adapters (Perplexity;
 * OpenAI wraps Perplexity) and from the backfill script over existing
 * Apr-22+ rows where answer_texts is available.
 *
 * Design constraints:
 *   - Deterministic (same inputs → same outputs). No LLM, no randomness.
 *   - Pure. No I/O. No side effects. All inputs passed in.
 *   - Null-safe. Empty text → null / empty; brand absent → null / false.
 *   - Case-insensitive matching. All matching lower-cases both sides.
 *   - Idempotent. Backfill can re-run over the same row without churn.
 *
 * See docs/OBSERVATION_SCHEMA_V2.md for field semantics.
 */

import type {
  AnswerStructure,
  CitationDomainClass,
} from "./types";

export type EntityForOrdering = {
  name: string;
  aliases?: string[];
};

/**
 * Character offset of the first case-insensitive match of any brand variant
 * (name or alias) in answer_text. Returns null when the brand isn't
 * mentioned or when the text is empty.
 *
 * Takes the earliest match across all variants so `["Ritz Builders", "Ritz"]`
 * resolves to the position of whichever appeared first — the "Ritz" in
 * "Ritz was founded" is caught even if "Ritz Builders" appears later.
 */
export function extractMentionPosition(
  answerText: string,
  brandVariants: string[],
): number | null {
  if (!answerText) return null;
  const lower = answerText.toLowerCase();
  let earliest: number | null = null;
  for (const variant of brandVariants) {
    if (!variant) continue;
    const v = variant.toLowerCase();
    const idx = lower.indexOf(v);
    if (idx < 0) continue;
    if (earliest === null || idx < earliest) earliest = idx;
  }
  return earliest;
}

/**
 * 1-indexed position of the first owned domain in the citations list.
 * Returns null when the brand isn't cited.
 *
 * `citationDomains` is expected lowercased (the adapter stores them that
 * way). `ownedDomains` should also be lowercased.
 */
export function extractCitationRank(
  citationDomains: string[],
  ownedDomains: Set<string>,
): number | null {
  if (citationDomains.length === 0 || ownedDomains.size === 0) return null;
  for (let i = 0; i < citationDomains.length; i++) {
    const d = citationDomains[i];
    if (!d) continue;
    if (ownedDomains.has(d.toLowerCase())) return i + 1;
  }
  return null;
}

/**
 * Returns entity canonical names in order of first appearance in answer_text
 * (earliest first). Entities with no match are omitted. Entity ordering is
 * by its earliest variant-match position (name or alias, whichever appears
 * first).
 *
 * Used to check "is brand in top-2 entities by order of appearance" for
 * `extractPrimaryRecommendation`.
 */
export function rankEntitiesByFirstAppearance(
  answerText: string,
  entities: EntityForOrdering[],
  maxN: number = 10,
): string[] {
  if (!answerText || entities.length === 0) return [];
  const lower = answerText.toLowerCase();
  const firstPos = new Map<string, number>();
  for (const entity of entities) {
    if (!entity.name) continue;
    const variants: string[] = [entity.name];
    if (entity.aliases) {
      for (const a of entity.aliases) {
        if (a) variants.push(a);
      }
    }
    let earliest: number | null = null;
    for (const variant of variants) {
      const idx = lower.indexOf(variant.toLowerCase());
      if (idx < 0) continue;
      if (earliest === null || idx < earliest) earliest = idx;
    }
    if (earliest !== null) firstPos.set(entity.name, earliest);
  }
  return [...firstPos.entries()]
    .sort(([, a], [, b]) => a - b)
    .slice(0, maxN)
    .map(([name]) => name);
}

/**
 * Heuristic: is the brand the "primary recommendation" in the answer?
 *
 * Conditions (all must hold):
 *  1. Brand is mentioned at all (`brandPosition` non-null).
 *  2. First brand mention is in the first 20% of the answer text
 *     (early enough to be a lead recommendation vs buried in a list).
 *  3. Brand is one of the first 2 distinct entities by order of appearance
 *     (i.e. the answer leads with the brand or mentions one other entity
 *     before the brand, not three or more).
 *
 * Returns false when any condition fails. False when answer is empty.
 */
export function extractPrimaryRecommendation(
  answerText: string,
  brandPosition: number | null,
  entitiesInOrder: string[],
  brandName: string,
  thresholdRatio: number = 0.2,
): boolean {
  if (brandPosition === null) return false;
  if (!answerText) return false;
  if (!brandName) return false;

  // Condition 2: early in text.
  const earlyCutoff = Math.max(1, answerText.length * thresholdRatio);
  const isEarly = brandPosition < earlyCutoff;
  if (!isEarly) return false;

  // Condition 3: brand in top-2 entities by order of appearance.
  const topTwo = entitiesInOrder.slice(0, 2);
  const inTopTwo = topTwo.includes(brandName);
  return inTopTwo;
}

// ---------------------------------------------------------------------------
// Schema v2.1 Commit 6 (2026-04-24) — high-value-soon extractors
// ---------------------------------------------------------------------------

/** Words to skip when building the descriptor window. Kept intentionally
 *  small — if a word is functional plumbing ("the", "and"), it's in here.
 *  URL-ish tokens were added after live-data spot-check (2026-04-24): raw
 *  URL fragments near brand citations pollute the window with tokens like
 *  "https", "com", "utm_source". These carry no positioning signal.
 *
 *  Exported as DESCRIPTOR_QUALITY_STOPWORDS so the rollup layer can apply
 *  the SAME filter at render time (T1, 2026-05-05). Pre-W4 observations
 *  carry descriptor_window tokens that were extracted before recent
 *  stopword additions; the rollup must filter them OUT at read time so
 *  /today never shows "custom · home · builder · closed · area" again. */
export const DESCRIPTOR_QUALITY_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "from", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "as", "than", "that", "which", "who", "when", "where", "why", "how",
  "what", "not", "no", "if", "else", "then", "into", "onto", "about",
  "over", "under", "this", "these", "those", "their", "theirs", "its",
  "it", "they", "them", "there", "here", "also", "more", "most", "some",
  "any", "all", "each", "every", "one", "two", "three", "four", "five",
  "many", "much", "very", "will", "can", "could", "should", "would",
  "may", "might", "must", "has", "have", "had", "do", "does", "did",
  "between", "among", "such", "like", "other", "another", "you", "your",
  "yours", "we", "our", "ours", "us",
  // URL-ish noise (tokenizer splits URLs into component words; these are
  // always-noise in a descriptor window).
  "http", "https", "www", "com", "org", "net", "io", "co",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "url", "href", "link", "ref",
  // ── Domain stopwords (Task 2, 2026-05-04, post May 2-4 ─────────────
  //
  // Operator-reported (post-W4 browser verification): "How AI thinks
  // you are" was returning generic single-word descriptors that don't
  // tell the operator anything Ritz-specific:
  //
  //   custom · home · builder · closed
  //
  // The first three are unavoidable nouns in the AI's description of
  // a custom-home builder; "closed" is likely from "closed today" or
  // "closed-form" hits — temporal/state noise.
  //
  // These tokens are SUPPRESSED when they appear ALONE in a descriptor
  // window. Multi-word forms ("custom homes", "high-end residential")
  // come through the bigram path (when that ships) untouched — this
  // single-word filter only kills the generic-noun pollution.
  //
  // Industry-noun stopwords (kept domain-specific to home-building so
  // we don't over-block adjectives like "luxury" or "award-winning"):
  "custom", "home", "homes", "builder", "builders", "building",
  "buildings", "house", "houses", "residence", "residences",
  "company", "companies", "firm", "firms",
  "contractor", "contractors", "contracting",
  "general", "professional", "professionals", "services", "service",
  "work", "works", "project", "projects",
  "team", "teams", "staff",
  // Temporal / state noise (sources of "closed", "open", "now"):
  "closed", "open", "opened", "now", "today", "yesterday", "tomorrow",
  "current", "currently", "recent", "recently", "available",
  // ── T1 additions (operator audit, 2026-05-05) ─────────────────────
  //
  // Operator's explicit list — keep this set in step with the brief.
  // Hosted /today still showed "area · bay · inc · include · local
  // · best · top" pollution because pre-W4 observations carried these
  // tokens from a time when the stopword list was smaller. The rollup
  // layer also applies this filter, but we keep them here too for any
  // new extraction that runs.
  //
  // NOTE: do NOT add adjacent words speculatively (e.g. "premier",
  // "leading", "first") — those CAN be operator-positive descriptors
  // ("premier custom builder") and should not be silently filtered.
  // Only the operator-listed set is hard-blocked here.
  "area", "bay",
  "inc", "incorporated", "llc", "ltd", "corp", "corporation",
  "include", "includes", "including", "etc",
  "best", "top",
  "local",
]);

/**
 * Backwards-compat alias — older code paths in this file refer to the
 * `DESCRIPTOR_STOPWORDS` name. Keep the alias so the extraction-time
 * filter still works after the rename.
 */
const DESCRIPTOR_STOPWORDS = DESCRIPTOR_QUALITY_STOPWORDS;

/**
 * Up to `max` adjective/noun-like tokens in a ±`windowWords`-word window
 * around `brandPosition` in `answerText`. Returns [] when brand not
 * mentioned, text empty, or window finds no non-stopword tokens.
 *
 * Words are lowercased; deduped while preserving first-appearance order;
 * short tokens (< 3 chars) and stopwords dropped. Brand variants are also
 * dropped so the window is "words near brand, not brand itself".
 */
export function extractDescriptorWindow(
  answerText: string,
  brandPosition: number | null,
  brandVariants: string[],
  options?: { windowWords?: number; max?: number },
): string[] {
  if (!answerText || brandPosition === null) return [];
  const windowWords = options?.windowWords ?? 5;
  const max = options?.max ?? 10;

  // Strip inline URLs before tokenizing. Raw URLs ("https://.../?utm=…")
  // would otherwise break into a dozen junk tokens and consume window
  // slots, pushing real descriptors outside the ±N-word window. Spaces
  // preserve length so the brand's char-offset still lines up with the
  // resulting token stream.
  const cleaned = answerText.replace(/https?:\/\/\S+/g, (m) =>
    " ".repeat(m.length),
  );

  // Tokenize the full answer into word positions (start offset → token).
  // A simple `\w+` walk is sufficient for English-Western text; CJK /
  // zero-width cases get short windows which is acceptable for v1.
  const tokens: Array<{ start: number; word: string }> = [];
  const re = /\w+(?:['-]\w+)*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    tokens.push({ start: match.index, word: match[0] });
  }
  if (tokens.length === 0) return [];

  // Find the token index whose start is at or immediately after brandPosition.
  let brandTokenIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start >= brandPosition) {
      brandTokenIdx = i;
      break;
    }
  }
  if (brandTokenIdx < 0) brandTokenIdx = tokens.length - 1;

  const firstIdx = Math.max(0, brandTokenIdx - windowWords);
  const lastIdx = Math.min(tokens.length - 1, brandTokenIdx + windowWords);

  // Drop brand variants from consideration.
  const brandVariantWords = new Set<string>();
  for (const variant of brandVariants) {
    if (!variant) continue;
    const vm = variant.toLowerCase().match(/\w+(?:['-]\w+)*/g);
    if (vm) for (const w of vm) brandVariantWords.add(w);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = firstIdx; i <= lastIdx; i++) {
    const raw = tokens[i].word.toLowerCase();
    if (raw.length < 3) continue;
    if (DESCRIPTOR_STOPWORDS.has(raw)) continue;
    if (brandVariantWords.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue; // pure numeric
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Canonical names of tracked non-owned entities that appear in the answer,
 * in order of first appearance. Returns [] when no competitor is mentioned.
 */
export function extractCompetitorCoMentions(
  entitiesInOrder: string[],
  ownedEntityNames: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const name of entitiesInOrder) {
    if (ownedEntityNames.has(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * W2 Step 2.1 (master plan, 2026-05-01) — descriptor windows around each
 * competitor mention.
 *
 * Powers the right column of "How AI described you" v2 ("Who AI thinks
 * THEY are") so the comparison view can render real competitor descriptors
 * — not just descriptors that happen to fall near the operator's brand.
 *
 * Returns a `Record<competitorName, string[]>` keyed by canonical
 * competitor name (entity name, not alias). Each value is up to `max`
 * adjective/noun-like tokens drawn from a ±`windowWords`-word window
 * around the competitor's first-appearance position in `answerText`.
 *
 * Pure / deterministic / no LLM. Reuses `extractDescriptorWindow` per
 * competitor so descriptor semantics stay consistent with the brand
 * column — same stopwords, same window size, same dedupe rules.
 *
 * Design choices:
 *   - Skips owned brand variants automatically (caller should pass
 *     `ownedNameVariants` so any owned-brand tokens get dropped from
 *     each competitor's window).
 *   - Skips a competitor's OWN name tokens from its own descriptor
 *     window — competitor descriptors should describe the competitor,
 *     not echo their name back at the operator.
 *   - Empty answer text → `{}`.
 *   - Competitors not in `entities` registry → silently skipped (caller
 *     decides which competitors are tracked).
 */
export function extractCompetitorDescriptorWindows(
  answerText: string,
  entities: EntityForOrdering[],
  ownedNameVariants: string[],
  options?: { windowWords?: number; max?: number },
): Record<string, string[]> {
  if (!answerText || entities.length === 0) return {};
  const lower = answerText.toLowerCase();
  const ownedSet = new Set(
    ownedNameVariants
      .filter((v) => v && v.length > 0)
      .map((v) => v.toLowerCase()),
  );

  const out: Record<string, string[]> = {};
  for (const entity of entities) {
    if (!entity.name) continue;
    if (ownedSet.has(entity.name.toLowerCase())) continue;

    // Find earliest position of this competitor (name OR alias).
    const variants: string[] = [entity.name];
    if (entity.aliases) {
      for (const a of entity.aliases) if (a) variants.push(a);
    }
    let earliest: number | null = null;
    for (const variant of variants) {
      const idx = lower.indexOf(variant.toLowerCase());
      if (idx < 0) continue;
      if (earliest === null || idx < earliest) earliest = idx;
    }
    if (earliest === null) continue;

    // Combine owned brand variants + this competitor's own variants
    // into the "drop these tokens" set so the window is "words near
    // competitor, not competitor itself, not the owned brand".
    const dropFromWindow: string[] = [...ownedNameVariants, ...variants];

    const window = extractDescriptorWindow(
      answerText,
      earliest,
      dropFromWindow,
      options,
    );
    if (window.length > 0) out[entity.name] = window;
  }
  return out;
}

// Domain classification heuristic. Seeded with the minimum set that covers
// the Bay-Area-custom-home-builder tenant; operator can expand via a
// follow-up if a real citation comes in that we miscategorize. Matches run
// against the full domain string lower-cased; subdomain prefixes are
// stripped during match (e.g. `www.houzz.com` matches `houzz.com`).
const DIRECTORY_DOMAINS: ReadonlySet<string> = new Set([
  "houzz.com", "yelp.com", "angi.com", "bbb.org", "porch.com",
  "homeadvisor.com", "bark.com", "thumbtack.com", "buildzoom.com",
  "nari.org", "procurenet.com", "contractor-connection.com",
]);
const NEWS_DOMAINS: ReadonlySet<string> = new Set([
  "nytimes.com", "wsj.com", "bloomberg.com", "forbes.com",
  "businessinsider.com", "reuters.com", "apnews.com", "cnbc.com",
  "sfgate.com", "mercurynews.com", "paloaltoonline.com", "sfchronicle.com",
  "theatlantic.com", "wired.com", "architecturaldigest.com",
  "dwell.com", "housebeautiful.com",
]);
const REVIEW_DOMAINS: ReadonlySet<string> = new Set([
  "trustpilot.com", "sitejabber.com", "tripadvisor.com", "glassdoor.com",
  "consumerreports.org",
]);
const SOCIAL_DOMAINS: ReadonlySet<string> = new Set([
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "reddit.com",
  "quora.com",
]);

function normalizeDomain(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Strip protocol if ever present.
  const noProto = lower.replace(/^https?:\/\//, "");
  // Strip path portion if present.
  const hostOnly = noProto.split("/")[0] ?? "";
  // Strip www. prefix.
  return hostOnly.replace(/^www\./, "");
}

/**
 * Classifies each citation domain into one of `CitationDomainClass`.
 * Output is parallel to the input array (same length, same order). Uses
 * the tracked-entity lists to identify owned + competitor domains, then
 * falls through to the directory / news / review / social seed lists.
 */
export function classifyCitationDomains(
  citationDomains: string[],
  ownedDomains: ReadonlySet<string>,
  competitorDomains: ReadonlySet<string>,
): CitationDomainClass[] {
  return citationDomains.map((raw) => {
    if (!raw) return "other" as CitationDomainClass;
    const d = normalizeDomain(raw);
    if (ownedDomains.has(d)) return "owned";
    if (competitorDomains.has(d)) return "competitor";
    if (DIRECTORY_DOMAINS.has(d)) return "directory";
    if (NEWS_DOMAINS.has(d)) return "news";
    if (REVIEW_DOMAINS.has(d)) return "review";
    if (SOCIAL_DOMAINS.has(d)) return "social";
    return "other";
  });
}

/**
 * Classifies the shape of the answer text. Heuristic — looks for numbered-
 * list markers, bullet markers, comparison words. Returns "narrative" as
 * the default fallback. "mixed" when multiple strong structural signals
 * fire (e.g., both a ranked list and heavy comparison language).
 *
 * Returns null when answerText is empty (distinct from "narrative").
 */
export function extractAnswerStructure(
  answerText: string,
): AnswerStructure | null {
  if (!answerText) return null;

  // Count numbered-list markers at line start: "1.", "2.", "1)" etc.
  const rankedMarkers = (
    answerText.match(/(^|\n)\s*\d+[.)]\s+/g) ?? []
  ).length;
  // Count bullet markers at line start: "- ", "* ", "• " (various bullets).
  const bulletMarkers = (
    answerText.match(/(^|\n)\s*[-*+•·▪]\s+/g) ?? []
  ).length;
  // Comparison language (case-insensitive).
  const comparisonMarkers = (
    answerText.match(
      /\b(?:vs\.?|versus|compared to|whereas|while|than|over|better than|worse than)\b/gi,
    ) ?? []
  ).length;

  const hasRanked = rankedMarkers >= 3;
  const hasBullet = bulletMarkers >= 3;
  const hasComparison = comparisonMarkers >= 3;

  const strongSignals = [hasRanked, hasBullet, hasComparison].filter(
    (x) => x,
  ).length;

  if (strongSignals >= 2) return "mixed";
  if (hasRanked) return "ranked_list";
  if (hasBullet) return "bullet_list";
  if (hasComparison) return "comparison";
  return "narrative";
}
