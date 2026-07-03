/**
 * url-first (2026-07-03, BEACON_500 R12 / T0e) - "grow any website I want"
 * made real: everything the URL-first signup runs AFTER a stranger types
 * one site address.
 *
 * Orchestrates, in order and each step fail-soft:
 *   1. startColdStartCrawl  - bounded discovery, persisted frontier
 *   2. runCrawlBatch        - the FIRST bounded batch (small budget: this
 *                             runs inside the signup action's own window;
 *                             the nightly phase + Keep scanning finish it)
 *   3. day-0 baselines      - seed the tenant question library from the
 *                             crawl's question-shaped lines (plus GSC and
 *                             Profound when they already have rows), and
 *                             queue a capped Google check for the top 5
 *                             derived terms through the EXISTING DataForSEO
 *                             gauntlet (14-day cache, dry-run default,
 *                             monthly cap - never surprise spend).
 *
 * Never throws; returns a structured outcome the caller logs. All deps are
 * injectable so tests never touch the network or a store.
 */

import {
  startColdStartCrawl,
  runCrawlBatch,
  loadCrawlFrontier,
  saveCrawlFrontier,
  type CrawlFrontierDeps,
} from "@/domains/scanning/crawl-frontier";
import { seedTenantQuestionLibraryIfEmpty } from "@/domains/ai-visibility/tenant-question-library";
import { runSerpQuery } from "@/domains/serp/dataforseo-serp";
import {
  deriveQuestionSeedsFromFacts,
  deriveSerpTermsFromFacts,
  DAY0_SERP_TERM_CAP,
} from "./first-audit";

/**
 * PURE: a presentable business name from a bare domain.
 * "iranopedia.com" -> "Iranopedia"; "my-site.co.uk" -> "My Site".
 * The site-derived config name (schema/og:site_name) beats this when the
 * launch config derivation finds one; this is the honest fallback.
 */
export function deriveNameFromDomain(domain: string): string {
  const host = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  const base = host.split(".")[0] ?? "";
  if (!base) return "";
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type FirstLookOutcome = {
  crawl: {
    status: "in_progress" | "complete" | "unreachable" | "no_crawl";
    pagesRead: number;
    detail?: string;
  };
  day0: {
    questionSeeding: string | null;
    serpTerms: { term: string; status: string }[];
  };
};

export type FirstLookDeps = CrawlFrontierDeps & {
  startCrawl?: typeof startColdStartCrawl;
  runBatch?: typeof runCrawlBatch;
  loadState?: typeof loadCrawlFrontier;
  saveState?: typeof saveCrawlFrontier;
  seedQuestions?: typeof seedTenantQuestionLibraryIfEmpty;
  serpQuery?: typeof runSerpQuery;
};

/** The signup action's first-batch budget: small enough that discovery +
 *  one batch + baselines fit a single serverless window with headroom. */
export const FIRST_LOOK_BATCH_BUDGET_MS = 15_000;

/**
 * Run the bounded first look for a tenant + domain. Steps are sequenced but
 * individually fail-soft: an unreachable site still persists an honest
 * "unreachable" state; a baseline failure never hides the crawl's results.
 */
export async function runFirstLook(args: {
  tenantId: string;
  domain: string;
  /** Reset an existing frontier (the "Try again" path). */
  force?: boolean;
  deps?: FirstLookDeps;
}): Promise<FirstLookOutcome> {
  const deps = args.deps ?? {};
  const startCrawl = deps.startCrawl ?? startColdStartCrawl;
  const runBatch = deps.runBatch ?? runCrawlBatch;
  const loadState = deps.loadState ?? loadCrawlFrontier;
  const saveState = deps.saveState ?? saveCrawlFrontier;
  const seedQuestions = deps.seedQuestions ?? seedTenantQuestionLibraryIfEmpty;
  const serpQuery = deps.serpQuery ?? runSerpQuery;

  const outcome: FirstLookOutcome = {
    crawl: { status: "no_crawl", pagesRead: 0 },
    day0: { questionSeeding: null, serpTerms: [] },
  };

  // 1. Discovery -> persisted queue.
  const start = await startCrawl({
    tenantId: args.tenantId,
    domain: args.domain,
    force: args.force,
    deps,
  });
  if (start.status === "unreachable") {
    outcome.crawl = { status: "unreachable", pagesRead: 0, detail: start.detail };
    return outcome;
  }

  // 2. First bounded batch (action-sized budget).
  const batch = await runBatch({
    tenantId: args.tenantId,
    deps: { ...deps, batchBudgetMs: deps.batchBudgetMs ?? FIRST_LOOK_BATCH_BUDGET_MS },
  });
  outcome.crawl = {
    status: batch.status === "no_crawl" ? "no_crawl" : batch.status,
    pagesRead: batch.totalCrawled,
    detail: batch.detail,
  };

  // 3. Day-0 baselines, from whatever the first batch read. Fail-soft each.
  const state = await loadState(args.tenantId);
  if (!state || state.page_facts.length === 0) return outcome;

  try {
    const crawlSeeds = deriveQuestionSeedsFromFacts(state.page_facts);
    const seeded = await seedQuestions(args.tenantId, {
      loadCrawl: async () => crawlSeeds,
    });
    outcome.day0.questionSeeding = seeded.status;
  } catch (e) {
    outcome.day0.questionSeeding = `error:${e instanceof Error ? e.message.slice(0, 80) : "?"}`;
  }

  try {
    const terms = deriveSerpTermsFromFacts(state.page_facts, DAY0_SERP_TERM_CAP);
    for (const term of terms) {
      try {
        const r = await serpQuery(term);
        outcome.day0.serpTerms.push({ term, status: r.status });
      } catch (e) {
        outcome.day0.serpTerms.push({
          term,
          status: `error:${e instanceof Error ? e.message.slice(0, 60) : "?"}`,
        });
      }
    }
  } catch {
    // Term derivation is pure; a throw here is unexpected but must not
    // block the signup. The scorecard just shows zero queued checks.
  }

  // Persist the day-0 receipts onto the frontier state so /onboard/done can
  // show them honestly (re-read first: the batch above already advanced it).
  try {
    const fresh = await loadState(args.tenantId);
    if (fresh) {
      await saveState({
        ...fresh,
        day0: {
          question_seeding: outcome.day0.questionSeeding,
          serp_terms: outcome.day0.serpTerms,
        },
      });
    }
  } catch {
    // Receipt write is best-effort; the seeds/checks themselves landed.
  }

  return outcome;
}
