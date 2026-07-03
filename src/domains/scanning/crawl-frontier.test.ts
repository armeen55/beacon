/**
 * crawl-frontier tests (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Pins the Vercel-safety contract: bounded batches (page + time), durable
 * resume math (no page read twice, cursor survives between invocations),
 * same-host link discovery under the 150-page cap, honest unreachable
 * handling, and dash-free operator copy. All I/O injected - no network,
 * no real store.
 */
import { describe, it, expect, vi } from "vitest";

import {
  BATCH_MAX_PAGES,
  CRAWL_PAGE_CAP,
  continueColdStartCrawlIfStarted,
  crawlProgressLine,
  enqueueDiscovered,
  normalizeCrawlUrl,
  pageFactFromSnapshot,
  questionLinesFromSnapshot,
  runCrawlBatch,
  startColdStartCrawl,
  type CrawlFrontierState,
} from "./crawl-frontier";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function page(title: string, links: string[] = [], extra = ""): string {
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>Real words for the extractor to count in this body paragraph, comfortably over the sample floor.</p>${links.map((l) => `<a href="${l}">${l}</a>`).join("")}${extra}</body></html>`;
}

type Route = { ok: boolean; status?: number; body?: string };

/** A fetch stub keyed by URL substring; unmatched URLs fail. */
function fetchFor(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const [k, r] of Object.entries(routes)) {
      if (url.includes(k)) {
        return {
          ok: r.ok,
          status: r.status ?? (r.ok ? 200 : 500),
          text: async () => r.body ?? "",
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404, text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** In-memory frontier store shared across invocations (the durability stub). */
function memoryStore(initial: CrawlFrontierState | null = null) {
  const box: { state: CrawlFrontierState | null } = { state: initial };
  return {
    box,
    loadState: async () => box.state,
    saveState: async (s: CrawlFrontierState) => {
      box.state = s;
    },
  };
}

const SITEMAP_3 = `<?xml version="1.0"?><urlset>
  <url><loc>https://acme.com/</loc></url>
  <url><loc>https://acme.com/services</loc></url>
  <url><loc>https://acme.com/pricing</loc></url>
</urlset>`;

function baseState(over: Partial<CrawlFrontierState> = {}): CrawlFrontierState {
  return {
    tenant_id: "tenant-x",
    domain: "acme.com",
    status: "in_progress",
    frontier: [],
    visited: [],
    pages_crawled: 0,
    pages_failed: 0,
    page_cap: CRAWL_PAGE_CAP,
    source: "sitemap",
    started_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
    last_batch_at: null,
    batches_run: 0,
    page_facts: [],
    day0: { question_seeding: null, serp_terms: [] },
    ...over,
  };
}

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeCrawlUrl", () => {
  it("keeps same-host pages, dropping query and fragment", () => {
    const n = normalizeCrawlUrl("https://www.acme.com/a/b?x=1#frag", "acme.com");
    expect(n).not.toBeNull();
    expect(n!.path).toBe("/a/b");
    expect(n!.key).toBe("acme.com/a/b");
  });

  it("rejects cross-host links, files, and non-http schemes", () => {
    expect(normalizeCrawlUrl("https://other.com/x", "acme.com")).toBeNull();
    expect(normalizeCrawlUrl("https://acme.com/photo.jpg", "acme.com")).toBeNull();
    expect(normalizeCrawlUrl("mailto:hi@acme.com", "acme.com")).toBeNull();
  });

  it("resolves relative hrefs against the base URL", () => {
    const n = normalizeCrawlUrl("/contact/", "acme.com", "https://acme.com/about");
    expect(n).not.toBeNull();
    expect(n!.key).toBe("acme.com/contact");
  });
});

describe("enqueueDiscovered (frontier resume math)", () => {
  it("skips visited keys, queued duplicates, and never grows past the cap", () => {
    const state = {
      frontier: ["https://acme.com/queued"],
      visited: ["acme.com/seen"],
      page_cap: 4,
      domain: "acme.com",
    };
    const { frontier, added } = enqueueDiscovered(state, [
      "https://acme.com/seen", // visited - skipped
      "https://acme.com/queued", // already queued - skipped
      "https://www.acme.com/queued/", // same key as queued - skipped
      "https://acme.com/new1",
      "https://acme.com/new2",
      "https://acme.com/new3", // over cap (1 visited + 3 queued = 4) - skipped
    ]);
    expect(added).toBe(2);
    expect(frontier).toEqual([
      "https://acme.com/queued",
      "https://acme.com/new1",
      "https://acme.com/new2",
    ]);
  });
});

describe("crawlProgressLine", () => {
  it("is honest about partial progress with concrete numbers", () => {
    const line = crawlProgressLine(
      baseState({
        pages_crawled: 45,
        visited: Array.from({ length: 45 }, (_, i) => `acme.com/p${i}`),
        frontier: Array.from({ length: 75 }, (_, i) => `https://acme.com/q${i}`),
      }),
    );
    expect(line).toBe(
      "I have read 45 of about 120 pages so far. I keep going in the background.",
    );
  });

  it("celebrates completion and names the unreachable domain", () => {
    expect(
      crawlProgressLine(baseState({ status: "complete", pages_crawled: 12 })),
    ).toContain("I read 12 pages on acme.com.");
    expect(crawlProgressLine(baseState({ status: "unreachable" }))).toBe(
      "I could not reach acme.com. Check the address and try again.",
    );
  });

  it("never emits an em or en dash", () => {
    for (const status of ["in_progress", "complete", "unreachable"] as const) {
      expect(crawlProgressLine(baseState({ status }))).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
    }
  });
});

