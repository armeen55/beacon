/**
 * Data-grounded keyword gap scanner \u2014 v3 (2026-04-19).
 *
 * Primary signal: `observation.search_queries[]` (AI's internal retrieval
 * queries, captured from Profound raw exports / native engine tool-use).
 * Supporting evidence only: raw queries appear in the "Why we suggest this"
 * expand; never as the primary recommendation text.
 *
 * 3-tier signal model:
 *   Tier 1  saturation_miss  \u2014 Concept appears in >=X% of topic-cluster
 *                             observations BUT the page's headings don't
 *                             cover it. Table-stakes miss. Top priority.
 *   Tier 2  gap             \u2014 Concept where competitors are cited \u22655\u00d7 and
 *                             Ritz is cited \u22642\u00d7. Competitive asymmetry.
 *   Tier 3  positive         \u2014 Concept where Ritz and competitors both get
 *                             cited. Computed + stored, NOT surfaced in the
 *                             Today fix stack per product rule.
 *
 * Concept unit = bigram OR trigram extracted from search queries (content
 * words only, stopwords removed). A concept is considered "covered" by the
 * page if it appears as a substring in title/H1/H2 lowercase text.
 *
 * Per-page cap: up to 2 saturation misses + 2 gaps + 1 positive per page.
 * Positive findings are marked and stored but should be filtered out when
 * today-data selects which findings to surface in the main fix stack.
 */

import type { PageSnapshot, CitationEvidenceIndex } from "@/domains/pages/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { BeaconRecommendation } from "./recommendation-engine";

// ---------------------------------------------------------------------------
// Thresholds (tuning knobs)
// ---------------------------------------------------------------------------

const MIN_PAGE_CITATIONS = 10;
const MIN_QUERY_LENGTH = 15;
const MAX_SATURATION_MISSES_PER_PAGE = 2;
const MAX_GAPS_PER_PAGE = 2;
const MAX_POSITIVES_PER_PAGE = 1;

/** Tier 2 gap thresholds. Counts measured at the concept level across topic observations. */
const MIN_COMPETITOR_OBS_FOR_GAP = 5;
const MAX_RITZ_OBS_FOR_GAP = 2;

/** Tier 3 positive thresholds. */
const MIN_COMPETITOR_OBS_FOR_POSITIVE = 5;
const MIN_RITZ_OBS_FOR_POSITIVE = 3;

/** Platforms that don't expose search_queries (accepted blind spot). */
const EXCLUDED_PLATFORMS = new Set([
  "Google AI Overviews",
  "google_aio",
  "Google AIO",
]);

/** Linguistic glue to drop before extracting n-grams. Keeps the concept focus. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "for", "in", "on", "at", "by", "with", "from",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "and", "or", "but", "not", "no", "yes", "so", "if", "as", "do",
  "does", "did", "can", "could", "will", "would", "should", "may", "might",
  "you", "your", "yours", "we", "our", "ours", "they", "their", "theirs",
  "it", "its", "he", "she", "his", "her", "them", "who", "whom", "what",
  "which", "where", "when", "why", "how", "there", "here", "more", "most",
  "some", "all", "any", "every", "each", "very", "really", "much", "many",
  "one", "two", "also", "well", "just", "new", "get", "make", "need",
  "want", "like", "top", "best",
  // Plan B2 Rule A (2026-04-20): narrow preposition additions. These are the
  // highest-confidence fragment-makers — they commonly appear in AI search
  // queries as connectors that produce awkward concepts when expansion
  // reaches across them ("Modernizing Older Homes Without Expanding").
  // Additional prepositions (over, under, about, against, etc.) deferred
  // until dogfood demonstrates need.
  "without", "through", "during", "while", "after", "before", "between",
]);

// Plan B2 Rule C (2026-04-20): narrow noun-head set. A 3+ word concept whose
// last two tokens are BOTH in this set is almost always a robotic noun pileup
// ("Firm Architect", "Builder Contractor"). Deliberately does NOT include
// softer words (specialist, professional, provider, service, team, partner,
// advisor, manager, director, organization) to avoid killing borderline-
// readable phrases in v1. Expand later only if dogfood demonstrates need.
const NOUN_HEAD_SET = new Set([
  "firm", "company", "agency", "contractor", "builder",
  "architect", "designer", "consultant", "engineer", "developer",
]);

// Plan B2 Rule D (2026-04-20): defensive preposition-in-concept check. After
// Rule A's STOPWORDS additions, concepts should rarely contain these tokens
// mid-phrase — the expansion logic treats STOPWORDS as hard boundaries. Rule
// D is belt-and-suspenders for any edge case that slips through expansion.
const PREPOSITION_SET = new Set([
  "with", "without", "for", "of", "in", "on", "at", "by", "from", "to",
  "through", "during", "while", "after", "before", "between",
]);

/** Tier 1 thresholds \u2014 tunable at call time. */
export type SaturationThresholds = {
  /** Concept must appear in at least this fraction of topic-cluster observations. */
  minSaturationRate: number;
  /** Concept is a "miss" when page covers at most this fraction of the concept's content words. */
  maxCoverageRatio: number;
  /** Concept must appear in at least this many observations (absolute floor). */
  minAbsoluteOccurrences: number;
};

