import { describe, it, expect } from "vitest";
import { extractPageSeoSignals } from "./extract-page-seo";

describe("extractPageSeoSignals", () => {
  it("extracts title + meta description", () => {
    const s = extractPageSeoSignals(`<html><head><title>Blue Rug</title><meta name="description" content="A nice rug"></head></html>`);
    expect(s.title).toBe("Blue Rug");
    expect(s.metaDescription).toBe("A nice rug");
  });

  it("detects Product JSON-LD (incl. @graph + array @type)", () => {
    const s = extractPageSeoSignals(`<script type="application/ld+json">{"@context":"x","@graph":[{"@type":["Thing","Product"],"name":"Rug"}]}</script>`);
    expect(s.hasProductSchema).toBe(true);
    expect(s.hasArticleSchema).toBe(false);
  });

  it("detects Article JSON-LD", () => {
    const s = extractPageSeoSignals(`<script type="application/ld+json">{"@type":"BlogPosting","headline":"Nowruz"}</script>`);
    expect(s.hasArticleSchema).toBe(true);
    expect(s.hasProductSchema).toBe(false);
  });

  it("falls back to og:description and tolerates malformed JSON-LD", () => {
    const s = extractPageSeoSignals(`<meta property="og:description" content="og desc"><script type="application/ld+json">{ broken "@type":"Product" }</script>`);
    expect(s.metaDescription).toBe("og desc");
    expect(s.hasProductSchema).toBe(true); // tolerant text scan
  });

  it("returns all-empty on junk / empty input (fail-closed)", () => {
    expect(extractPageSeoSignals("")).toEqual({ title: null, metaDescription: null, hasProductSchema: false, hasArticleSchema: false });
    const s = extractPageSeoSignals("<html><body><p>hi</p></body></html>");
    expect(s.title).toBeNull();
    expect(s.hasProductSchema).toBe(false);
  });
});