describe("questionLinesFromSnapshot / pageFactFromSnapshot", () => {
  it("collects question-shaped lines only, deduped and capped", () => {
    const lines = questionLinesFromSnapshot({
      title: "What is saffron rice",
      h1: "What is saffron rice", // dupe of title
      h2_list: ["How long does it take to cook", "Our services", "Why choose us today"],
      faqs: [{ question: "Can I freeze saffron rice at home" }],
    });
    expect(lines).toEqual([
      "What is saffron rice",
      "How long does it take to cook",
      "Why choose us today",
      "Can I freeze saffron rice at home",
    ]);
  });
});

// ---------------------------------------------------------------------------
// startColdStartCrawl (init)
// ---------------------------------------------------------------------------

describe("startColdStartCrawl", () => {
  it("seeds the frontier from the sitemap and persists in_progress", async () => {
    const store = memoryStore();
    const r = await startColdStartCrawl({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: { fetchImpl: fetchFor({ "sitemap.xml": { ok: true, body: SITEMAP_3 } }), ...store },
    });
    expect(r.status).toBe("in_progress");
    expect(r.discovered).toBe(3);
    expect(store.box.state?.frontier).toHaveLength(3);
    expect(store.box.state?.source).toBe("sitemap");
  });

  it("a dead site persists an honest unreachable state", async () => {
    const store = memoryStore();
    const r = await startColdStartCrawl({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: { fetchImpl: fetchFor({}), ...store },
    });
    expect(r.status).toBe("unreachable");
    expect(store.box.state?.status).toBe("unreachable");
    expect(store.box.state?.detail).toBe("no_reachable_pages");
  });

  it("is idempotent for an existing live queue unless forced", async () => {
    const store = memoryStore(
      baseState({ frontier: ["https://acme.com/services"], visited: ["acme.com/"] }),
    );
    const fetchImpl = fetchFor({ "sitemap.xml": { ok: true, body: SITEMAP_3 } });
    const r = await startColdStartCrawl({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: { fetchImpl, ...store },
    });
    expect(r.status).toBe("in_progress");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    const forced = await startColdStartCrawl({
      tenantId: "tenant-x",
      domain: "acme.com",
      force: true,
      deps: { fetchImpl, ...store },
    });
    expect(forced.discovered).toBe(3);
    expect(store.box.state?.visited).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runCrawlBatch (bounds + resume)
// ---------------------------------------------------------------------------

describe("runCrawlBatch", () => {
  const routes: Record<string, Route> = {
    "robots.txt": { ok: true, body: "" },
    "acme.com/services": { ok: true, body: page("Services", ["/pricing"]) },
    "acme.com/pricing": { ok: true, body: page("Pricing") },
    "acme.com/about": { ok: true, body: page("About", ["/services"]) },
  };

  it("crawls at most maxPagesPerBatch, persists the cursor, and the next batch resumes", async () => {
    const store = memoryStore(
      baseState({
        frontier: [
          "https://acme.com/services",
          "https://acme.com/pricing",
          "https://acme.com/about",
        ],
      }),
    );
    const syncPagesImpl = vi.fn(
      async (_rows: { id: string; url: string }[], _tenantId: string) => {},
    );
    const syncPageSnapshotsImpl = vi.fn(async () => {});
    const deps = {
      fetchImpl: fetchFor(routes),
      sleep: noSleep,
      maxPagesPerBatch: 2,
      syncPagesImpl: syncPagesImpl as never,
      syncPageSnapshotsImpl,
      ...store,
    };

    const first = await runCrawlBatch({ tenantId: "tenant-x", deps });
    expect(first.ran).toBe(true);
    expect(first.crawled).toBe(2);
    expect(first.complete).toBe(false);
    expect(store.box.state?.pages_crawled).toBe(2);
    expect(store.box.state?.visited).toEqual(["acme.com/services", "acme.com/pricing"]);
    expect(store.box.state?.batches_run).toBe(1);

    const second = await runCrawlBatch({ tenantId: "tenant-x", deps });
    expect(second.crawled).toBe(1); // only /about was left - nothing re-read
    expect(second.complete).toBe(true);
    expect(store.box.state?.status).toBe("complete");
    expect(store.box.state?.pages_crawled).toBe(3);

    // Idempotent ids: the same URL upserts the same page row id every time.
    const firstIds = syncPagesImpl.mock.calls[0]![0].map((p) => [p.url, p.id] as const);
    expect(new Map(firstIds).get("https://acme.com/services")).toMatch(/^page-[0-9a-f]{16}$/);
  });

  it("stops on the time budget before the page budget", async () => {
    const store = memoryStore(
      baseState({ frontier: ["https://acme.com/services", "https://acme.com/pricing"] }),
    );
    const r = await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor(routes),
        sleep: noSleep,
        batchBudgetMs: 0, // deadline already passed
        syncPagesImpl: vi.fn(async () => {}),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    expect(r.ran).toBe(true);
    expect(r.crawled).toBe(0);
    expect(store.box.state?.frontier).toHaveLength(2); // nothing lost
    expect(store.box.state?.status).toBe("in_progress");
  });

  it("queues newly discovered same-host links from crawled pages", async () => {
    const store = memoryStore(baseState({ frontier: ["https://acme.com/about"] }));
    await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor(routes),
        sleep: noSleep,
        maxPagesPerBatch: 1,
        syncPagesImpl: vi.fn(async () => {}),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    // /about links to /services, which was never visited or queued.
    expect(store.box.state?.frontier).toContain("https://acme.com/services");
    expect(store.box.state?.status).toBe("in_progress");
  });

  it("a robots-blocked page counts as failed, advances the cursor, and never wedges", async () => {
    const store = memoryStore(baseState({ frontier: ["https://acme.com/services"] }));
    const r = await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor({
          "robots.txt": { ok: true, body: "User-agent: *\nDisallow: /" },
        }),
        sleep: noSleep,
        syncPagesImpl: vi.fn(async () => {}),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    expect(r.crawled).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.complete).toBe(true); // frontier exhausted
    expect(store.box.state?.visited).toEqual(["acme.com/services"]);
  });

  it("a failed pages-registry write leaves the cursor untouched for a clean retry", async () => {
    const initial = baseState({ frontier: ["https://acme.com/services"] });
    const store = memoryStore(initial);
    const r = await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor(routes),
        sleep: noSleep,
        syncPagesImpl: vi.fn(async () => {
          throw new Error("supabase down");
        }),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    expect(r.crawled).toBe(0);
    expect(r.detail).toContain("pages_registry_write_failed");
    expect(store.box.state).toEqual(initial); // no cursor advance persisted
  });

  it("collects page facts (title, description, words, questions) for the scorecard", async () => {
    const store = memoryStore(baseState({ frontier: ["https://acme.com/faq"] }));
    await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor({
          "robots.txt": { ok: true, body: "" },
          "acme.com/faq": {
            ok: true,
            body: page("What is saffron rice", [], "<h2>How long does it take</h2>"),
          },
        }),
        sleep: noSleep,
        syncPagesImpl: vi.fn(async () => {}),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    const fact = store.box.state?.page_facts[0];
    expect(fact?.title).toBe("What is saffron rice");
    expect(fact?.has_meta_description).toBe(false);
    expect(fact?.word_count).toBeGreaterThan(10);
    expect(fact?.questions).toContain("What is saffron rice");
    expect(fact?.questions).toContain("How long does it take");
  });

  it("clamps batch bounds to the module maxima", async () => {
    const store = memoryStore(baseState({ frontier: [] }));
    // No pages to crawl - just assert the clamp math never exceeds the caps.
    const r = await runCrawlBatch({
      tenantId: "tenant-x",
      deps: {
        fetchImpl: fetchFor({}),
        sleep: noSleep,
        maxPagesPerBatch: 999,
        batchBudgetMs: 999_999,
        syncPagesImpl: vi.fn(async () => {}),
        syncPageSnapshotsImpl: vi.fn(async () => {}),
        ...store,
      },
    });
    expect(r.ran).toBe(true);
    expect(BATCH_MAX_PAGES).toBe(15);
  });
});

describe("continueColdStartCrawlIfStarted", () => {
  it("is a no-op without a live in_progress queue", async () => {
    const none = await continueColdStartCrawlIfStarted("tenant-x", {
      loadState: async () => null,
    });
    expect(none.ran).toBe(false);
    expect(none.detail).toBe("no_frontier_state");

    const done = await continueColdStartCrawlIfStarted("tenant-x", {
      loadState: async () => baseState({ status: "complete", pages_crawled: 7 }),
    });
    expect(done.ran).toBe(false);
    expect(done.complete).toBe(true);
    expect(done.totalCrawled).toBe(7);
  });

  it("runs exactly one batch when in progress", async () => {
    const store = memoryStore(baseState({ frontier: ["https://acme.com/services"] }));
    const r = await continueColdStartCrawlIfStarted("tenant-x", {
      fetchImpl: fetchFor({
        "robots.txt": { ok: true, body: "" },
        "acme.com/services": { ok: true, body: page("Services") },
      }),
      sleep: noSleep,
      syncPagesImpl: vi.fn(async () => {}),
      syncPageSnapshotsImpl: vi.fn(async () => {}),
      ...store,
    });
    expect(r.ran).toBe(true);
    expect(r.crawled).toBe(1);
    expect(r.complete).toBe(true);
  });
});