export const DEFAULT_SATURATION_THRESHOLDS: SaturationThresholds = {
  minSaturationRate: 0.25,
  maxCoverageRatio: 0.50,
  minAbsoluteOccurrences: 15,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type KeywordGapKind = "saturation_miss" | "gap" | "positive";

export type KeywordGap = {
  kind: KeywordGapKind;
  pageUrl: string;
  pagePath: string;
  /** The surfaced concept \u2014 bigram or trigram, Title Cased for display.
   *  This is what the operator reads as the primary subject of the rec. */
  concept: string;
  /** Concept as a single lowercase phrase for substring matching/debug. */
  conceptNormalized: string;
  /** Whether this concept is a bigram or trigram. Useful for debug; informs
   *  the ranking (bigrams are more common; trigrams are more specific). */
  conceptType: "bigram" | "trigram";
  /** Target element on the page for a rewrite. */
  targetElement: "title" | "h1" | "h2";
  currentHeadingText: string;
  evidence: {
    /** Number of topic-cluster observations containing this concept in their search_queries. */
    observation_count: number;
    /** Denominator for saturation rate. */
    topic_cluster_size: number;
    /** observation_count / topic_cluster_size (0..1). */
    saturation_rate: number;
    /** How many observations in competitor-citing bucket contain this concept. */
    competitor_obs_count: number;
    /** How many observations in Ritz-citing bucket contain this concept. */
    ritz_obs_count: number;
    /** Topic(s) this concept appeared under. */
    topics: string[];
    /** Up to 5 raw search queries that contained this concept (for the "evidence" expand). */
    example_queries: string[];
    /** Up to 2 short excerpts from AI answer texts where this concept appeared in a cited answer. */
    example_excerpts: string[];
    /** Did the page's headings cover this concept at all? 0..1. */
    page_coverage_ratio: number;
  };
  page_citations: number;
  confidence: "high" | "medium" | "low";
  impactScore: number;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scanKeywordGaps(opts: {
  pageSnapshots: PageSnapshot[];
  citationCountMap: Map<string, number>;
  citationIndex: CitationEvidenceIndex | null;
  observations: PromptAnswerObservation[];
  answerTexts: Record<string, string>;
  brandAliases: string[];
  competitorExclusions: string[];
  experimentUrls?: Set<string>;
  saturationThresholds?: SaturationThresholds;
  /**
   * City names / location labels to exclude from concept surfacing. If a
   * concept is composed ENTIRELY of these tokens (e.g. "Menlo Park" alone),
   * the finding is suppressed \u2014 recommending "add Menlo Park to your
   * Atherton page" is almost always wrong advice; cities are co-occurring
   * context, not content to adopt.
   */
  knownLocations?: string[];
}): KeywordGap[] {
  if (!opts.citationIndex?.page_to_topics) return [];

  const brandAliasesLC = new Set(opts.brandAliases.map((a) => a.toLowerCase()));
  const competitorLC = opts.competitorExclusions
    .map((c) => c.toLowerCase())
    .filter(Boolean);
  const satThresholds = opts.saturationThresholds ?? DEFAULT_SATURATION_THRESHOLDS;
  // Build a token-level set of city words from location labels. e.g.
  // ["Menlo Park", "Palo Alto"] \u2192 Set{ "menlo", "park", "palo", "alto" }.
  // A concept is "pure city" if every content word is in this set.
  const cityTokenSet = new Set<string>();
  for (const loc of opts.knownLocations ?? []) {
    for (const t of loc.toLowerCase().split(/\s+/)) {
      if (t.length > 0) cityTokenSet.add(t);
    }
  }

  // Bucket observations by topic (only those with usable search_queries).
  const obsByTopic = new Map<string, PromptAnswerObservation[]>();
  for (const obs of opts.observations) {
    if (EXCLUDED_PLATFORMS.has(obs.platform)) continue;
    if (!obs.search_queries || obs.search_queries.length === 0) continue;
    const t = obs.topic?.trim();
    if (!t) continue;
    if (!obsByTopic.has(t)) obsByTopic.set(t, []);
    obsByTopic.get(t)!.push(obs);
  }

  const findings: KeywordGap[] = [];

  for (const snap of opts.pageSnapshots) {
    const pageFindings = scanPage(
      snap,
      opts.citationCountMap,
      opts.citationIndex,
      obsByTopic,
      opts.answerTexts,
      brandAliasesLC,
      competitorLC,
      opts.experimentUrls,
      satThresholds,
      cityTokenSet,
    );
    findings.push(...pageFindings);
  }

  // Cross-page rank by impact.
  findings.sort((a, b) => b.impactScore - a.impactScore);
  return findings;
}

// ---------------------------------------------------------------------------
// Per-page scanner
// ---------------------------------------------------------------------------

/** Structured stats for one concept across a page's topic cluster. */
type ConceptStat = {
  concept: string; // normalized bigram/trigram, e.g. "high-end custom home"
  conceptType: "bigram" | "trigram";
  /** Obs IDs where ANY search query contained this concept. Use .size for the denominator-friendly count. */
  allObs: Set<string>;
  competitorObs: Set<string>;
  ritzObs: Set<string>;
  exampleQueries: Set<string>;
  topics: Set<string>;
};

function scanPage(
  snap: PageSnapshot,
  citationCountMap: Map<string, number>,
  citationIndex: CitationEvidenceIndex,
  obsByTopic: Map<string, PromptAnswerObservation[]>,
  answerTexts: Record<string, string>,
  brandAliasesLC: Set<string>,
  competitorLC: string[],
  experimentUrls: Set<string> | undefined,
  satThresholds: SaturationThresholds,
  cityTokenSet: Set<string>,
): KeywordGap[] {
  const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
  const pathOnly = snap.url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const pageCitations = citationCountMap.get(normUrl) ?? 0;

  if (pageCitations < MIN_PAGE_CITATIONS) return [];
  if (experimentUrls?.has(pathOnly)) return [];
  if (snap.extraction_certainty === "uncertain") return [];

  const topics =
    citationIndex.page_to_topics[snap.url] ??
    citationIndex.page_to_topics[normUrl] ??
    [];
  if (topics.length === 0) return [];

  // Aggregate concepts across all topics this page covers.
  const conceptStats = new Map<string, ConceptStat>();
  let topicClusterSize = 0; // total observations across the page's topics

  for (const topic of topics) {
    const topicObs = obsByTopic.get(topic) ?? [];
    topicClusterSize += topicObs.length;

    for (const obs of topicObs) {
      const isOurs =
        obs.tracked_brand_cited === true ||
        obs.tracked_brand_mentioned === true;
      const mentionsCompetitor = (obs.mentions ?? []).some(
        (m) => !brandAliasesLC.has(m.toLowerCase()),
      );

      // Extract unique concepts observed in this single observation's queries.
      const seenConceptsInObs = new Set<string>();
      for (const q of obs.search_queries ?? []) {
        const qTrimmed = q.trim();
        if (qTrimmed.length < MIN_QUERY_LENGTH) continue;

        // Drop queries containing a competitor name verbatim \u2014 they carry
        // competitor-specific content that shouldn't feed our own page recs.
        const qLC = qTrimmed.toLowerCase();
        if (competitorLC.some((c) => c.length > 0 && qLC.includes(c))) continue;

        const { bigrams, trigrams } = extractConcepts(qTrimmed);
        for (const c of bigrams) {
          const key = `bigram::${c}`;
          seenConceptsInObs.add(key);
          touchConcept(conceptStats, key, c, "bigram", topic, qTrimmed);
        }
        for (const c of trigrams) {
          const key = `trigram::${c}`;
          seenConceptsInObs.add(key);
          touchConcept(conceptStats, key, c, "trigram", topic, qTrimmed);
        }
      }

      // Once all of this observation's concepts are known, update obs counts.
      for (const key of seenConceptsInObs) {
        const stat = conceptStats.get(key)!;
        stat.allObs.add(obs.id);
        if (isOurs) stat.ritzObs.add(obs.id);
        else if (mentionsCompetitor) stat.competitorObs.add(obs.id);
      }
    }
  }

  if (conceptStats.size === 0 || topicClusterSize === 0) return [];

  // Plan A + B1 (2026-04-20): broader coverage reference. Was previously
  // limited to title + H1 + H2, which made the scanner emit saturation_miss
  // recs for concepts already covered in H3s, body paragraphs, card text,
  // schema entity names, FAQ questions, or meta description. Widened to
  // read from all safe sources.
  //
  // Deliberately EXCLUDED: nav labels, image alts, internal_links anchor
  // text — all of those carry cross-page boilerplate that would produce
  // false "covered" signals.
  //
  // Matcher unchanged (raw substring). Singular-fold matcher migration is
  // out of scope for this pass.
  const pageText = [
    snap.title ?? "",
    snap.meta_description ?? "",
    snap.h1 ?? "",
    ...(snap.h2_list ?? []),
    ...(snap.h3_list ?? []),
    ...(snap.body_paragraph_sample ?? []),
    ...(snap.card_texts ?? []),
    ...(snap.schema_entity_names ?? []),
    ...(snap.faqs ?? []).map((f) => f.question),
  ]
    .filter(Boolean)
    .join(" \u00b7 ")
    .toLowerCase();

  // Score each concept for all 3 tiers. Fix-1 (city filter), Fix-2 (smart
  // heading target), Fix-3 (concept expansion), and readability gate all
  // apply inside this loop per-concept.
  const pageFindings: KeywordGap[] = [];
  for (const stat of conceptStats.values()) {
    const allObsCount = stat.allObs.size;
    const competitorObsCount = stat.competitorObs.size;
    const ritzObsCount = stat.ritzObs.size;
    const saturationRate = allObsCount / topicClusterSize;

    // Fix-3: Concept expansion \u2014 TIER-AWARE.
    //
    // Expansion works well for narrow, high-specificity concepts (Tier 2
    // gaps like "home renovation contractors" \u2192 "home renovation contractors
    // menlo park"). It BREAKS for broad, high-saturation concepts (Tier 1)
    // because expansion candidates are too variable across example queries
    // and pull in unrelated adjacent tokens ("builders bay area" \u2192 "harwood
    // construction redwood city atherton" \u2014 nonsense).
    //
    // Decision: defer expansion until AFTER tier classification. Tier 1
    // uses the raw concept (readability gate will filter fragments). Tier 2
    // uses the expanded concept.
    const rawConcept = stat.concept;
    const rawConceptWords = rawConcept.split(/\s+/).filter(Boolean);

    // Fix-1: City-name filter. Runs on raw concept before expansion since
    // expansion might pull in city tokens as adjacent context.
    if (
      rawConceptWords.length > 0 &&
      rawConceptWords.every((w) => cityTokenSet.has(w))
    ) {
      continue;
    }

    // Coverage check first (against raw concept) to compute saturation tier.
    const pageHasFullRaw = pageText.includes(rawConcept);
    const coveredWordsRaw = rawConceptWords.filter((w) => pageText.includes(w));
    const pageCoverageRatioRaw = pageHasFullRaw
      ? 1.0
      : rawConceptWords.length > 0
        ? coveredWordsRaw.length / rawConceptWords.length
        : 0;

    // Tier 1: Saturation Miss (highest priority).
    const isSaturationMiss =
      allObsCount >= satThresholds.minAbsoluteOccurrences &&
      saturationRate >= satThresholds.minSaturationRate &&
      pageCoverageRatioRaw <= satThresholds.maxCoverageRatio;

    // Tier 2: Competitive Gap.
    const isGap =
      !isSaturationMiss &&
      competitorObsCount >= MIN_COMPETITOR_OBS_FOR_GAP &&
      ritzObsCount <= MAX_RITZ_OBS_FOR_GAP &&
      pageCoverageRatioRaw < 0.75;

    // Tier 3: Positive/Winning.
    const isPositive =
      !isSaturationMiss &&
      !isGap &&
      competitorObsCount >= MIN_COMPETITOR_OBS_FOR_POSITIVE &&
      ritzObsCount >= MIN_RITZ_OBS_FOR_POSITIVE;

    if (!isSaturationMiss && !isGap && !isPositive) continue;

    const kind: KeywordGapKind = isSaturationMiss
      ? "saturation_miss"
      : isGap
        ? "gap"
        : "positive";

    // Tier-specific concept finalization:
    //   Tier 1 (broad/high-saturation) \u2014 use raw concept; apply strict
    //     readability gate to drop fragments like "Builders Bay Area".
    //   Tier 2 (narrow/competitive) \u2014 expand concept using example queries
    //     to add qualifying context, then re-check coverage.
    //   Tier 3 (positive) \u2014 doesn't surface in Today anyway; keep raw.
    let finalConcept = rawConcept;
    let finalConceptWords = rawConceptWords;
    let pageCoverageRatio = pageCoverageRatioRaw;

    if (kind === "gap") {
      const expanded = expandConcept(rawConcept, stat.exampleQueries);
      const expandedWords = expanded.split(/\s+/).filter(Boolean);
      // Only apply expansion if it added SOMETHING AND didn't grow too long.
      if (expandedWords.length > rawConceptWords.length && expandedWords.length <= 5) {
        finalConcept = expanded;
        finalConceptWords = expandedWords;
        const pageHasFullExp = pageText.includes(expanded);
        const coveredWordsExp = expandedWords.filter((w) => pageText.includes(w));
        pageCoverageRatio = pageHasFullExp
          ? 1.0
          : expandedWords.length > 0
            ? coveredWordsExp.length / expandedWords.length
            : 0;
      }
    }

    // Readability gate \u2014 strict for Tier 1, same filter for Tier 2/3.
    if (!isReadableConcept(finalConcept)) continue;

    // Plan B2 (2026-04-20): phrase-shape gate — rejects noun-pileup (Rule C)
    // and preposition-governed fragments (Rule D). Logs each rejection in
    // one readable line so dogfood can see what's being stripped.
    const shape = passesPhraseShapeGate(finalConcept);
    if (!shape.ok) {
      console.error(
        `[phrase-shape] "${titleCaseConcept(finalConcept)}" on ${snap.url.replace(/^https?:\/\/[^/]+/, "")} \u2192 reject: rule ${shape.rule} (${shape.reason})`,
      );
      continue;
    }

    // Fix-2: Smart heading target selection.
    const target = pickBestHeadingTarget(snap, finalConceptWords);
    const targetElement = target.element;
    const currentHeadingText = target.text;

    // Scoring. Deliberately different per tier so the final cross-page ranking
    // respects tier priority (saturation > gap > positive).
    const pageWeight = Math.log10(pageCitations + 1);
    const uncoveredWeight = 1 - pageCoverageRatio;
    // Trigrams are more specific so they get a slight bonus in score when they
    // also hit the same thresholds. Prevents generic bigrams dominating.
    const specificityBonus = stat.conceptType === "trigram" ? 1.15 : 1.0;

    let base: number;
    if (kind === "saturation_miss") {
      // Weight by both absolute count AND saturation rate \u2014 a concept that
      // appears in 50% of a 1000-obs topic is more load-bearing than one in
      // 50% of a 50-obs topic.
      base =
        allObsCount *
        (1 + saturationRate * 2) *
        specificityBonus *
        10; // tier bonus so saturation always ranks above gap in cross-page sort
    } else if (kind === "gap") {
      const asymmetry =
        1 - ritzObsCount / Math.max(competitorObsCount, 1);
      base = competitorObsCount * asymmetry * specificityBonus;
    } else {
      base = ritzObsCount * specificityBonus;
    }
    const impactScore = base * pageWeight * (0.5 + uncoveredWeight);

    const confidence: "high" | "medium" | "low" =
      (kind === "saturation_miss" ? allObsCount : competitorObsCount) >= 30
        ? "high"
        : (kind === "saturation_miss" ? allObsCount : competitorObsCount) >= 15
          ? "medium"
          : "low";

    // Collect up to 5 example queries for evidence expand.
    const exampleQueries = [...stat.exampleQueries].slice(0, 5);
    // Collect up to 2 excerpts from answer texts.
    const excerptSource =
      kind === "saturation_miss"
        ? [...stat.allObs].slice(0, 10)
        : [...stat.competitorObs].slice(0, 10);
    const excerpts = pullExcerptsFromIds(excerptSource, answerTexts, 2);

    pageFindings.push({
      kind,
      pageUrl: snap.url,
      pagePath: snap.url.replace(/^https?:\/\/[^/]+/, ""),
      concept: titleCaseConcept(finalConcept),
      conceptNormalized: finalConcept,
      conceptType: stat.conceptType,
      targetElement,
      currentHeadingText,
      evidence: {
        observation_count: allObsCount,
        topic_cluster_size: topicClusterSize,
        saturation_rate: saturationRate,
        competitor_obs_count: competitorObsCount,
        ritz_obs_count: ritzObsCount,
        topics: [...stat.topics],
        example_queries: exampleQueries,
        example_excerpts: excerpts,
        page_coverage_ratio: pageCoverageRatio,
      },
      page_citations: pageCitations,
      confidence,
      impactScore,
    });
  }

  // Dedup within page: if a bigram AND a trigram containing the bigram both
  // qualify, keep the trigram (more specific) and drop the bigram. Prevents
  // "bay area" + "luxury bay area" both surfacing on the same page as separate
  // saturation misses for essentially the same concept.
  const deduped = dedupeOverlappingConcepts(pageFindings);

  // Per-tier per-page caps.
  const sat = deduped
    .filter((f) => f.kind === "saturation_miss")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, MAX_SATURATION_MISSES_PER_PAGE);
  const gap = deduped
    .filter((f) => f.kind === "gap")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, MAX_GAPS_PER_PAGE);
  const pos = deduped
    .filter((f) => f.kind === "positive")
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, MAX_POSITIVES_PER_PAGE);

  return [...sat, ...gap, ...pos];
}

