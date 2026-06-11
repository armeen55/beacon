/**
 * fetch-site-profile — North-star onboarding (2026-06-11).
 *
 * Pins: stranger-typed URL normalization, homepage-fatal vs
 * secondary-soft failure, nav-discovered about/contact candidates with
 * conventional fallbacks, the ≤3-page cap, and that fetches stay on the
 * injectable fetchImpl (no real network in tests).
 */

import { describe, it, expect, vi } from "vitest";

import {
  normalizeSiteUrl,
  pickSecondaryPaths,
  fetchSiteProfilePages,
} from "./fetch-site-profile";

function fakeFetch(routes: Record<string, { status?: number; body?: string }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body ?? "", { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
}

describe("normalizeSiteUrl — what a stranger actually types", () => {
  it("bare domain → https homepage", () => {
    expect(normalizeSiteUrl("acme.com")).toEqual({
      homepageUrl: "https://acme.com/",
      domain: "acme.com",
    });
  });
  it("www + deep path → homepage, www stripped from domain", () => {
    expect(normalizeSiteUrl("https://www.acme.com/services/roofing")).toEqual({
      homepageUrl: "https://www.acme.com/",
      domain: "acme.com",
    });
  });
  it("garbage → null", () => {
    expect(normalizeSiteUrl("not a url")).toBeNull();
    expect(normalizeSiteUrl("x")).toBeNull();
  });
});

describe("pickSecondaryPaths", () => {
  it("prefers nav-discovered about/contact paths over conventions", () => {
    const html = `<nav><a href="/our-story/about-us/">About</a><a href="/contact-us">Contact</a><a href="/services">Services</a></nav>`;
    expect(pickSecondaryPaths(html)).toEqual([
      "/our-story/about-us",
      "/contact-us",
    ]);
  });
  it("falls back to conventional /about + /contact when nav has none", () => {
    expect(pickSecondaryPaths(`<nav><a href="/services">Services</a></nav>`)).toEqual([
      "/about",
      "/contact",
    ]);
  });
  it("ignores external and protocol links", () => {
    const html = `<a href="https://other.com/about">x</a><a href="mailto:a@b.c">y</a>`;
    expect(pickSecondaryPaths(html)).toEqual(["/about", "/contact"]);
  });
});

describe("fetchSiteProfilePages", () => {
  it("homepage + nav-discovered secondaries, homepage FIRST, ≤3 pages", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": { status: 404 },
      "https://acme.com/": {
        body: `<nav><a href="/about-acme">About</a><a href="/contact">Contact</a></nav>`,
      },
      "https://acme.com/about-acme": { body: "<h1>About</h1>" },
      "https://acme.com/contact": { body: "<h1>Contact</h1>" },
    });
    const result = await fetchSiteProfilePages("acme.com", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe("acme.com");
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/about-acme",
      "https://acme.com/contact",
    ]);
  });

  it("homepage unreachable is FATAL", async () => {
    const fetchImpl = fakeFetch({
      "https://dead.com/robots.txt": { status: 404 },
      "https://dead.com/": { status: 500 },
    });
    const result = await fetchSiteProfilePages("dead.com", { fetchImpl });
    expect(result).toEqual({
      ok: false,
      reason: "homepage_unreachable",
      detail: "http_500",
    });
  });

  it("a failing secondary page is silently skipped (homepage is enough)", async () => {
    const fetchImpl = fakeFetch({
      "https://solo.com/robots.txt": { status: 404 },
      "https://solo.com/": { body: "<h1>Solo</h1>" },
      // /about + /contact → 404 from the fallback router
    });
    const result = await fetchSiteProfilePages("solo.com", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(1);
  });

  it("invalid input never fetches", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchSiteProfilePages("???", { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "invalid_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("robots-blocked homepage reports honestly", async () => {
    const fetchImpl = fakeFetch({
      "https://walled.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://walled.com/": { body: "<h1>never fetched</h1>" },
    });
    const result = await fetchSiteProfilePages("walled.com", { fetchImpl });
    expect(result).toEqual({
      ok: false,
      reason: "homepage_unreachable",
      detail: "robots_blocked",
    });
  });
});

describe("fetchSiteProfilePages — maxPages cap (business-step prefill)", () => {
  it("maxPages: 1 fetches ONLY the homepage (fast form submit)", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": { status: 404 },
      "https://acme.com/": {
        body: `<nav><a href="/about">About</a><a href="/contact">Contact</a></nav>`,
      },
      "https://acme.com/about": { body: "never fetched" },
    });
    const result = await fetchSiteProfilePages("acme.com", {
      fetchImpl,
      maxPages: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(1);
    // robots + homepage only — the about/contact candidates were never hit.
    expect(
      (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (c) => String(c[0]),
      ),
    ).toEqual(["https://acme.com/robots.txt", "https://acme.com/"]);
  });
});
