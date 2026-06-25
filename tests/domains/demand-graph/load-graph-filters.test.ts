import { describe, it, expect } from "vitest";
import { isPlatformNoiseHost, isJunkTopicLabel } from "@/domains/demand-graph/load-graph";

describe("create-page hygiene filters (slice 5)", () => {
  it("isPlatformNoiseHost catches marketplace/UGC/social incl. subdomains + cctlds", () => {
    for (const h of ["etsy.com", "ru.pinterest.com", "reddit.com", "facebook.com", "www.tripadvisor.com", "quora.com", "amazon.co.uk"]) {
      expect(isPlatformNoiseHost(h)).toBe(true);
    }
    for (const h of ["theknot.com", "history.com", "surfiran.com", "en.wikipedia.org"]) {
      expect(isPlatformNoiseHost(h)).toBe(false); // real content competitors survive
    }
  });

  it("isJunkTopicLabel drops URL-path fragments + geo/id slugs, keeps real topics", () => {
    for (const l of ["shop iranopedia", "product category gifts", "blogs news nowruz activities kids", "attractions g293998 activities iran", "research starters ethnic cultural studies persian"]) {
      expect(isJunkTopicLabel(l)).toBe(true);
    }
    for (const l of ["persian wedding", "nowruz persian new year", "iranian diaspora", "iran world cup jersey 2026"]) {
      expect(isJunkTopicLabel(l)).toBe(false); // real topics (incl. legit years) survive
    }
  });
});