// ---------------------------------------------------------------------------
// Concept extraction + helpers
// ---------------------------------------------------------------------------

function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function isMeaningful(token: string): boolean {
  if (STOPWORDS.has(token)) return false;
  if (token.length < 3) return false;
  // Drop pure-numeric tokens.
  if (/^\d+$/.test(token)) return false;
  return true;
}

/**
 * Extract bigrams + trigrams from a single query. A concept must contain ONLY
 * meaningful tokens (no stopwords, no numeric-only). Stopwords act as concept
 * boundaries: "in the Bay Area" \u2192 "bay area" but not "in bay" / "the bay".
 */
function extractConcepts(query: string): {
  bigrams: string[];
  trigrams: string[];
} {
  const tokens = tokenizeQuery(query);
  const bigrams: string[] = [];
  const trigrams: string[] = [];

  // Walk tokens and break into meaningful spans (separated by stopwords).
  let span: string[] = [];
  const spans: string[][] = [];
  for (const t of tokens) {
    if (isMeaningful(t)) {
      span.push(t);
    } else if (span.length > 0) {
      spans.push(span);
      span = [];
    }
  }
  if (span.length > 0) spans.push(span);

  // Emit bigrams + trigrams inside each span.
  for (const s of spans) {
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.push(`${s[i]} ${s[i + 1]}`);
      if (i < s.length - 2) {
        trigrams.push(`${s[i]} ${s[i + 1]} ${s[i + 2]}`);
      }
    }
  }
  return { bigrams, trigrams };
}

