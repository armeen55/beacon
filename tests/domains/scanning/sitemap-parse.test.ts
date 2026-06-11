/**
 * 2026-06-10 — sitemap parsing (P0 wall 2: multi-tenant scan fleet).
 * Pins: flat <urlset> parsing (Ritz shape), <sitemapindex> child
 * extraction (Wix/Iranopedia shape), the child cap, and dedupe.
 */

import { describe, it, expect } from "vitest";

import {
  parseSitemapUrlEntries,
  parseSitemapIndexLocs,
  dedupeSitemapEntries,
  MAX_CHILD_SITEMAPS,
} from "@/domains/scanning/sitemap-parse";

const FLAT_URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://ritzbuilders.com/</loc><lastmod>2026-05-21T14:17:28.457Z</lastmod></url>
<url><loc>https://ritzbuilders.com/available-homes/</loc></url>
</urlset>`;

const WIX_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
<sitemap><loc>https://www.iranopedia.com/store-products-sitemap.xml</loc><lastmod>2026-02-28</lastmod></sitemap>
<sitemap><loc>https://www.iranopedia.com/pages-sitemap.xml</loc></sitemap>
</sitemapindex>`;

describe("parseSitemapUrlEntries — flat urlset (Ritz shape)", () => {
  it("extracts loc + optional lastmod, stripping trailing slashes", () => {
    const entries = parseSitemapUrlEntries(FLAT_URLSET);
    expect(entries).toEqual([
      { url: "https://ritzbuilders.com", lastmod: "2026-05-21T14:17:28.457Z" },
      { url: "https://ritzbuilders.com/available-homes", lastmod: null },
    ]);
  });

  it("returns [] for a sitemap index (no <url> blocks)", () => {
    expect(parseSitemapUrlEntries(WIX_INDEX)).toEqual([]);
  });

  it("returns [] for garbage", () => {
    expect(parseSitemapUrlEntries("not xml at all")).toEqual([]);
  });
});

describe("parseSitemapIndexLocs — sitemap index (Wix shape)", () => {
  it("extracts child sitemap locs in document order", () => {
    expect(parseSitemapIndexLocs(WIX_INDEX)).toEqual([
      "https://www.iranopedia.com/store-products-sitemap.xml",
      "https://www.iranopedia.com/pages-sitemap.xml",
    ]);
  });

  it("returns [] for a flat urlset (not an index)", () => {
    expect(parseSitemapIndexLocs(FLAT_URLSET)).toEqual([]);
  });

  it("caps at MAX_CHILD_SITEMAPS children", () => {
    const blocks = Array.from(
      { length: MAX_CHILD_SITEMAPS + 10 },
      (_, i) => `<sitemap><loc>https://x.com/s-${i}.xml</loc></sitemap>`,
    ).join("\n");
    const xml = `<sitemapindex>${blocks}</sitemapindex>`;
    expect(parseSitemapIndexLocs(xml)).toHaveLength(MAX_CHILD_SITEMAPS);
  });
});

describe("dedupeSitemapEntries", () => {
  it("dedupes case-insensitively, keeping the first occurrence", () => {
    const out = dedupeSitemapEntries([
      { url: "https://a.com/x", lastmod: "2026-01-01" },
      { url: "https://A.com/X", lastmod: null },
      { url: "https://a.com/y", lastmod: null },
    ]);
    expect(out).toEqual([
      { url: "https://a.com/x", lastmod: "2026-01-01" },
      { url: "https://a.com/y", lastmod: null },
    ]);
  });
});
