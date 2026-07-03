import { describe, it, expect } from "vitest";
import {
  auditPageAltText,
  buildTenantAltInventory,
} from "./alt-audit";
import type { PageImage } from "@/domains/pages/types";

function img(alt: string | null, src = "https://x.com/p.jpg"): PageImage {
  return { src, alt, width: null, height: null };
}

describe("auditPageAltText - per-page coverage math", () => {
  it("counts missing (null alt), covered (text), and decorative (empty) separately", () => {
    const audit = auditPageAltText({
      url: "https://x.com/food",
      images: [img(null), img(""), img("A cat"), img(null)],
      impressions90d: 500,
    });
    expect(audit.totalImages).toBe(4);
    expect(audit.missingAlt).toBe(2);
    expect(audit.coveredAlt).toBe(1);
    expect(audit.decorativeAlt).toBe(1);
    expect(audit.missingImages).toHaveLength(2);
    expect(audit.impressions90d).toBe(500);
  });

  it("never counts an EMPTY alt (decorative) as missing", () => {
    const audit = auditPageAltText({
      url: "https://x.com/deco",
      images: [img(""), img(""), img("")],
      impressions90d: 0,
    });
    expect(audit.missingAlt).toBe(0);
    expect(audit.decorativeAlt).toBe(3);
  });

  it("treats whitespace-only alt as covered? no - whitespace-only is NOT covered", () => {
    // alt="   " has content per the tag but is not a real description; the
    // covered check requires a non-empty TRIMMED string, so this is neither
    // covered nor missing-attribute; it is a present-but-empty (decorative-ish)
    // case that must not inflate coverage.
    const audit = auditPageAltText({
      url: "https://x.com/ws",
      images: [img("   ")],
      impressions90d: 100,
    });
    expect(audit.coveredAlt).toBe(0);
    expect(audit.missingAlt).toBe(0); // alt attribute present, so not a "no alt" gap
  });

  it("is empty-safe when the page has undefined images (old snapshot)", () => {
    const audit = auditPageAltText({
      url: "https://x.com/old",
      images: undefined,
      impressions90d: 999,
    });
    expect(audit.totalImages).toBe(0);
    expect(audit.missingAlt).toBe(0);
    expect(audit.missingImages).toEqual([]);
  });

  it("is empty-safe when the page has an empty images array", () => {
    const audit = auditPageAltText({
      url: "https://x.com/empty",
      images: [],
      impressions90d: 100,
    });
    expect(audit.totalImages).toBe(0);
    expect(audit.missingAlt).toBe(0);
  });
});

describe("buildTenantAltInventory - rollup + demand prioritization", () => {
  const impressions: Record<string, number> = {
    "https://x.com/high": 5000,
    "https://x.com/mid": 500,
    "https://x.com/low": 10,
    "https://x.com/noimg": 9999,
  };
  const impressionsFor = (u: string) => impressions[u] ?? 0;

  it("sums the tenant-wide inventory and headline counts", () => {
    const inv = buildTenantAltInventory({
      snapshots: [
        { url: "https://x.com/high", images: [img(null), img("ok"), img(null)] },
        { url: "https://x.com/mid", images: [img("ok"), img("")] },
        { url: "https://x.com/low", images: [img(null)] },
        { url: "https://x.com/noimg", images: undefined },
      ],
      impressionsFor,
    });
    // 3 pages carried images; /noimg is excluded (no pictures captured).
    expect(inv.pagesWithImages).toBe(3);
    expect(inv.totalImages).toBe(6);
    expect(inv.missingAlt).toBe(3);
    expect(inv.coveredAlt).toBe(2);
    expect(inv.decorativeAlt).toBe(1);
    expect(inv.pagesWithMissingAlt).toBe(2); // /high and /low
  });

  it("orders pages by demand (highest impressions first)", () => {
    const inv = buildTenantAltInventory({
      snapshots: [
        { url: "https://x.com/low", images: [img(null)] },
        { url: "https://x.com/high", images: [img(null)] },
        { url: "https://x.com/mid", images: [img(null)] },
      ],
      impressionsFor,
    });
    expect(inv.pages.map((p) => p.url)).toEqual([
      "https://x.com/high",
      "https://x.com/mid",
      "https://x.com/low",
    ]);
  });

  it("is empty-safe with zero snapshots", () => {
    const inv = buildTenantAltInventory({ snapshots: [], impressionsFor });
    expect(inv).toEqual({
      pagesWithImages: 0,
      totalImages: 0,
      coveredAlt: 0,
      decorativeAlt: 0,
      missingAlt: 0,
      pagesWithMissingAlt: 0,
      pages: [],
    });
  });

  it("is empty-safe when every page has all alt present", () => {
    const inv = buildTenantAltInventory({
      snapshots: [
        { url: "https://x.com/high", images: [img("a"), img("b")] },
        { url: "https://x.com/mid", images: [img("c")] },
      ],
      impressionsFor,
    });
    expect(inv.missingAlt).toBe(0);
    expect(inv.pagesWithMissingAlt).toBe(0);
    expect(inv.pagesWithImages).toBe(2);
  });
});