function touchConcept(
  map: Map<string, ConceptStat>,
  key: string,
  concept: string,
  conceptType: "bigram" | "trigram",
  topic: string,
  exampleQuery: string,
): void {
  let stat = map.get(key);
  if (!stat) {
    stat = {
      concept,
      conceptType,
      allObs: new Set(),
      competitorObs: new Set(),
      ritzObs: new Set(),
      exampleQueries: new Set(),
      topics: new Set(),
    };
    map.set(key, stat);
  }
  stat.topics.add(topic);
  if (stat.exampleQueries.size < 10) stat.exampleQueries.add(exampleQuery);
}

/** Title-case a phrase: "high-end custom home" \u2192 "High-End Custom Home". */
function titleCaseConcept(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w) =>
      w
        .split("-")
        .map((s) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s))
        .join("-"),
    )
    .join(" ");
}

/**
 * Fix-3: Concept expansion. For each example query containing the concept,
 * find the longest natural-phrase span that contains the concept and is
 * bounded by stopwords / query edges. Return the most common such expansion.
 *
 * Turns "builders bay area" into "custom home builders bay area" when
 * "custom home" consistently precedes it in real queries.
 */
function expandConcept(
  concept: string,
  exampleQueries: Iterable<string>,
): string {
  const conceptTokens = concept.toLowerCase().split(/\s+/).filter(Boolean);
  if (conceptTokens.length === 0) return concept;

  const expansionCounts = new Map<string, number>();

  for (const query of exampleQueries) {
    const queryTokens = query
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (queryTokens.length < conceptTokens.length) continue;

    // Find the first occurrence of the concept tokens as a contiguous span.
    let matchStart = -1;
    for (let i = 0; i <= queryTokens.length - conceptTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < conceptTokens.length; j++) {
        if (queryTokens[i + j] !== conceptTokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matchStart = i;
        break;
      }
    }
    if (matchStart < 0) continue;
    const matchEnd = matchStart + conceptTokens.length;

    // Expand left while words are meaningful (not stopword, not numeric,
    // length \u22653).
    let left = matchStart;
    while (left > 0 && isMeaningful(queryTokens[left - 1])) left--;
    // Expand right symmetrically.
    let right = matchEnd;
    while (right < queryTokens.length && isMeaningful(queryTokens[right])) right++;

    const expanded = queryTokens.slice(left, right).join(" ");
    expansionCounts.set(expanded, (expansionCounts.get(expanded) ?? 0) + 1);
  }

  if (expansionCounts.size === 0) return concept;

  // Pick most frequent expansion; on tie prefer the longer form.
  const ranked = [...expansionCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].split(/\s+/).length - a[0].split(/\s+/).length;
  });
  // Cap expansion length to avoid absurd 8-word phrases.
  const best = ranked[0][0];
  const bestTokens = best.split(/\s+/);
  if (bestTokens.length > 5) {
    // Trim symmetrically around the original concept span to fit 5 tokens.
    return bestTokens.slice(0, 5).join(" ");
  }
  return best;
}

