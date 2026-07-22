/**
 * FIRST-RUN ONBOARDING CHAIN (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/onboarding/fetch-site-profile.test.ts
 *   src/domains/onboarding/launch-config.test.ts
 *   src/domains/onboarding/url-first.test.ts
 *   src/domains/onboarding/first-audit.test.ts
 *   src/domains/onboarding/first-reading-state.test.ts
 * Pins kept: robots-respecting bounded fetches, typed-beats-derived config,
 * failure-soft launch (an active tenant never runs on the placeholder), the
 * day-0 first-win ladder, first-reading trigger exactness (Ritz regression
 * guard), customer-safe phrasing on every surface string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: vi.fn(async () => {}),
  syncTenantBusinessConfig: vi.fn(async () => {}),
}));

import {
  normalizeSiteUrl,
  pickSecondaryPaths,
  fetchSiteProfilePages,
} from "@/domains/onboarding/fetch-site-profile";
import {
  deriveAndPersistTenantConfig,
  suggestSegmentFromProfile,
} from "@/domains/onboarding/launch-config";
import { deriveNameFromDomain, runFirstLook } from "@/domains/onboarding/url-first";
import {
  composeFirstAuditScorecard,
  deriveSerpTermsFromFacts,
  pickFirstWin,
  stripSiteSuffix,
  THIN_PAGE_WORDS,
} from "@/domains/onboarding/first-audit";
import { detectFirstReadingState } from "@/domains/onboarding/first-reading-state";
import {
  getBusinessConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";
import type { CrawlFrontierState, CrawlPageFact } from "@/domains/scanning/crawl-frontier";
import type { DerivedBusinessProfile } from "@/domains/onboarding/derive-business-profile";

const TENANT = "tenant-evidence-first-run-test";
const TENANT_DIR = join(process.cwd(), ".data", "tenants", TENANT);

beforeEach(() => __resetBusinessConfigCacheForTests());
afterEach(() => {
  rmSync(TENANT_DIR, { recursive: true, force: true });
  __resetBusinessConfigCacheForTests();
});

function fakeFetch(routes: Record<string, string | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) return new Response("nf", { status: 404 });
    if (typeof route === "number") return new Response("", { status: route });
    return new Response(route, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("fetch-site-profile: bounded, robots-respecting, injectable", () => {
  it("normalizes stranger-typed URLs; garbage yields null and never fetches", async () => {
    expect(normalizeSiteUrl("acme.com")).toEqual({ homepageUrl: "https://acme.com/", domain: "acme.com" });
    expect(normalizeSiteUrl("https://www.acme.com/services/roofing")).toEqual({
      homepageUrl: "https://www.acme.com/",
      domain: "acme.com",
    });
    expect(normalizeSiteUrl("not a url")).toBeNull();

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await fetchSiteProfilePages("???", { fetchImpl })).toEqual({ ok: false, reason: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prefers nav-discovered about/contact paths over conventions", () => {
    const html = `<nav><a href="/our-story/about-us/">About</a><a href="/contact-us">Contact</a><a href="/services">Services</a></nav>`;
    expect(pickSecondaryPaths(html)).toEqual(["/our-story/about-us", "/contact-us"]);
    expect(pickSecondaryPaths(`<nav><a href="/services">Services</a></nav>`)).toEqual(["/about", "/contact"]);
  });

  it("homepage first with <=3 pages; failing secondary skipped; homepage failure FATAL; robots honored", async () => {
    const ok = await fetchSiteProfilePages("acme.com", {
      fetchImpl: fakeFetch({
        "https://acme.com/robots.txt": 404,
        "https://acme.com/": `<nav><a href="/about-acme">About</a><a href="/contact">Contact</a></nav>`,
        "https://acme.com/about-acme": "<h1>About</h1>",
        "https://acme.com/contact": "<h1>Contact</h1>",
      }),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.pages.map((p) => p.url)).toEqual([
        "https://acme.com/",
        "https://acme.com/about-acme",
        "https://acme.com/contact",
      ]);
    }

    expect(
      await fetchSiteProfilePages("dead.com", {
        fetchImpl: fakeFetch({ "https://dead.com/robots.txt": 404, "https://dead.com/": 500 }),
      }),
    ).toEqual({ ok: false, reason: "homepage_unreachable", detail: "http_500" });

    expect(
      await fetchSiteProfilePages("walled.com", {
        fetchImpl: fakeFetch({
          "https://walled.com/robots.txt": "User-agent: *\nDisallow: /",
          "https://walled.com/": "<h1>never fetched</h1>",
        }),
      }),
    ).toEqual({ ok: false, reason: "homepage_unreachable", detail: "robots_blocked" });
  });

  it("maxPages: 1 fetches ONLY robots + homepage (fast form submit)", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": 404,
      "https://acme.com/": `<nav><a href="/about">About</a></nav>`,
      "https://acme.com/about": "never fetched",
    });
    const result = await fetchSiteProfilePages("acme.com", { fetchImpl, maxPages: 1 });
    expect(result.ok).toBe(true);
    expect(
      (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])),
    ).toEqual(["https://acme.com/robots.txt", "https://acme.com/"]);
  });
});

const TUCSON_RESTAURANT_HTML = `<!doctype html><html><head>
<title>La Palma Taqueria | Tucson's Taqueria</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "La Palma Taqueria",
  "telephone": "+1-520-555-0199",
  "address": {"@type": "PostalAddress", "addressLocality": "Tucson", "addressRegion": "AZ"},
  "areaServed": ["Tucson", "Oro Valley"],
  "sameAs": ["https://www.yelp.com/biz/la-palma-tucson"]
}
</script></head><body>
<header><nav>
  <a href="/">Home</a>
  <a href="/catering">Catering</a>
  <a href="/taco-bar">Taco Bar</a>
  <a href="/about">About</a>
</nav></header>
</body></html>`;

describe("deriveAndPersistTenantConfig: URL-only acceptance", () => {
  it("persists a complete derived config for a never-seen site with ZERO cross-tenant leakage", async () => {
    const result = await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "lapalma.com",
      typedName: "La Palma Taqueria",
      typedCities: [],
      fetchImpl: fakeFetch({ "https://lapalma.com/robots.txt": 404, "https://lapalma.com/": TUCSON_RESTAURANT_HTML }),
    });
    expect(result.outcome).toBe("derived_and_saved");
    expect(existsSync(join(TENANT_DIR, "business-config.json"))).toBe(true);

    __resetBusinessConfigCacheForTests();
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.industry).toBe("restaurant");
    expect(cfg.phone).toBe("+1-520-555-0199");
    expect(cfg.services).toEqual(expect.arrayContaining(["catering", "taco bar"]));
    expect(cfg.scanSettings.enabled).toBe(true);
    expect(cfg.scanSettings.timezone).toBe("UTC");
    const flat = JSON.stringify(cfg).toLowerCase();
    for (const banned of ["palo alto", "menlo park", "atherton", "bay area", "ritz", "custom home"]) {
      expect(flat).not.toContain(banned);
    }
  });

  it("typed wizard fields BEAT derived values; unreachable site still persists typed fields", async () => {
    await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "lapalma.com",
      typedName: "La Palma Tacos & Cantina",
      typedCities: ["Marana"],
      fetchImpl: fakeFetch({ "https://lapalma.com/robots.txt": 404, "https://lapalma.com/": TUCSON_RESTAURANT_HTML }),
    });
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.name).toBe("La Palma Tacos & Cantina");
    expect(cfg.locations[0]).toBe("Marana");

    // Fresh tenant state for the unreachable-site path.
    rmSync(TENANT_DIR, { recursive: true, force: true });
    __resetBusinessConfigCacheForTests();
    const down = await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "downsite.com",
      typedName: "Down Site Co",
      typedCities: ["Reno"],
      fetchImpl: fakeFetch({ "https://downsite.com/robots.txt": 404, "https://downsite.com/": 500 }),
    });
    expect(down.outcome).toBe("typed_only_saved");
    expect(getBusinessConfig(TENANT).industry).toBe(""); // honest blank, nothing invented
  });

  it("suggestSegmentFromProfile: real presence wins, locations alone never flip local, ambiguity yields null", () => {
    const fixture = (over: Partial<DerivedBusinessProfile>): DerivedBusinessProfile => ({
      name: null, nameSource: null, description: null, industry: null, schemaTypes: [],
      phone: null, address: null, locations: [], services: [], keyPages: [],
      socialProfiles: [], contentSiteSignal: false, ...over,
    });
    expect(suggestSegmentFromProfile(fixture({ contentSiteSignal: true }))).toBe("content_publisher");
    expect(suggestSegmentFromProfile(fixture({ address: "1 Main St, Tucson, AZ" }))).toBe("local_service");
    expect(suggestSegmentFromProfile(fixture({ locations: ["ca"] }))).toBeNull();
    expect(suggestSegmentFromProfile(null)).toBeNull();
  });
});

// ── url-first + first-audit (day-0 scorecard) ───────────────────────────────

function fact(over: Partial<CrawlPageFact>): CrawlPageFact {
  return {
    url: "https://acme.com/page", path: "/page", title: "A perfectly fine page",
    h1: "A perfectly fine page", has_meta_description: true, word_count: 400,
    faq_count: 0, questions: [], ...over,
  };
}

function state(facts: CrawlPageFact[], over: Partial<CrawlFrontierState> = {}): CrawlFrontierState {
  return {
    tenant_id: "tenant-x", domain: "acme.com", status: "in_progress",
    frontier: ["https://acme.com/q1", "https://acme.com/q2"],
    visited: facts.map((f) => `acme.com${f.path}`),
    pages_crawled: facts.length, pages_failed: 0, page_cap: 150, source: "sitemap",
    started_at: "2026-07-03T00:00:00.000Z", updated_at: "2026-07-03T00:00:00.000Z",
    last_batch_at: "2026-07-03T00:00:00.000Z", batches_run: 1, page_facts: facts,
    day0: { question_seeding: null, serp_terms: [] }, ...over,
  };
}

describe("first-audit: day-0 scorecard math", () => {
  it("deriveNameFromDomain title-cases the base; stripSiteSuffix removes site tails", () => {
    expect(deriveNameFromDomain("iranopedia.com")).toBe("Iranopedia");
    expect(deriveNameFromDomain("www.my-site.co.uk")).toBe("My Site");
    expect(stripSiteSuffix("Best Kabob in LA | Acme")).toBe("Best Kabob in LA");
    expect(stripSiteSuffix("Well-known Kabob")).toBe("Well-known Kabob");
  });

  it("derives up to 5 SERP terms from the biggest non-homepage pages, deduped", () => {
    const facts = [
      fact({ path: "/", title: "Acme | Home", word_count: 900 }),
      fact({ path: "/a", title: "Persian Wedding Venues | Acme", word_count: 800 }),
      fact({ path: "/b", title: "Persian Wedding Venues | Acme", word_count: 700 }),
      fact({ path: "/c", title: null, h1: "Saffron Rice Guide", word_count: 600 }),
    ];
    expect(deriveSerpTermsFromFacts(facts)).toEqual(["persian wedding venues", "saffron rice guide"]);
  });

  it("first-win ladder: no-title beats homepage-description beats big-page-description beats thin page", () => {
    expect(
      pickFirstWin([
        fact({ path: "/big", title: null, h1: null, word_count: 500, has_meta_description: false }),
        fact({ path: "/", has_meta_description: false }),
      ])?.action,
    ).toBe("Write a title");
    expect(
      pickFirstWin([
        fact({ path: "/", url: "https://acme.com/", has_meta_description: false }),
        fact({ path: "/b", has_meta_description: false, word_count: 900 }),
      ])?.url,
    ).toBe("https://acme.com/");
    expect(
      pickFirstWin([
        fact({ path: "/" }),
        fact({ path: "/thin", title: "Contact | Acme", word_count: THIN_PAGE_WORDS - 80 }),
      ])?.action,
    ).toBe("Add real content");
    expect(pickFirstWin([fact({})])).toBeNull();

    const win = pickFirstWin([fact({ path: "/", has_meta_description: false })]);
    expect(`${win?.plainWhy} ${win?.exactFix}`).not.toMatch(/[‒–—―]/);
  });

  it("scorecard counts gaps, estimates the honest total, and reports unreachable plainly", () => {
    const card = composeFirstAuditScorecard(
      state(
        [
          fact({ path: "/", has_meta_description: false, questions: ["What is acme"] }),
          fact({ path: "/thin", word_count: 60 }),
          fact({ path: "/no-title", title: null, word_count: 20 }),
        ],
        { day0: { question_seeding: "seeded", serp_terms: [{ term: "x", status: "dry_run" }] } },
      ),
    );
    expect(card.pagesRead).toBe(3);
    expect(card.estimatedTotal).toBe(5);
    expect(card.missingTitle).toBe(1);
    expect(card.thinPages).toBe(2);
    expect(card.progressLine).toContain("I have read 3 of about 5 pages");

    const unreachable = composeFirstAuditScorecard(
      state([], { status: "unreachable", detail: "no_reachable_pages", frontier: [], visited: [] }),
    );
    expect(unreachable.progressLine).toBe("I could not reach acme.com. Check the address and try again.");
  });
});

describe("runFirstLook: fail-soft signup orchestration", () => {
  it("an unreachable site returns early: no batch, no baselines", async () => {
    const runBatch = vi.fn();
    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "dead.example",
      deps: {
        startCrawl: async () => ({ status: "unreachable" as const, discovered: 0, detail: "no_reachable_pages" }),
        runBatch: runBatch as never,
        loadState: async () => null,
      },
    });
    expect(outcome.crawl.status).toBe("unreachable");
    expect(runBatch).not.toHaveBeenCalled();
    expect(outcome.day0.questionSeeding).toBeNull();
  });

  it("a throwing gauntlet or seeder never breaks the signup (errors captured, not thrown)", async () => {
    const base: CrawlFrontierState = state([
      fact({
        url: "https://acme.com/guide", path: "/guide", title: "What is saffron rice | Acme",
        h1: "What is saffron rice", has_meta_description: false, word_count: 700,
        questions: ["What is saffron rice"],
      }),
    ]);
    const store = { state: base };
    const outcome = await runFirstLook({
      tenantId: "tenant-x",
      domain: "acme.com",
      deps: {
        startCrawl: async () => ({ status: "in_progress" as const, discovered: 3 }),
        runBatch: async () => ({
          ran: true, status: "in_progress" as const, crawled: 1, failed: 0,
          totalCrawled: 1, remaining: 0, complete: false,
        }),
        loadState: async () => store.state,
        saveState: async (s) => { store.state = s; },
        seedQuestions: async () => { throw new Error("tracked_prompts table missing"); },
        serpQuery: async () => { throw new Error("dataforseo exploded"); },
      },
    });
    expect(outcome.crawl.pagesRead).toBe(1);
    expect(outcome.day0.questionSeeding).toContain("error:");
    expect(outcome.day0.serpTerms[0]?.status).toContain("error:");
  });
});

// ── first-reading-state ─────────────────────────────────────────────────────

const ACTIVE_TENANT = {
  status: "active" as const,
  business_name: "Acme Builders",
  domain: "acmebuilders.com",
};

describe("detectFirstReadingState: trigger exactness", () => {
  it("triggers ONLY when active + prompts > 0 + zero observations", () => {
    const r = detectFirstReadingState({ tenant: ACTIVE_TENANT, activePromptCount: 5, observationCount: 0 });
    expect(r.isFirstReading).toBe(true);

    expect(
      detectFirstReadingState({
        tenant: { ...ACTIVE_TENANT, status: "pending_onboarding" },
        activePromptCount: 5,
        observationCount: 0,
      }).isFirstReading,
    ).toBe(false);
    expect(detectFirstReadingState({ tenant: null, activePromptCount: 5, observationCount: 0 }).isFirstReading).toBe(false);
    expect(detectFirstReadingState({ tenant: ACTIVE_TENANT, activePromptCount: 0, observationCount: 0 }).isFirstReading).toBe(false);
    expect(detectFirstReadingState({ tenant: ACTIVE_TENANT, activePromptCount: NaN, observationCount: 0 }).isFirstReading).toBe(false);
    expect(detectFirstReadingState({ tenant: ACTIVE_TENANT, activePromptCount: 5, observationCount: 1 }).isFirstReading).toBe(false);
  });

  it("Ritz regression guard: a mature tenant shape is always false", () => {
    expect(
      detectFirstReadingState({
        tenant: { status: "active", business_name: "Ritz Custom Builders", domain: "ritzbuilders.com" },
        activePromptCount: 25,
        observationCount: 16521,
      }).isFirstReading,
    ).toBe(false);
  });

  it("blank business_name falls back to 'your business'; customer-safe phrasing never leaks internals", () => {
    const r = detectFirstReadingState({
      tenant: { ...ACTIVE_TENANT, business_name: "  " },
      activePromptCount: 5,
      observationCount: 0,
    });
    expect(r.isFirstReading).toBe(true);
    if (r.isFirstReading) {
      expect(r.context.businessName).toBe("your business");
      const phrase = r.context.nextReadingDescription;
      for (const re of [/cron/i, /UTC/, /GitHub/i, /Supabase/i, /poll/i]) expect(phrase).not.toMatch(re);
      const json = JSON.stringify(r.context);
      expect(json).not.toMatch(/tenant_id/i);
      expect(json).not.toMatch(/account_id/i);
    }
  });

  it("carries derived profile facts when provided, omits the block when nothing derived", () => {
    const input = { tenant: ACTIVE_TENANT, activePromptCount: 5, observationCount: 0 };
    const withDerived = detectFirstReadingState(input, {
      industry: "restaurant",
      locations: ["Tucson", "Oro Valley"],
      serviceCount: 4,
      keyPageCount: 8,
    });
    expect(withDerived.isFirstReading).toBe(true);
    if (withDerived.isFirstReading) {
      expect(withDerived.context.derived?.industry).toBe("restaurant");
    }
    const without = detectFirstReadingState(input);
    if (without.isFirstReading) expect("derived" in without.context).toBe(false);
  });
});
