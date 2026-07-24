/**
 * first-audit (2026-07-03, BEACON_500 R12 / T0e) - the day-0 scorecard.
 *
 * PURE composition over the crawl-frontier's compact per-page facts:
 *   - what the first look found (pages read, missing titles/descriptions,
 *     thin pages, question headings),
 *   - the FIRST recommended change: the strongest deterministic trigger the
 *     scanned data alone supports (no connectors, no LLM, no paid call),
 *   - the question seeds + Google-check terms the day-0 baselines use.
 *
 * Every sentence is Beacon voice: first person, concrete numbers, a next
 * step, no lab words, no em or en dashes. No I/O in this module - the
 * /onboard/done page and the url-first orchestration inject the state.
 */

import type { CrawlFrontierState, CrawlPageFact } from "@/domains/evidence/scanning/crawl-frontier";
import { crawlProgressLine } from "@/domains/evidence/scanning/crawl-frontier";

/** Pages under this many words read as thin for a first-look verdict. */
export const THIN_PAGE_WORDS = 120;

/** Strip a trailing site-name suffix ("Best Kebab | Iranopedia" -> "Best
 *  Kebab"). Separators handled: pipe, hyphen-with-spaces, en/em dash (as
 *  unicode escapes, never literal), double colon. */
export function stripSiteSuffix(title: string): string {
  return title.split(/\s*(?:\||\u2013|\u2014|::|\s-\s)\s*/)[0]!.trim();
}

// ---------------------------------------------------------------------------
// First recommended change (deterministic, crawl-evidence only)
// ---------------------------------------------------------------------------

export type FirstWin = {
  /** Short action label, e.g. "Write a page description". */
  action: string;
  url: string;
  /** Why this page, with the concrete number that argues it. */
  plainWhy: string;
  /** Exactly what to do next. */
  exactFix: string;
};

function label(f: CrawlPageFact): string {
  if (f.path === "/") return "your homepage";
  const t = (f.title?.trim() || f.h1?.trim() || "").trim();
  return t ? `"${stripSiteSuffix(t)}"` : f.path;
}

/**
 * Pick the ONE strongest deterministic first change from the crawl facts.
 * Priority order (each later tier only fires when the earlier is clean):
 *   1. A real page with no title at all (invisible on Google).
 *   2. The homepage missing its search description.
 *   3. The biggest page missing a search description.
 *   4. A thin page (under THIN_PAGE_WORDS words) that has a real title.
 *   5. No H1 on the biggest page.
 * Returns null only when the crawl found nothing actionable.
 */
export function pickFirstWin(facts: readonly CrawlPageFact[]): FirstWin | null {
  if (facts.length === 0) return null;
  const byWords = [...facts].sort((a, b) => b.word_count - a.word_count);

  const noTitle = byWords.find((f) => !f.title?.trim() && f.word_count >= 40);
  if (noTitle) {
    return {
      action: "Write a title",
      url: noTitle.url,
      plainWhy: `The page at ${noTitle.path} has ${noTitle.word_count} words of content but no title, so Google has nothing to show for it in results.`,
      exactFix: "Give this page a title that says what it answers in plain words. That is the single highest-leverage line on the page.",
    };
  }

  const home = facts.find((f) => f.path === "/");
  if (home && !home.has_meta_description) {
    return {
      action: "Add a search description",
      url: home.url,
      plainWhy: "Your homepage has no search description, so Google writes its own snippet for your most-seen page.",
      exactFix: "Add a one-sentence description of who you help and what you do. I will check how the snippet changes after it goes live.",
    };
  }

  const noMeta = byWords.find((f) => !f.has_meta_description && f.word_count >= 40);
  if (noMeta) {
    return {
      action: "Add a search description",
      url: noMeta.url,
      plainWhy: `${label(noMeta)} is one of your biggest pages (${noMeta.word_count} words) and has no search description, so its Google snippet is left to chance.`,
      exactFix: "Add a one-sentence description that answers the page's main question. Pages with a real description usually win a cleaner snippet.",
    };
  }

  const thin = byWords
    .filter((f) => f.word_count > 0 && f.word_count < THIN_PAGE_WORDS && Boolean(f.title?.trim()))
    .sort((a, b) => a.word_count - b.word_count)[0];
  if (thin) {
    return {
      action: "Add real content",
      url: thin.url,
      plainWhy: `${label(thin)} has only ${thin.word_count} words. Pages this thin almost never get picked by Google or AI assistants.`,
      exactFix: "Answer the page's main question in the first two sentences, then add the details a visitor would ask next.",
    };
  }

  const noH1 = byWords.find((f) => !f.h1?.trim() && f.word_count >= 40);
  if (noH1) {
    return {
      action: "Add a headline",
      url: noH1.url,
      plainWhy: `${label(noH1)} has no main headline, so readers and search engines have to guess what it is about.`,
      exactFix: "Add one clear headline at the top that states the page's topic.",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scorecard composition
// ---------------------------------------------------------------------------

export type FirstAuditScorecard = {
  status: CrawlFrontierState["status"];
  domain: string;
  pagesRead: number;
  /** Honest "about N" total: what is read plus what is queued, capped. */
  estimatedTotal: number;
  missingTitle: number;
  missingDescription: number;
  thinPages: number;
  questionsFound: number;
  /** The honest crawl progress sentence. */
  progressLine: string;
  firstWin: FirstWin | null;
  /** Terms queued for the day-0 Google check (may be empty). */
  serpTerms: string[];
  /** True when the question library got its day-0 seeds. */
  seededQuestions: boolean;
  /** Honest unreachable detail, when status is "unreachable". */
  detail?: string;
};

export function composeFirstAuditScorecard(state: CrawlFrontierState): FirstAuditScorecard {
  const facts = state.page_facts;
  const missingTitle = facts.filter((f) => !f.title?.trim()).length;
  const missingDescription = facts.filter((f) => !f.has_meta_description).length;
  const thinPages = facts.filter(
    (f) => f.word_count > 0 && f.word_count < THIN_PAGE_WORDS,
  ).length;
  const questionsFound = facts.reduce((n, f) => n + f.questions.length, 0);
  return {
    status: state.status,
    domain: state.domain,
    pagesRead: state.pages_crawled,
    estimatedTotal: Math.max(
      Math.min(state.visited.length + state.frontier.length, state.page_cap),
      state.pages_crawled,
    ),
    missingTitle,
    missingDescription,
    thinPages,
    questionsFound,
    progressLine: crawlProgressLine(state),
    firstWin: pickFirstWin(facts),
    serpTerms: state.day0.serp_terms.map((t) => t.term),
    seededQuestions: state.day0.question_seeding === "seeded",
    detail: state.detail,
  };
}