/**
 * Fix-2: Smart heading target. Pick the title/H1/H2 with the highest content-
 * word overlap with the concept. Tie-breaker: prefer H2, then H1, then title
 * (operators tend to edit H2s more freely than H1s or titles).
 */
function pickBestHeadingTarget(
  snap: PageSnapshot,
  conceptWords: string[],
): { element: "title" | "h1" | "h2"; text: string; h2Index?: number } {
  const candidates: Array<{
    element: "title" | "h1" | "h2";
    text: string;
    overlap: number;
    h2Index?: number;
  }> = [];

  if (snap.title) {
    candidates.push({
      element: "title",
      text: snap.title,
      overlap: overlapCount(snap.title, conceptWords),
    });
  }
  if (snap.h1) {
    candidates.push({
      element: "h1",
      text: snap.h1,
      overlap: overlapCount(snap.h1, conceptWords),
    });
  }
  for (let i = 0; i < (snap.h2_list?.length ?? 0); i++) {
    const h2 = snap.h2_list![i];
    candidates.push({
      element: "h2",
      text: h2,
      overlap: overlapCount(h2, conceptWords),
      h2Index: i,
    });
  }

  if (candidates.length === 0) {
    return { element: "title", text: snap.title ?? "" };
  }

  const preferenceRank = { h2: 0, h1: 1, title: 2 } as const;
  candidates.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return preferenceRank[a.element] - preferenceRank[b.element];
  });
  return candidates[0];
}

