/**
 * ask/router (BEACON_500 item 59) - the pure question classifier for /ask. Takes the
 * operator's raw question and decides which FACT CLASS answers it (page-specific,
 * site-trend, ai-visibility, measurement, competitor, or plan), plus extracts a page
 * path when one is named. No I/O, no LLM - deterministic keyword/pattern matching only,
 * so the classification is instant, free, and fully testable.
 *
 * The class picks BOTH which fact-assembly loader runs (fact-assembly.ts) AND which
 * teammate answers (speaker mapping below, mirrors src/domains/team/identity.ts).
 * A wrong class still gets an honest answer from real facts - this is a routing hint,
 * not a hard gate, so no question is ever refused outright.
 */

import type { TeammateKey } from "@/domains/team/identity";

export type AskQuestionClass =
  | "page_specific"
  | "page_ranking"
  | "site_trend"
  | "ai_visibility"
  | "measurement"
  | "competitor"
  | "plan"
  | "keyword_next"
  | "system_health";

/** For page_ranking: which per-page metric to rank by. "money" = GA4 conversions/value
 *  (falls back to engaged visitors, honestly, when no conversions/revenue exist);
 *  "traffic" = GSC clicks. */
export type RankingMetric = "money" | "traffic";

export type RoutedQuestion = {
  questionClass: AskQuestionClass;
  /** Normalized page path extracted from the question, e.g. "/cheetah", or null when
   *  no page is named. Only set for page_specific (or when a path is named alongside
   *  another class, e.g. "did the cheetah page's AI citations change"). */
  pagePath: string | null;
  /** Set only for page_ranking: the metric the operator is ranking pages by. */
  rankingMetric?: RankingMetric;
  /** The teammate (see team/identity.ts) whose first-person voice answers this class. */
  speaker: TeammateKey;
};

/** Class -> default speaker. Mirrors the specialist who owns that surface elsewhere in
 *  the product (gsc owns clicks/trend, profound owns AI citations, dataforseo owns live
 *  Google results/competitors, proof owns measurement, llm/strategist owns plan+synthesis). */
const SPEAKER_BY_CLASS: Record<AskQuestionClass, TeammateKey> = {
  page_specific: "gsc",
  page_ranking: "gsc",
  site_trend: "gsc",
  ai_visibility: "profound",
  measurement: "proof",
  competitor: "dataforseo",
  plan: "llm",
  keyword_next: "dataforseo",
  system_health: "llm",
};

/** Extract a page path from free text: an explicit "/slug" token, or a bare word right
 *  after "the X page"/"on X". Returns a normalized leading-slash path, or null. */
