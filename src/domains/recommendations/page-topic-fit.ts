/**
 * Expert-rec-engine Slice 3 (2026-06-16) — PAGE-TOPIC INTENT-FIT scorer.
 * Directive PHASE C ("generic semantic fit gate") + audit Phase E (the missing
 * intent-match metric) — closes cross-cutting BUG #1: query/page matching can
 * be wrong, and nothing scores WHY a page fits the query it's being optimized
 * for.
 *
 * This is the DETERMINISTIC baseline (token coverage + universal search-intent
 * markers). It ships value before any LLM: the directive's PHASE F LLM pass
 * SHARPENS this same contract over structured evidence later (same pattern as
 * Act 2 "Why this matters" — deterministic baseline, optional LLM enhancement).
 *
 * NO HARDCODED vertical/keyword/brand rules. The intent markers are universal
 * SEO search-intent words (buy / best / how / near me …), not vertical lists.
 * Brand terms and locale terms are PASSED IN from tenant config — never baked.
 * The directive's "iran time now → cheetah page" example is caught GENERICALLY
 * by token coverage ≈ 0, not by any special-case rule (see the test suite).
 *
 * Returns the directive's PHASE C JSON contract verbatim. PURE / deterministic
 * / no I/O / no LLM / no Supabase / no mutation.
 *
 * Pinned by tests/domains/recommendations/page-topic-fit.test.ts.
 */

import { tokenize, jaccard } from "./match-engine/similarity";
import { normalizeText } from "./match-engine/normalize-text";

export type IntentClass =
  | "informational"
  | "commercial"
  | "local"
  | "navigational"
  | "transactional"
  | "mixed";

export type PageTopicFitInput = {
  readonly page: {
    readonly title?: string | null;
    readonly h1?: string | null;
    readonly metaDescription?: string | null;
    /** Pathname only (e.g. "/persian-food/koobideh"). */
    readonly urlPath?: string | null;
    /** Optional extracted body summary / first paragraphs (snapshot). */
    readonly bodySummary?: string | null;
    /** Known Wix collection / category label, when available. */
    readonly collectionOrCategory?: string | null;
  };
  /** The primary query / cluster being optimized for. */
  readonly query: string;
  /** Other GSC queries the page ranks for (supporting topical context). */
  readonly supportingQueries?: ReadonlyArray<string>;
  /** Keyword-research intent (when SEMrush/keyword data classifies it). */
  readonly keywordIntentHint?: IntentClass | null;
  /** Tenant brand terms (navigational detection — from config, NOT baked). */
  readonly brandTerms?: ReadonlyArray<string>;
  /** Tenant locale/city terms (local detection — from config, NOT baked). */
  readonly localeTerms?: ReadonlyArray<string>;
};

export type PageTopicFit = {
  readonly pageTopic: string;
  readonly queryIntent: string;
  readonly intentClass: IntentClass;
  /** 0–100 — how well the page's topic covers the query. */
  readonly topicMatchScore: number;
  /** 0–100 — how well the page's intent matches the query's intent. */
  readonly intentMatchScore: number;
  readonly matchExplanation: string;
  readonly mismatchRisks: string[];
  /** Deterministic gate: only optimize this page for this query when BOTH
   *  topic and intent clear their floors. */
  readonly shouldUseQueryForOptimization: boolean;
};

/** Fit floors below which the query should NOT be chased on this page. */
export const TOPIC_FIT_FLOOR = 45;
export const INTENT_FIT_FLOOR = 40;

/** Generic English function words — universal, not vertical/keyword rules.
 *  Used ONLY for topic-token scoring; intent classification runs on the raw
 *  query so it can see markers like "how"/"best". */
const STOPWORDS = new Set<string>([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "was", "were", "be", "with", "your", "you", "my", "our", "their", "his",
  "her", "its", "it", "this", "that", "these", "those", "at", "by", "from",
  "as", "but", "if", "then", "so", "than", "too", "very", "can", "will",
  "just", "about", "into", "over", "under", "do", "does", "no", "not",
]);