function overlapCount(text: string, tokens: string[]): number {
  const lc = text.toLowerCase();
  return tokens.filter((t) => lc.includes(t)).length;
}

/**
 * Readability gate. Rejects concepts that look like syntactic fragments:
 *   - 2-word concepts starting with a plural-form noun ("builders", "homes",
 *     "contractors") \u2014 almost always a fragment of a longer qualifier phrase.
 *   - Concepts starting or ending with weak words (generic adjectives alone).
 *
 * Returns true if the concept reads naturally as a noun phrase on its own.
 */
function isReadableConcept(concept: string): boolean {
  const tokens = concept.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  // Plural nouns that are fragment-starters when they head a 2-word concept.
  // Plan B2 Rule B (2026-04-20): extended with additional plural trade nouns
  // that commonly start fragment concepts in AI search query corpora.
  const FRAGMENT_STARTERS_2WORD = new Set([
    "builders", "contractors", "homes", "houses", "firms", "companies",
    "reviews", "services", "options", "specialists", "experts",
    // B2 extension:
    "remodelers", "renovators", "modernizers", "designers", "architects",
    "developers", "engineers", "agencies", "consultants", "professionals",
  ]);

  if (tokens.length === 2 && FRAGMENT_STARTERS_2WORD.has(tokens[0])) {
    return false;
  }

  // 3-word concepts starting with a fragment-starter AND ending with a city
  // token are almost always a windowed fragment (e.g. "builders bay area").
  // If it got past city-filter it means "area" isn't a known city token, but
  // the pattern is still suspect \u2014 require either a qualifier up front or a
  // specific enough tail word to count.
  if (tokens.length === 3 && FRAGMENT_STARTERS_2WORD.has(tokens[0])) {
    return false;
  }

  return true;
}

