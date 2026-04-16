/**
 * Brand alias resolver tests.
 *
 * Validates fuzziness safeguards: "Ritz" does NOT match "Ritz Carlton",
 * short aliases require word boundaries, domain matching normalizes
 * protocol/www/trailing slashes.
 */

import { describe, it, expect } from "vitest";
import {
  generateAliases,
  isMentioned,
  findMention,
  isOwnedUrl,
  findOwnedCitations,
} from "@/domains/prompts/brand-resolver";

describe("generateAliases", () => {
  it("generates aliases for Ritz Builders", () => {
    const aliases = generateAliases({
      businessName: "Ritz Builders",
      domain: "ritzbuilders.com",
      slug: "ritz-builders",
    });
    expect(aliases).toContain("Ritz Builders");
    expect(aliases).toContain("ritzbuilders");
    expect(aliases).toContain("ritz-builders");
    // "Ritz" alone should NOT be an alias (it's only 4 chars and
    // would match "Ritz Carlton"). The suffix-strip produces "Ritz"
    // which is still >= 3 chars, so it IS included but the mention
    // detection adds word-boundary protection.
  });

  it("strips legal suffixes", () => {
    const aliases = generateAliases({
      businessName: "Asha Construction LLC",
      domain: "ashaconstruction.com",
    });
    expect(aliases).toContain("Asha Construction LLC");
    expect(aliases).toContain("Asha Construction");
    expect(aliases).toContain("ashaconstruction");
  });

  it("sorts aliases longest first", () => {
    const aliases = generateAliases({
      businessName: "Modern Bay Area Homes LLC",
      domain: "modernbahomes.com",
    });
    for (let i = 1; i < aliases.length; i++) {
      expect(aliases[i - 1].length).toBeGreaterThanOrEqual(
        aliases[i].length,
      );
    }
  });
});

describe("isMentioned / findMention", () => {
  const ritzAliases = generateAliases({
    businessName: "Ritz Builders",
    domain: "ritzbuilders.com",
  });

  it("finds exact brand name in text", () => {
    expect(
      isMentioned(
        "I recommend Ritz Builders for your project",
        ritzAliases,
      ),
    ).toBe(true);
  });

  it("finds domain-base in text", () => {
    expect(
      isMentioned("Check out ritzbuilders for Bay Area homes", ritzAliases),
    ).toBe(true);
  });

  it("does NOT match 'Ritz Carlton' as 'Ritz Builders'", () => {
    // "Ritz" appears in "Ritz Carlton" but is embedded in a longer brand
    expect(
      isMentioned("The Ritz Carlton hotel is nearby", ritzAliases),
    ).toBe(false);
  });

  it("returns null when no alias matches", () => {
    expect(
      findMention("Supple Homes is the top builder", ritzAliases),
    ).toBeNull();
  });

  it("handles case-insensitive matching", () => {
    expect(
      isMentioned("RITZ BUILDERS is great", ritzAliases),
    ).toBe(true);
  });
});

describe("isOwnedUrl", () => {
  it("matches exact domain", () => {
    expect(isOwnedUrl("https://ritzbuilders.com/about", "ritzbuilders.com")).toBe(true);
  });

  it("matches with www prefix", () => {
    expect(isOwnedUrl("https://www.ritzbuilders.com/about", "ritzbuilders.com")).toBe(true);
  });

  it("does not match a different domain", () => {
    expect(isOwnedUrl("https://supplehomes.com/", "ritzbuilders.com")).toBe(false);
  });

  it("matches subdomain", () => {
    expect(isOwnedUrl("https://blog.ritzbuilders.com/post", "ritzbuilders.com")).toBe(true);
  });
});

describe("findOwnedCitations", () => {
  it("filters to only owned URLs", () => {
    const urls = [
      "https://ritzbuilders.com/services",
      "https://supplehomes.com/",
      "https://www.ritzbuilders.com/about",
      "https://yelp.com/ritz",
    ];
    const owned = findOwnedCitations(urls, "ritzbuilders.com");
    expect(owned).toEqual([
      "https://ritzbuilders.com/services",
      "https://www.ritzbuilders.com/about",
    ]);
  });
});