// Universal search-intent markers (case-folded whole-word membership).
const TRANSACTIONAL = new Set<string>([
  "buy", "order", "price", "prices", "pricing", "cost", "costs", "cheap",
  "cheapest", "deal", "deals", "coupon", "sale", "booking", "book", "hire",
  "rent", "quote", "estimate", "shop", "purchase", "subscribe", "download",
]);
const COMMERCIAL = new Set<string>([
  "best", "top", "review", "reviews", "vs", "versus", "compare", "comparison",
  "alternative", "alternatives", "recommended", "rated",
]);
const INFORMATIONAL = new Set<string>([
  "how", "what", "why", "when", "where", "who", "which", "guide", "guides",
  "tutorial", "tutorials", "recipe", "recipes", "meaning", "definition",
  "examples", "ideas", "tips", "learn", "explained", "history",
]);
const LOCAL_PHRASES = [
  "near me", "near you", "nearby", "open now", "directions", "hours",
];

function norm(s: string | null | undefined): string {
  return typeof s === "string" ? normalizeText(s, { lowercase: true }) : "";
}

function contentTokens(s: string): string[] {
  return tokenize(norm(s)).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

function hasWord(tokens: Set<string>, set: Set<string>): boolean {
  for (const t of tokens) if (set.has(t)) return true;
  return false;
}

function matchesAnyTerm(normalized: string, terms: ReadonlyArray<string>): boolean {
  for (const raw of terms) {
    const term = norm(raw);
    if (term.length === 0) continue;
    const re = new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (re.test(normalized)) return true;
  }
  return false;
}

/**
 * Classify the search intent of a query (or a page's self-presentation) from
 * universal markers. Brand/locale terms are supplied by the caller (tenant
 * config). Conflicting info+buy markers → "mixed"; no marker → "mixed" (honest
 * — a bare noun phrase is ambiguous without more signal).
 */
export function classifyQueryIntent(
  text: string,
  opts: { brandTerms?: ReadonlyArray<string>; localeTerms?: ReadonlyArray<string> } = {},
): IntentClass {
  const normalized = norm(text);
  if (normalized.length === 0) return "mixed";
  const toks = new Set(tokenize(normalized));

  const isQuestion = /\?$/.test(text.trim()) || hasWord(toks, INFORMATIONAL);
  const isTransactional = hasWord(toks, TRANSACTIONAL);
  const isCommercial = hasWord(toks, COMMERCIAL);
  const isLocal =
    LOCAL_PHRASES.some((p) => normalized.includes(p)) ||
    (opts.localeTerms ? matchesAnyTerm(normalized, opts.localeTerms) : false);
  const brandTokens = opts.brandTerms
    ? matchesAnyTerm(normalized, opts.brandTerms)
    : false;
  // Navigational only when the brand DOMINATES (query is mostly the brand),
  // so "best <brand> alternative" stays commercial, not navigational.
  const brandDominant =
    brandTokens && toks.size <= 3 && !isCommercial && !isTransactional;

  // Genuinely conflicting families → mixed.
  if (isQuestion && isTransactional) return "mixed";

  if (brandDominant) return "navigational";
  if (isTransactional) return "transactional";
  if (isCommercial) return "commercial";
  if (isLocal) return "local";
  if (isQuestion) return "informational";
  return "mixed";
}

function intentMatchScore(queryIntent: IntentClass, pageIntent: IntentClass): number {
  if (queryIntent === pageIntent) return 90;
  if (queryIntent === "mixed" || pageIntent === "mixed") return 60;
  const buyFamily = new Set<IntentClass>(["commercial", "transactional"]);
  if (buyFamily.has(queryIntent) && buyFamily.has(pageIntent)) return 70;
  // Genuine intent conflict: an info query on a buy page (or vice versa).
  const isInfo = (c: IntentClass) => c === "informational";
  if ((isInfo(queryIntent) && buyFamily.has(pageIntent)) ||
      (isInfo(pageIntent) && buyFamily.has(queryIntent))) {
    return 25;
  }
  // Navigational mismatch — the query wants a specific brand this page isn't.
  if (queryIntent === "navigational" || pageIntent === "navigational") return 30;
  // Local vs non-local — partial.
  if (queryIntent === "local" || pageIntent === "local") return 50;
  return 45;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function pathToWords(urlPath: string | null | undefined): string {
  if (typeof urlPath !== "string") return "";
  return urlPath.replace(/[/_-]+/g, " ");
}

function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

/**
 * Score how well a page fits the query it is being optimized for. Pure +
 * deterministic; the LLM PHASE-F pass later sharpens the SAME contract.
 */
export function scorePageTopicFit(input: PageTopicFitInput): PageTopicFit {
  const { page } = input;
  const query = input.query.trim();

  // ── topic coverage ─────────────────────────────────────────────────
  const pageText = [
    page.title,
    page.h1,
    page.metaDescription,
    pathToWords(page.urlPath),
    page.collectionOrCategory,
    page.bodySummary,
    ...(input.supportingQueries ?? []),
  ]
    .map((s) => norm(s))
    .filter((s) => s.length > 0)
    .join(" ");
  const pageTokenSet = new Set(
    tokenize(pageText).filter((t) => !STOPWORDS.has(t) && t.length > 1),
  );
  const queryContent = contentTokens(query);
  const titleTokens = contentTokens(firstNonEmpty(page.title, page.h1));

  const coverage =
    queryContent.length === 0
      ? 0
      : queryContent.filter((t) => pageTokenSet.has(t)).length /
        queryContent.length;
  const titleJaccard = jaccard(queryContent, titleTokens);
  const topicMatchScore = Math.round(
    100 * clamp01(0.65 * coverage + 0.35 * titleJaccard),
  );

  // ── intent fit ─────────────────────────────────────────────────────
  const queryIntent = classifyQueryIntent(query, {
    brandTerms: input.brandTerms,
    localeTerms: input.localeTerms,
  });
  // The page's self-presented intent, from its own title/H1/meta.
  const pageIntentRaw = classifyQueryIntent(
    [page.title, page.h1, page.metaDescription].filter(Boolean).join(" "),
    { brandTerms: input.brandTerms, localeTerms: input.localeTerms },
  );
  // A keyword-research intent hint (when present) reconciles toward the query.
  const effectiveQueryIntent =
    input.keywordIntentHint && input.keywordIntentHint !== "mixed"
      ? input.keywordIntentHint
      : queryIntent;
  const intentScore = intentMatchScore(effectiveQueryIntent, pageIntentRaw);

  // ── risks + verdict ────────────────────────────────────────────────
  const mismatchRisks: string[] = [];
  const missingKeyTerm =
    queryContent.length > 0 &&
    !queryContent.some((t) => titleTokens.includes(t));
  if (topicMatchScore < TOPIC_FIT_FLOOR) {
    mismatchRisks.push(
      `The query “${query}” barely overlaps this page's topic — this may be the wrong page for it; consider a dedicated page instead of rewriting this one.`,
    );
  } else if (missingKeyTerm) {
    mismatchRisks.push(
      `The query's wording isn't reflected in this page's title or H1 — the page is topically related but may not be the strongest target.`,
    );
  }
  if (intentScore < INTENT_FIT_FLOOR) {
    mismatchRisks.push(
      `The query reads ${effectiveQueryIntent} but this page reads ${pageIntentRaw} — optimizing it here may not capture that demand.`,
    );
  }

  const shouldUseQueryForOptimization =
    topicMatchScore >= TOPIC_FIT_FLOOR && intentScore >= INTENT_FIT_FLOOR;

  const pageTopic = firstNonEmpty(page.title, page.h1, pathToWords(page.urlPath)) ||
    "this page";
  const queryIntentLabel = `${query} (${effectiveQueryIntent})`;
  const fitWord =
    topicMatchScore >= 70 ? "a strong" : topicMatchScore >= TOPIC_FIT_FLOOR ? "a moderate" : "a weak";
  const matchExplanation = shouldUseQueryForOptimization
    ? `“${query}” is ${fitWord} topical fit for this page (topic ${topicMatchScore}/100, intent ${intentScore}/100, ${effectiveQueryIntent}) — safe to optimize here.`
    : `“${query}” is ${fitWord} topical fit for this page (topic ${topicMatchScore}/100, intent ${intentScore}/100, ${effectiveQueryIntent}) — not a confident target; ${mismatchRisks[0] ?? "review before optimizing here."}`;

  return {
    pageTopic,
    queryIntent: queryIntentLabel,
    intentClass: effectiveQueryIntent,
    topicMatchScore,
    intentMatchScore: intentScore,
    matchExplanation,
    mismatchRisks,
    shouldUseQueryForOptimization,
  };
}