/**
 * Plan B2 (2026-04-20): deterministic phrase-shape gate applied AFTER the
 * existing `isReadableConcept` check. Rejects robotic / malformed phrases.
 *
 * Rule C — noun-head juxtaposition:
 *   Trigrams (or longer expanded concepts) whose last two tokens are BOTH
 *   in NOUN_HEAD_SET are almost always noun pileups ("Firm Architect",
 *   "Builder Contractor"). Reject.
 *
 * Rule D — preposition-in-concept (defensive):
 *   If any token in the final concept is in PREPOSITION_SET, reject. Rule A
 *   makes most of these stopword-boundaries upstream, so Rule D is a safety
 *   net for edge cases that slip through expansion.
 *
 * Returns { ok: true } if the concept survives, or { ok: false, rule, reason }
 * for a single readable log line.
 */
function passesPhraseShapeGate(
  concept: string,
): { ok: true } | { ok: false; rule: "C" | "D"; reason: string } {
  const tokens = concept.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: true };

  // Rule C: noun-head juxtaposition on the final two tokens of a 3+ concept.
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1];
    const penult = tokens[tokens.length - 2];
    if (NOUN_HEAD_SET.has(last) && NOUN_HEAD_SET.has(penult)) {
      return {
        ok: false,
        rule: "C",
        reason: `noun-head juxtaposition: ${penult}, ${last}`,
      };
    }
  }

  // Rule D: any preposition inside the final concept.
  for (const t of tokens) {
    if (PREPOSITION_SET.has(t)) {
      return {
        ok: false,
        rule: "D",
        reason: `contains preposition: ${t}`,
      };
    }
  }

  return { ok: true };
}

function pullExcerptsFromIds(
  ids: string[],
  answerTexts: Record<string, string>,
  limit: number,
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const text = answerTexts[id];
    if (!text) continue;
    const firstSentence = text
      .split(/[.!?]\s/)
      .slice(0, 2)
      .join(". ")
      .slice(0, 200);
    if (firstSentence.length >= 30) {
      out.push(firstSentence.replace(/\s+/g, " ").trim() + "\u2026");
    }
  }
  return out;
}

/**
 * If a bigram-level finding is a strict substring of a trigram-level finding
 * on the same page (same tier), drop the bigram \u2014 the trigram is more
 * specific and more actionable.
 */
