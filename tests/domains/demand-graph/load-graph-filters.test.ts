import { describe, it, expect } from "vitest";
import { isPlatformNoiseHost, isJunkTopicLabel, cleanTopicLabel } from "@/domains/demand-graph/load-graph";

describe("create-page hygiene filters (slice 5)", () => {
  it("isPlatformNoiseHost catches marketplace/UGC/social incl. subdomains + cctlds", () => {
    for (const h of ["etsy.com", "ru.pinterest.com", "reddit.com", "facebook.com", "www.tripadvisor.com", "quora.com", "amazon.co.uk"]) {
      expect(isPlatformNoiseHost(h)).toBe(true);
    }
    for (const h of ["theknot.com", "history.com", "surfiran.com", "en.wikipedia.org"]) {
      expect(isPlatformNoiseHost(h)).toBe(false); // real content competitors survive
    }
  });

  it("isJunkTopicLabel drops bare CMS paths + geo/id slugs, keeps real topics under a section prefix", () => {
    // bare CMS path (nothing real after stripping prefixes) + geo/id slugs + EBSCO slug
    for (const l of ["shop product", "category", "tag page", "attractions g293998 activities iran", "research starters ethnic cultural studies persian"]) {
      expect(isJunkTopicLabel(l)).toBe(true);
    }
    // real topics survive — incl. ones whose URL leaked a /news/ or /blogs/ section prefix
    for (const l of ["persian wedding", "nowruz persian new year", "iranian diaspora", "iran world cup jersey 2026", "news about persia", "blogs news nowruz activities kids"]) {
      expect(isJunkTopicLabel(l)).toBe(false);
    }
  });

  it("cleanTopicLabel strips leaked CMS-section prefixes for display", () => {
    expect(cleanTopicLabel("news persian new year")).toBe("persian new year");
    expect(cleanTopicLabel("blogs news nowruz activities kids")).toBe("nowruz activities kids");
    expect(cleanTopicLabel("persian wedding")).toBe("persian wedding"); // no-op when clean
  });
});
