/**
 * language-gap/language-gaps (2026-07-02, master plan item 24) - PURE.
 *
 * The matrix: joins per-page GSC query demand (already classified by script
 * and language) against what language that page's own content is actually
 * written in, and emits deterministic gap findings.
 *
 * Two gap kinds:
 *   - "farsi_demand_no_farsi_content": real Farsi-script (or confident
 *     Finglish) impression volume lands on a page whose crawled content has
 *     no Farsi script at all. The page is invisible to the exact demand it
 *     is already receiving.
 *   - "missing_variant_spellings": the page DOES have Farsi content, but a
 *     transliteration-variant cluster (chaharshanbe / chaharshanbeh / 4shanbe
 *     / ...) shows real impressions on spellings the page's own text never
 *     mentions - a citable "add these spellings" fix distinct from "add
 *     Farsi content at all".
 *
 * TENANT-AGNOSTIC: every function here takes classification + folding as
 * inputs; nothing hardcodes Persian. Swap in a different folding table and
 * script definition and the exact same join logic serves a different
 * language pair.
 *
 * Deterministic, $0, no I/O, no LLM.
 */

import { classifyQuery, type ClassifyQueryOptions } from "./classify-query";
import { clusterVariants, type VariantCluster, type FoldingRule, PERSIAN_FOLDING_TABLE } from "./variant-folding";
import type { PageLanguageProfile } from "./page-language";

export type PageQueryDemand = {
  query: string;
  impressions: number;
  clicks: number;
};

export type LanguageGapKind = "farsi_demand_no_farsi_content" | "missing_variant_spellings";

export type LanguageGap = {
  page: string;
  gapKind: LanguageGapKind;
  /** The impression volume behind this finding (native-script + confident
   *  Finglish for the "no content" gap; the missing-spelling cluster's own
   *  total for the variant gap). */
  impressions: number;
  /** Up to 3 example spellings/queries backing the finding, biggest first. */
  topVariants: string[];
  /** Ready-to-show operator sentence (first person, plain business copy, no
   *  em/en dashes). */
  sentence: string;
};

/** Minimum native-script+Finglish impressions before a "no content" gap is
 *  worth naming (a 12-impression trickle is not a headline). */
export const MIN_IMPRESSIONS_FOR_CONTENT_GAP = 50;
/** Minimum impressions on the MISSING spellings within a variant cluster
 *  before a "missing spellings" gap is worth naming. */
export const MIN_IMPRESSIONS_FOR_VARIANT_GAP = 30;
/** A page needs at least this share of Farsi-script letters to count as
 *  genuinely having Farsi content for the variant-gap test (mirrors
 *  page-language's own content threshold; kept local so this module stays
 *  self-contained and testable without importing the page-language default). */
const HAS_FARSI_CONTENT_MIN_RATIO = 0.03;

function roundConfidence(query: string, options?: ClassifyQueryOptions): boolean {
  const c = classifyQuery(query, options);
  return (c.language === "fa" && c.confidence >= 0.8) || (c.language === "finglish" && c.confidence >= 0.65);
}

/**
 * Gap 1: farsi_demand_no_farsi_content. Sum impressions across every query
 * on this page that classifies confidently as Farsi-script or Finglish; if
 * that sum clears the floor AND the page's own content has ~no Farsi script,
 * emit a gap. A page with no known profile (never crawled) is skipped
 * entirely - never fabricate a "no Farsi text" claim about a page we have
 * not actually looked at. PURE.
 */
export function findContentLanguageGap(
  page: string,
  queries: PageQueryDemand[],
  pageProfile: PageLanguageProfile | undefined,
  options?: ClassifyQueryOptions,
): LanguageGap | null {
  // Never crawled -> never fabricate a "no Farsi text" claim; stay silent
  // until a real snapshot exists to check.
  if (pageProfile == null) return null;
  const hasFarsiContent = pageProfile.farsiRatio >= HAS_FARSI_CONTENT_MIN_RATIO && pageProfile.lettersSampled > 0;
  if (hasFarsiContent) return null;

  const matches = queries
    .filter((q) => q.query && q.impressions > 0 && roundConfidence(q.query, options))
    .sort((a, b) => b.impressions - a.impressions);
  const impressions = matches.reduce((s, q) => s + q.impressions, 0);
  if (impressions < MIN_IMPRESSIONS_FOR_CONTENT_GAP) return null;

  const topVariants = matches.slice(0, 3).map((q) => q.query);
  const shown = impressions.toLocaleString();
  const example = topVariants[0] ? ` (for example "${topVariants[0]}")` : "";
  // English-first product rule (operator directive 2026-07-02): we never
  // suggest writing translated content. The move is an ENGLISH one - make
  // sure the page names the topic with the spellings and terms people
  // actually type, so this demand still lands here.
  const sentence = `This page draws ${shown} searches typed in another script${example}. The English move: name the topic with the spellings people actually type, so those searches still land here.`;

  return { page, gapKind: "farsi_demand_no_farsi_content", impressions, topVariants, sentence };
}