function dedupeOverlappingConcepts(findings: KeywordGap[]): KeywordGap[] {
  const trigrams = findings.filter((f) => f.conceptType === "trigram");
  const bigrams = findings.filter((f) => f.conceptType === "bigram");
  const survivingBigrams = bigrams.filter((b) => {
    for (const t of trigrams) {
      if (t.kind !== b.kind) continue;
      if (t.conceptNormalized.includes(b.conceptNormalized)) {
        return false; // absorbed by the more-specific trigram
      }
    }
    return true;
  });
  return [...trigrams, ...survivingBigrams];
}

// ---------------------------------------------------------------------------
// Convert findings \u2192 BeaconRecommendation (smooth concept language)
// ---------------------------------------------------------------------------

/**
 * Convert findings into user-facing recommendations with smooth concept
 * language. Raw search_queries appear in `answerContext` only (the evidence
 * expand), never in the headline or rationale.
 *
 * Positive-tier findings are NOT converted to recs here \u2014 they should be
 * stored and rendered on a different surface per the product rule
 * (Today = fix-this-now only).
 */
export function gapFindingsToRecs(
  findings: KeywordGap[],
  limit: number = 5,
): BeaconRecommendation[] {
  return findings
    .filter((f) => f.kind !== "positive") // Tier 3 skipped for Today stack
    .slice(0, limit)
    .map((f, i) => {
      const elementLabel =
        f.targetElement === "title"
          ? "title tag"
          : f.targetElement === "h1"
            ? "H1"
            : "H2";
      const displayPath = f.pagePath === "/" ? "homepage" : f.pagePath;
      const satPct = Math.round(f.evidence.saturation_rate * 100);

      const evidenceBlock = [
        f.evidence.example_queries.length > 0
          ? `Example AI search queries that contained "${f.concept}":\n${f.evidence.example_queries.map((q) => `  \u2022 "${q}"`).join("\n")}`
          : "",
        f.evidence.example_excerpts.length > 0
          ? `Excerpts from AI answers where this concept appeared:\n${f.evidence.example_excerpts.map((e) => `  \u2022 ${e}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      // Plan C (2026-04-20): declarative customer-facing copy. No imperative
      // "Position"/"Reframe"/"preserving brand voice" engineer-speak.
      const headingSnippet = f.currentHeadingText
        ? ` \u2014 "${f.currentHeadingText}"`
        : "";

      if (f.kind === "saturation_miss") {
        const rationale = [
          `AI searches mention "${f.concept}" in ${satPct}% of answers in this topic cluster (${f.evidence.observation_count} of ${f.evidence.topic_cluster_size}).`,
          `The ${elementLabel} on ${displayPath}${headingSnippet} does not cover it.`,
        ].join(" ");

        return {
          id: `rec-satmiss-${f.pagePath.replace(/[^a-z0-9]/gi, "-")}-${f.conceptType}-${i}`,
          type: "keyword_optimization" as const,
          headline: `"${f.concept}" is missing from ${displayPath}`,
          rationale,
          sourceEvidence: `${satPct}% saturation across ${f.evidence.topic_cluster_size} observations \u00b7 ${f.page_citations} page citations`,
          targetPageUrl: f.pageUrl,
          targetPagePath: f.pagePath,
          sourceChangeId: null,
          confidence: f.confidence,
          priority: 950 + Math.round(f.impactScore),
          patternId: null,
          citationOpportunity: f.page_citations,
          actionClass: `${f.targetElement}_rewrite`,
          targetPlatforms: ["chatgpt", "perplexity"],
          answerContext: evidenceBlock || null,
        };
      }

      // gap
      const ritzObsLabel =
        f.evidence.ritz_obs_count === 0
          ? "not once"
          : f.evidence.ritz_obs_count === 1
            ? "once"
            : `${f.evidence.ritz_obs_count} times`;
      const rationale = [
        `AI cites competitors ${f.evidence.competitor_obs_count}\u00d7 on queries containing "${f.concept}", your page ${ritzObsLabel}.`,
        `The ${elementLabel} on ${displayPath}${headingSnippet} does not anchor on this concept.`,
      ].join(" ");

      return {
        id: `rec-gap-${f.pagePath.replace(/[^a-z0-9]/gi, "-")}-${f.conceptType}-${i}`,
        type: "keyword_optimization" as const,
        headline: `Competitors own "${f.concept}" \u2014 ${displayPath} does not cover it`,
        rationale,
        sourceEvidence: `${f.evidence.competitor_obs_count} competitor citations vs ${f.evidence.ritz_obs_count} yours \u00b7 ${f.page_citations} page citations`,
        targetPageUrl: f.pageUrl,
        targetPagePath: f.pagePath,
        sourceChangeId: null,
        confidence: f.confidence,
        priority: 850 + Math.round(f.impactScore),
        patternId: null,
        citationOpportunity: f.page_citations,
        actionClass: `${f.targetElement}_rewrite`,
        targetPlatforms: ["chatgpt", "perplexity"],
        answerContext: evidenceBlock || null,
      };
    });
}
