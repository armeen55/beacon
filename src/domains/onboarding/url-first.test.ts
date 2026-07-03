/**
 * url-first tests (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Pins the signup orchestration: name derivation, the ordered fail-soft
 * pipeline (discovery -> one bounded batch -> day-0 baselines), the
 * unreachable early-out, and that the day-0 Google checks only ever ride
 * the injected gauntlet (a throwing check never breaks the signup).
 */
import { describe, it, expect, vi } from "vitest";

import { deriveNameFromDomain, runFirstLook, FIRST_LOOK_BATCH_BUDGET_MS } from "./url-first";
import type { CrawlFrontierState } from "@/domains/scanning/crawl-frontier";
import type { SerpRunResult } from "@/domains/serp/dataforseo-serp";

function stateWithFacts(): CrawlFrontierState {
  return {
    tenant_id: "tenant-x",
    domain: "acme.com",
    status: "in_progress",
    frontier: ["https://acme.com/next"],
    visited: ["acme.com/", "acme.com/guide"],
    pages_crawled: 2,
    pages_failed: 0,
    page_cap: 150,
    source: "sitemap",
    started_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
    last_batch_at: "2026-07-03T00:00:00.000Z",
    batches_run: 1,
    page_facts: [
      {
        url: "https://acme.com/guide",
        path: "/guide",
        title: "What is saffron rice | Acme",
        h1: "What is saffron rice",
        has_meta_description: false,
        word_count: 700,
        faq_count: 0,
        questions: ["What is saffron rice"],
      },
    ],
    day0: { question_seeding: null, serp_terms: [] },
  };
}

describe("deriveNameFromDomain", () => {
  it("title-cases the domain base, splitting hyphens and underscores", () => {
    expect(deriveNameFromDomain("iranopedia.com")).toBe("Iranopedia");
    expect(deriveNameFromDomain("www.my-site.co.uk")).toBe("My Site");
    expect(deriveNameFromDomain("ritz_builders.com")).toBe("Ritz Builders");
    expect(deriveNameFromDomain("")).toBe("");
  });
});

describe("runFirstLook", () => {
  it("runs discovery, one small-budget batch, then day-0 baselines, and persists the receipts", async () => {
    const store = { state: stateWithFacts() };
    const startCrawl = vi.fn(async () => ({ status: "in_progress" as const, discovered: 3 }));
    const runBatch = vi.fn(async (args: { deps?: { batchBudgetMs?: number } }) => {
      expect(args.deps?.batchBudgetMs).toBe(FIRST_LOOK_BATCH_BUDGET_MS);
      return {
        ran: true,
        status: "in_progress" as const,
        crawled: 2,
        failed: 0,
        totalCrawled: 2,
        remaining: 1,
        complete: false,
      };
    });
    const seedQuestions = vi.fn(
      async (_tenantId: string, deps?: { loadCrawl?: (tenantId: string) => Promise<unknown[]> }) => {
        const crawlSeeds = (await deps?.loadCrawl?.(_tenantId)) ?? [];
        expect(crawlSeeds).toEqual([
          { text: "What is saffron rice", topic: null, source: "crawl" },
        ]);
        return { status: "seeded" as const, existingCount: 0, inserted: 1, detail: "" };
      },
    );
    const serpQuery = vi.fn(
      async (): Promise<SerpRunResult> => ({
        status: "dry_run",
        plan: {} as SerpRunResult["plan"],
        snapshot: null,
        costUsd: 0,
        detail: "dry-run",
      }),
    );
    const saveState = vi.fn(async (s: CrawlFrontierState) => {
      store.state = s;
    });

    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: {
        startCrawl,
        runBatch,
        loadState: async () => store.state,
        saveState,
        seedQuestions: seedQuestions as never,
        serpQuery,
      },
    });

    expect(startCrawl).toHaveBeenCalledOnce();
    expect(runBatch).toHaveBeenCalledOnce();
    expect(outcome.crawl).toEqual({ status: "in_progress", pagesRead: 2, detail: undefined });
    expect(outcome.day0.questionSeeding).toBe("seeded");
    expect(outcome.day0.serpTerms).toEqual([{ term: "what is saffron rice", status: "dry_run" }]);
    // Receipts persisted onto the frontier state for /onboard/done.
    expect(store.state.day0).toEqual({
      question_seeding: "seeded",
      serp_terms: [{ term: "what is saffron rice", status: "dry_run" }],
    });
  });

  it("an unreachable site returns early: no batch, no baselines", async () => {
    const runBatch = vi.fn();
    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "dead.example",
      deps: {
        startCrawl: async () => ({
          status: "unreachable" as const,
          discovered: 0,
          detail: "no_reachable_pages",
        }),
        runBatch: runBatch as never,
        loadState: async () => null,
      },
    });
    expect(outcome.crawl.status).toBe("unreachable");
    expect(outcome.crawl.detail).toBe("no_reachable_pages");
    expect(runBatch).not.toHaveBeenCalled();
    expect(outcome.day0.questionSeeding).toBeNull();
  });

  it("baseline failures are fail-soft: a throwing gauntlet or seeder never breaks the signup", async () => {
    const store = { state: stateWithFacts() };
    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: {
        startCrawl: async () => ({ status: "in_progress" as const, discovered: 3 }),
        runBatch: async () => ({
          ran: true,
          status: "in_progress" as const,
          crawled: 1,
          failed: 0,
          totalCrawled: 1,
          remaining: 0,
          complete: false,
        }),
        loadState: async () => store.state,
        saveState: async (s) => {
          store.state = s;
        },
        seedQuestions: async () => {
          throw new Error("tracked_prompts table missing");
        },
        serpQuery: async () => {
          throw new Error("dataforseo exploded");
        },
      },
    });
    expect(outcome.crawl.pagesRead).toBe(1);
    expect(outcome.day0.questionSeeding).toContain("error:");
    expect(outcome.day0.serpTerms[0]?.status).toContain("error:");
  });

  it("skips baselines entirely when the first batch read nothing", async () => {
    const seedQuestions = vi.fn();
    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: {
        startCrawl: async () => ({ status: "in_progress" as const, discovered: 1 }),
        runBatch: async () => ({
          ran: true,
          status: "in_progress" as const,
          crawled: 0,
          failed: 1,
          totalCrawled: 0,
          remaining: 0,
          complete: false,
        }),
        loadState: async () => ({ ...stateWithFacts(), page_facts: [] }),
        seedQuestions: seedQuestions as never,
      },
    });
    expect(seedQuestions).not.toHaveBeenCalled();
    expect(outcome.day0.questionSeeding).toBeNull();
  });
});
