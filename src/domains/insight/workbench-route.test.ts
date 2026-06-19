import { describe, expect, it } from "vitest";
import {
  decodeWorkbenchPath,
  encodeWorkbenchPath,
  normalizeWorkbenchPath,
  workbenchHref,
} from "./workbench-route";

describe("normalizeWorkbenchPath", () => {
  it("forces a leading slash + strips trailing slash", () => {
    expect(normalizeWorkbenchPath("cities")).toBe("/cities");
    expect(normalizeWorkbenchPath("/cities/")).toBe("/cities");
    expect(normalizeWorkbenchPath("/cities")).toBe("/cities");
  });
  it("strips scheme + host from a full URL", () => {
    expect(normalizeWorkbenchPath("https://www.iranopedia.com/cities/")).toBe("/cities");
    expect(
      normalizeWorkbenchPath("https://www.iranopedia.com/iran-flags/iran-islamic-republic-flag-history"),
    ).toBe("/iran-flags/iran-islamic-republic-flag-history");
  });
  it("drops query + fragment", () => {
    expect(normalizeWorkbenchPath("/farsi-numbers?utm=x#top")).toBe("/farsi-numbers");
  });
  it("keeps root as /", () => {
    expect(normalizeWorkbenchPath("/")).toBe("/");
    expect(normalizeWorkbenchPath("https://x.com/")).toBe("/");
  });
  it("returns null for empty / non-string", () => {
    expect(normalizeWorkbenchPath("")).toBeNull();
    expect(normalizeWorkbenchPath("   ")).toBeNull();
    expect(normalizeWorkbenchPath(null)).toBeNull();
    expect(normalizeWorkbenchPath(undefined)).toBeNull();
  });
});

describe("encode/decode round-trip", () => {
  const paths = [
    "/cities",
    "/farsi-numbers",
    "/iran-flags/iran-islamic-republic-flag-history",
    "/funny-farsi-phrases",
    "/",
    "/a/b/c-d-e",
  ];
  it("round-trips every path through encode → decode", () => {
    for (const p of paths) {
      expect(decodeWorkbenchPath(encodeWorkbenchPath(p))).toBe(p);
    }
  });
  it("encodes into a single URL-safe segment (no raw slashes)", () => {
    const seg = encodeWorkbenchPath("/iran-flags/iran-islamic-republic-flag-history");
    expect(seg.includes("/")).toBe(false);
    expect(seg).toBe("%2Firan-flags%2Firan-islamic-republic-flag-history");
  });
  it("survives Next's double-encoding (decodes iteratively)", () => {
    const once = encodeWorkbenchPath("/cities"); // %2Fcities
    const twice = encodeURIComponent(once); // %252Fcities
    expect(decodeWorkbenchPath(twice)).toBe("/cities");
  });
  it("normalizes a full-URL param back to the path key", () => {
    expect(decodeWorkbenchPath(encodeURIComponent("https://www.iranopedia.com/cities/"))).toBe(
      "/cities",
    );
  });
  it("returns null for undecodable / empty params", () => {
    expect(decodeWorkbenchPath("")).toBeNull();
    expect(decodeWorkbenchPath(null)).toBeNull();
    expect(decodeWorkbenchPath(42)).toBeNull();
  });
});

describe("workbenchHref", () => {
  it("builds /workbench/<encoded-path>", () => {
    expect(workbenchHref("/cities")).toBe("/workbench/%2Fcities");
    expect(workbenchHref("/iran-flags/iran-islamic-republic-flag-history")).toBe(
      "/workbench/%2Firan-flags%2Firan-islamic-republic-flag-history",
    );
  });
  it("href decodes back to the original path", () => {
    const href = workbenchHref("/farsi-numbers");
    const seg = href.replace("/workbench/", "");
    expect(decodeWorkbenchPath(seg)).toBe("/farsi-numbers");
  });
});