export function extractPagePath(question: string): string | null {
  // Explicit path token, e.g. "/cheetah" or "/cities/tehran".
  const explicit = question.match(/(?<![\w/])\/[a-z0-9][a-z0-9/-]*/i);
  if (explicit) return normalizeExtractedPath(explicit[0]);

  // "the <slug> page" / "<slug> page's" - a bare topic word named as a page.
  const namedPage = question.match(/\bthe\s+([a-z0-9-]+)\s+page\b/i) ?? question.match(/\b([a-z0-9-]+)\s+page'?s\b/i);
  if (namedPage) return normalizeExtractedPath(`/${namedPage[1]}`);

  // "on <slug>" (e.g. "clicks drop on cheetah") when slug looks like a real slug (has a
  // hyphen or is a single lowercase word longer than 2 chars, not a common stop word).
  const onSlug = question.match(/\bon\s+(?:the\s+)?([a-z][a-z0-9-]{2,})\b/i);
  if (onSlug && !STOP_AFTER_ON.has(onSlug[1].toLowerCase())) {
    return normalizeExtractedPath(`/${onSlug[1]}`);
  }

  return null;
}

const STOP_AFTER_ON = new Set([
  "google", "average", "top", "this", "that", "site", "the", "our", "my", "them", "it",
  "homepage", "chatgpt", "perplexity", "gemini", "copilot",
]);

function normalizeExtractedPath(raw: string): string {
  const lower = raw.toLowerCase().replace(/[.,!?;:'")\]]+$/, "");
  const withSlash = lower.startsWith("/") ? lower : `/${lower}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

// ── class detection (ordered rules; first match wins) ───────────────────────────────

// Explicit forward-looking intent ("planning to", "going to") is checked BEFORE the
// measurement patterns below, so "what are we planning to ship tonight" reads as a plan
// question even though it contains "ship" - the intent phrase is the stronger, more
// specific signal. Past-tense/completed-action phrasing with no such intent phrase
// (e.g. "what did we ship this week") falls through to MEASUREMENT_PATTERNS instead.
const PLAN_INTENT_PATTERNS = /\b(plan(ning)? to|going to (ship|do|change|fix)|will (we|you|it))\b/i;
const MEASUREMENT_PATTERNS = /\b(did it work|work(ed)?|verdict|measur\w*|proof|result|ship(ped)?|what did we do|what did .*(batch|change|edit)s? do|last (batch|change)|win rate|\bwon\b|\blost\b|before.?and.?after|lift|impact of)\b/i;
const AI_VISIBILITY_PATTERNS = /\b(chatgpt|perplexity|gemini|claude|copilot|ai (answer|citation|visib|mention|overview)|answer box|cited|citation|mentioned by ai|ai search|\bllm\b)\b/i;
const COMPETITOR_PATTERNS = /\b(competitor|which (competitor|rival)|rival|vs\.?\s|compare[sd]? to|ranking (above|below|higher|lower)|outrank(ing)?|recommend(s|ed)? instead of me|instead of (me|us)|who does ai recommend)\b/i;
// "which keyword"/"what keyword" wins over the generic PLAN_PATTERNS "what should" so a
// keyword-specific ask never gets the generic plan answer instead of the real keyword library.
const KEYWORD_PATTERNS = /\b(which |what )?keyword\w* (should|to|next|worth|chase|target)|keyword should i (chase|target|go after)\b/i;
// "is anything broken" / "is everything working" - system-health questions about the
// pipeline itself (crons, publish path), never about page traffic.
const SYSTEM_HEALTH_PATTERNS = /\b(anything broken|is everything (ok|okay|working|fine|running)|system (health|status|ok)|is (the )?(site|pipeline|connector\w*) (broken|down|working)|are (my )?(crons?|connectors?) (running|working|healthy)|pipeline (health|status))\b/i;
const PLAN_PATTERNS = /\b(what should|what are we doing|todo|to.?do|coming up|next (move|step|change)|why (is|isn'?t) .*(plan|planned|selected|included))\b/i;
const SITE_TREND_PATTERNS = /\b(site.?wide|overall|across the site|this month|this week|total clicks|traffic (drop|dip|spike|jump)|algorithm|core update|google update)\b/i;
// "which/what page makes the most money", "my best page for traffic", "which page is
// bleeding clicks" - a RANKING across pages by a metric (distinct from a single named
// page). Requires a page word AND a superlative/ranking cue, so "what page should I build"
// (a plan question) does not match. The money-metric cue picks GA4 value; otherwise GSC clicks.
const PAGE_WORD_RE = /\bpages?\b/i;
const RANKING_CUE_RE = /\b(most|best|worst|top|biggest|highest|lowest|least|bleeding|losing|winning|leading|makes? (me )?(the )?most|driv\w*)\b/i;
const MONEY_METRIC_RE = /\b(money|revenue|sales|profit|leads?|conversions?|convert\w*|value|worth|earn\w*|\$)\b/i;

/**
 * Classify a raw operator question. Deterministic, pure, instant. Order matters: a
 * question can match multiple patterns (e.g. "why did AI citations drop on /cheetah
 * this week" has a page AND a trend cue) - page-specific wins whenever a real page path
 * is named, because "what happened on THIS page" is the most specific, most answerable
 * class. Among the non-page classes, checks run most-specific first: explicit
 * forward-looking intent ("planning to", "going to") wins outright (plan); then a named
 * AI platform or "answer box"/"cited" (ai_visibility) even when the question also says
 * "beating me"; then a named competitor/outrank/"instead of me" cue (competitor); then a
 * keyword-specific ask (keyword_next); then a system/pipeline-health cue (system_health,
 * checked before measurement so "is anything broken" never reads as a shipped-change
 * question); then completed-action language (measurement); then remaining
 * forward-looking phrasing including "why isn't X in the plan" (plan); site_trend is the
 * generic catch-all.
 */
export function routeQuestion(rawQuestion: string): RoutedQuestion {
  const question = (rawQuestion ?? "").trim();
  const pagePath = extractPagePath(question);

  let questionClass: AskQuestionClass;
  let rankingMetric: RankingMetric | undefined;
  const isPageRanking = !pagePath && PAGE_WORD_RE.test(question) && RANKING_CUE_RE.test(question);
  if (pagePath) {
    questionClass = "page_specific";
  } else if (isPageRanking) {
    questionClass = "page_ranking";
    rankingMetric = MONEY_METRIC_RE.test(question) ? "money" : "traffic";
  } else if (PLAN_INTENT_PATTERNS.test(question)) {
    questionClass = "plan";
  } else if (AI_VISIBILITY_PATTERNS.test(question)) {
    questionClass = "ai_visibility";
  } else if (COMPETITOR_PATTERNS.test(question)) {
    questionClass = "competitor";
  } else if (KEYWORD_PATTERNS.test(question)) {
    questionClass = "keyword_next";
  } else if (SYSTEM_HEALTH_PATTERNS.test(question)) {
    questionClass = "system_health";
  } else if (MEASUREMENT_PATTERNS.test(question)) {
    questionClass = "measurement";
  } else if (PLAN_PATTERNS.test(question)) {
    questionClass = "plan";
  } else if (SITE_TREND_PATTERNS.test(question)) {
    questionClass = "site_trend";
  } else {
    // Honest default: with no page named and no stronger cue, treat it as a
    // sitewide trend question (clicks are the most universally answerable fact).
    questionClass = "site_trend";
  }

  return { questionClass, pagePath, rankingMetric, speaker: SPEAKER_BY_CLASS[questionClass] };
}

// ── deterministic question shapes (W9 slice 1, 2026-07-09) ──────────────────────────

// A "how many" question wants a number, not synthesis; a "list" question wants an
// enumeration, not synthesis. Neither needs the LLM to compose anything beyond what
// the grounded facts already say in plain English.
const COUNT_SHAPE_PATTERNS = /\bhow many\b/i;
const LIST_SHAPE_PATTERNS = /\blist\b/i;

/**
 * True when a question's shape is answerable directly from provider facts with ZERO
 * LLM calls - a deterministic count, rank, or list, never a request to explain or
 * synthesize. Locked operator decision (2026-07-09): these bypass the LLM outright,
 * not just as a budget/failure fallback (composeAskAnswer in composer.ts is the only
 * caller). page_ranking is ALWAYS a rank shape by construction (fact-assembly.ts's
 * assemblePageRankingFacts already returns a sorted top-N list); site_trend answers
 * with plain sitewide totals, itself a count. Any other class still short-circuits
 * when the raw text itself asks for a count or a list (e.g. "how many changes did we
 * ship" under the measurement class).
 */
export function isDeterministicQuestionShape(question: string, questionClass: AskQuestionClass): boolean {
  if (questionClass === "page_ranking") return true;
  if (questionClass === "site_trend") return true;
  return COUNT_SHAPE_PATTERNS.test(question) || LIST_SHAPE_PATTERNS.test(question);
}