/**
 * Gap 2: missing_variant_spellings. Cluster this page's queries into
 * transliteration families; for each cluster whose page text (checked via
 * `pageMentionsAny`, so the caller controls what "mentions" means against
 * its own crawled text) is missing one or more high-impression spellings,
 * emit a gap naming the missing spellings. Ranked by missed impressions,
 * returns at most one gap per page (the single biggest missed family) so the
 * matrix stays one clean finding per page, matching gap 1's shape.
 */
export function findVariantSpellingGap(
  page: string,
  queries: PageQueryDemand[],
  pageProfile: PageLanguageProfile | undefined,
  pageMentionsVariant: (variant: string) => boolean,
  table: readonly FoldingRule[] = PERSIAN_FOLDING_TABLE,
): LanguageGap | null {
  const hasFarsiContent = pageProfile != null && pageProfile.farsiRatio >= HAS_FARSI_CONTENT_MIN_RATIO && pageProfile.lettersSampled > 0;
  if (!hasFarsiContent) return null; // gap 1 already covers "no content at all"

  const clusters = clusterVariants(
    queries.map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks })),
    table,
  );

  let best: { cluster: VariantCluster; missing: VariantCluster["variants"]; missedImpressions: number } | null = null;
  for (const cluster of clusters) {
    if (cluster.variants.length < 2) continue; // no variant family to speak of
    const missing = cluster.variants.filter((v) => !pageMentionsVariant(v.query));
    const missedImpressions = missing.reduce((s, v) => s + v.impressions, 0);
    if (missedImpressions < MIN_IMPRESSIONS_FOR_VARIANT_GAP) continue;
    if (!best || missedImpressions > best.missedImpressions) {
      best = { cluster, missing, missedImpressions };
    }
  }
  if (!best) return null;

  const topVariants = best.missing.slice(0, 3).map((v) => v.query);
  const shown = best.missedImpressions.toLocaleString();
  const spellingsList = topVariants.map((v) => `"${v}"`).join(", ");
  const sentence = `People search this page's topic with spellings it never mentions: ${spellingsList}. That is ${shown} impressions this page could be catching.`;

  return { page, gapKind: "missing_variant_spellings", impressions: best.missedImpressions, topVariants, sentence };
}

export type LanguageGapInputs = {
  /** Per-page query demand (query, impressions, clicks) - typically the
   *  cached GSC page-signal topQueries the daily plan builder already
   *  loaded, keyed by owned page URL/path. */
  queriesByPage: Map<string, PageQueryDemand[]>;
  /** Per-page language profile from page-language.ts, keyed the same way. */
  pageProfiles: Map<string, PageLanguageProfile>;
  /** How a page's crawled text is checked for a given spelling (the caller
   *  supplies this so language-gaps.ts never needs raw page text itself -
   *  keeps this module's inputs to plain data, matching every sibling
   *  matrix builder in this codebase). */
  pageMentionsVariant: (page: string, variant: string) => boolean;
  classifyOptions?: ClassifyQueryOptions;
  foldingTable?: readonly FoldingRule[];
};

/**
 * Build the full language-gap matrix across every page with query demand.
 * PURE join: for each page, try the content gap first (bigger, more urgent
 * finding when a page has literally no matching-script content); only when
 * the page DOES have Farsi content do we look for a missing-spellings gap.
 * Ranked by impressions across the whole matrix (biggest gap first).
 */
export function buildLanguageGaps(inputs: LanguageGapInputs): LanguageGap[] {
  const gaps: LanguageGap[] = [];
  for (const [page, queries] of inputs.queriesByPage) {
    const profile = inputs.pageProfiles.get(page);
    const contentGap = findContentLanguageGap(page, queries, profile, inputs.classifyOptions);
    if (contentGap) {
      gaps.push(contentGap);
      continue; // one finding per page, the bigger issue wins
    }
    const variantGap = findVariantSpellingGap(
      page,
      queries,
      profile,
      (variant) => inputs.pageMentionsVariant(page, variant),
      inputs.foldingTable,
    );
    if (variantGap) gaps.push(variantGap);
  }
  gaps.sort((a, b) => b.impressions - a.impressions);
  return gaps;
}
