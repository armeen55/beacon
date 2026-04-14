/**
 * Tests for competitor sitemap crawler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { crawlCompetitorSitemap, crawlAllCompetitors } from "./sitemap-crawler";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function xmlResponse(body: string, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(body),
  });
}

const SIMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page-1</loc>
    <lastmod>2024-01-15</lastmod>
  </url>
  <url>
    <loc>https://example.com/page-2</loc>
  </url>
</urlset>`;

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-pages.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-posts.xml</loc>
  </sitemap>
</sitemapindex>`;

const SUB_SITEMAP_1 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://example.com/page-a</loc><lastmod>2024-02-01</lastmod></url>
</urlset>`;

const SUB_SITEMAP_2 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://example.com/post-1</loc></url>
  <url><loc>https://example.com/post-2</loc></url>
</urlset>`;

describe("crawlCompetitorSitemap", () => {
  it("parses a standard sitemap", async () => {
    mockFetch.mockReturnValue(xmlResponse(SIMPLE_SITEMAP));

    const result = await crawlCompetitorSitemap("example.com", "Example");

    expect(result.domain).toBe("example.com");
    expect(result.displayName).toBe("Example");
    expect(result.pageCount).toBe(2);
    expect(result.error).toBeNull();
    expect(result.entries[0]).toEqual({
      loc: "https://example.com/page-1",
      lastmod: "2024-01-15",
    });
    expect(result.entries[1]).toEqual({
      loc: "https://example.com/page-2",
      lastmod: null,
    });
  });

  it("handles sitemap index files", async () => {
    mockFetch
      .mockReturnValueOnce(xmlResponse(SITEMAP_INDEX))
      .mockReturnValueOnce(xmlResponse(SUB_SITEMAP_1))
      .mockReturnValueOnce(xmlResponse(SUB_SITEMAP_2));

    const result = await crawlCompetitorSitemap("example.com", "Example");

    expect(result.pageCount).toBe(3);
    expect(result.entries).toHaveLength(3);
    expect(result.error).toBeNull();
    // Fetches: main sitemap + 2 sub-sitemaps
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("returns error when sitemap fetch fails", async () => {
    mockFetch.mockReturnValue(xmlResponse("Not found", false, 404));

    const result = await crawlCompetitorSitemap("bad.com", "Bad");

    expect(result.error).toContain("HTTP 404");
    expect(result.pageCount).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("handles network errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await crawlCompetitorSitemap("down.com", "Down");

    expect(result.error).toContain("Failed to fetch");
    expect(result.pageCount).toBe(0);
  });

  it("handles sub-sitemap failures in index", async () => {
    mockFetch
      .mockReturnValueOnce(xmlResponse(SITEMAP_INDEX))
      .mockReturnValueOnce(xmlResponse(SUB_SITEMAP_1))
      .mockReturnValueOnce(xmlResponse("error", false, 500));

    const result = await crawlCompetitorSitemap("example.com", "Example");

    // Only gets entries from the successful sub-sitemap
    expect(result.pageCount).toBe(1);
    expect(result.error).toBeNull();
  });

  it("caps sub-sitemaps at 10", async () => {
    const index = `<sitemapindex>${Array.from(
      { length: 15 },
      (_, i) => `<sitemap><loc>https://example.com/sitemap-${i}.xml</loc></sitemap>`
    ).join("")}</sitemapindex>`;

    mockFetch.mockReturnValue(xmlResponse(`<urlset><url><loc>https://example.com/p</loc></url></urlset>`));
    mockFetch.mockReturnValueOnce(xmlResponse(index));

    const result = await crawlCompetitorSitemap("example.com", "Example");

    // 1 for main + 10 for sub-sitemaps (capped)
    expect(mockFetch).toHaveBeenCalledTimes(11);
  });

  it("sets crawledAt timestamp", async () => {
    mockFetch.mockReturnValue(xmlResponse(SIMPLE_SITEMAP));

    const before = new Date().toISOString();
    const result = await crawlCompetitorSitemap("example.com", "Example");
    const after = new Date().toISOString();

    expect(result.crawledAt >= before).toBe(true);
    expect(result.crawledAt <= after).toBe(true);
  });
});

describe("crawlAllCompetitors", () => {
  it("crawls multiple competitors sequentially", async () => {
    mockFetch.mockReturnValue(xmlResponse(SIMPLE_SITEMAP));

    const results = await crawlAllCompetitors([
      { domain: "a.com", displayName: "A" },
      { domain: "b.com", displayName: "B" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].domain).toBe("a.com");
    expect(results[1].domain).toBe("b.com");
  });

  it("returns empty array for no competitors", async () => {
    const results = await crawlAllCompetitors([]);
    expect(results).toEqual([]);
  });
});
