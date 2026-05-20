/**
 * Slice 4.5.B.α₂.2 — page-classifier unit tests.
 *
 * Tests the philosophy (the 8 page types + non-HTML asset
 * detection) over a representative URL matrix, NOT a tenant-
 * specific slug list. Every test uses generic example.com URLs +
 * Ritz-shaped urlPatterns OR no urlPatterns to exercise both the
 * configured and fallback-heuristic paths.
 */

import { describe, expect, it } from "vitest";

import type { BusinessConfig } from "@/lib/business-config";
import {
  classifyPageType,
  isNonHtmlAsset,
} from "@/domains/recommendation-intelligence/page-classifier";

function makeConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    name: "Test",
    domain: "test.com",
    industry: "home-builder",
    phone: "",
    address: "",
    yelpBusinessId: "",
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    locations: [],
    services: [],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    scanSettings: {
      preferredHour: 7,
      timezone: "UTC",
      scope: "priority" as const,
      enabled: true,
    },
    urlPatterns: {
      city: "/locations/",
      service: "/services/",
      project: "/projects/",
    },
    ...overrides,
  };
}

// ── isNonHtmlAsset ────────────────────────────────────────────────────

describe("isNonHtmlAsset", () => {
  it.each([
    "https://example.com/llms.txt",
    "https://example.com/robots.txt",
    "https://example.com/sitemap.xml",
    "https://example.com/data.json",
    "https://example.com/file.pdf",
    "https://example.com/image.jpg",
    "https://example.com/image.jpeg",
    "https://example.com/image.png",
    "https://example.com/image.gif",
    "https://example.com/image.svg",
    "https://example.com/image.webp",
    "https://example.com/icon.ico",
    "https://example.com/style.css",
    "https://example.com/script.js",
    "https://example.com/script.js.map",
    "https://example.com/manifest.webmanifest",
    "https://example.com/video.mp4",
    "https://example.com/clip.mov",
    "https://example.com/track.mp3",
    "https://example.com/track.wav",
  ])("returns true for non-HTML asset: %s", (url) => {
    expect(isNonHtmlAsset(url)).toBe(true);
  });

  it("is case-insensitive for extensions", () => {
    expect(isNonHtmlAsset("https://example.com/IMAGE.JPG")).toBe(true);
    expect(isNonHtmlAsset("https://example.com/Image.PnG")).toBe(true);
  });

  it("tolerates query strings and hash fragments", () => {
    expect(isNonHtmlAsset("https://example.com/image.jpg?v=2")).toBe(true);
    expect(isNonHtmlAsset("https://example.com/image.png#fragment")).toBe(true);
  });

  it.each([
    "https://example.com/about",
    "https://example.com/about-us",
    "https://example.com/services/whole-home",
    "https://example.com/locations/palo-alto",
    "https://example.com/",
    "https://example.com",
    "https://example.com/llms",
    "https://example.com/v1.2/about", // dot in earlier segment, not extension
  ])("returns false for HTML page: %s", (url) => {
    expect(isNonHtmlAsset(url)).toBe(false);
  });
});

// ── classifyPageType ──────────────────────────────────────────────────

describe("classifyPageType — homepage", () => {
  it.each([
    "https://example.com/",
    "https://example.com",
    "http://example.com/",
  ])("classifies %s as homepage", (url) => {
    expect(classifyPageType(url, makeConfig())).toBe("homepage");
  });
});

describe("classifyPageType — technical asset (priority 1)", () => {
  it.each([
    "https://example.com/llms.txt",
    "https://example.com/sitemap.xml",
    "https://example.com/data.json",
    "https://example.com/file.pdf",
    "https://example.com/image.jpg",
  ])("classifies %s as technical_asset", (url) => {
    expect(classifyPageType(url, makeConfig())).toBe("technical_asset");
  });
});

describe("classifyPageType — city / service / project detail (urlPatterns)", () => {
  it("classifies /locations/{city} as city", () => {
    expect(
      classifyPageType("https://example.com/locations/palo-alto", makeConfig()),
    ).toBe("city");
  });

  it("classifies /services/{service} as service", () => {
    expect(
      classifyPageType("https://example.com/services/whole-home", makeConfig()),
    ).toBe("service");
  });

  it("classifies /projects/{project} as project", () => {
    expect(
      classifyPageType(
        "https://example.com/projects/atherton-modern",
        makeConfig(),
      ),
    ).toBe("project");
  });

  it("respects custom urlPatterns (e.g., /explore-projects/)", () => {
    const cfg = makeConfig({
      urlPatterns: {
        city: "/locations/",
        service: "/services/",
        project: "/explore-projects/",
      },
    });
    expect(
      classifyPageType("https://example.com/explore-projects/some-project", cfg),
    ).toBe("project");
  });

  it("uses segment-bounded prefix match (does NOT false-positive on substring)", () => {
    // `/explore-projects` includes `/projects` as a substring. With
    // urlPatterns.project=`/projects/`, segment-bounded matching
    // must NOT classify `/explore-projects` as a project detail.
    expect(
      classifyPageType("https://example.com/explore-projects", makeConfig()),
    ).not.toBe("project");
    // Likewise the path with a slug after.
    expect(
      classifyPageType(
        "https://example.com/explore-projects/some-name",
        makeConfig(),
      ),
    ).not.toBe("project");
  });
});

describe("classifyPageType — hub (priority 4: urlPattern hubs)", () => {
  it("classifies /locations (no detail slug) as hub", () => {
    expect(classifyPageType("https://example.com/locations", makeConfig())).toBe(
      "hub",
    );
  });

  it("classifies /locations/ (trailing slash) as hub", () => {
    expect(classifyPageType("https://example.com/locations/", makeConfig())).toBe(
      "hub",
    );
  });

  it("classifies /services as hub", () => {
    expect(classifyPageType("https://example.com/services", makeConfig())).toBe(
      "hub",
    );
  });

  it("classifies /projects as hub", () => {
    expect(classifyPageType("https://example.com/projects", makeConfig())).toBe(
      "hub",
    );
  });
});

describe("classifyPageType — hub (priority 5: universal hub names)", () => {
  it.each([
    "https://example.com/available-homes",
    "https://example.com/portfolio",
    "https://example.com/blog",
    "https://example.com/news",
    "https://example.com/resources",
    "https://example.com/case-studies",
    "https://example.com/testimonials",
    "https://example.com/reviews",
    "https://example.com/explore-projects",
  ])("classifies %s as hub (universal pattern)", (url) => {
    expect(classifyPageType(url, makeConfig())).toBe("hub");
  });

  it("only matches when the hub name is the ENTIRE path (single segment)", () => {
    // `/blog/some-post` is a content detail, not a hub. Should
    // classify as "other".
    expect(
      classifyPageType("https://example.com/blog/some-post", makeConfig()),
    ).toBe("other");
  });
});

describe("classifyPageType — utility (priority 6)", () => {
  it.each([
    // Privacy / legal / terms
    "https://example.com/privacy",
    "https://example.com/privacy-policy",
    "https://example.com/privacy-statement",
    "https://example.com/terms",
    "https://example.com/terms-of-service",
    "https://example.com/terms-and-conditions",
    "https://example.com/legal",
    "https://example.com/cookie",
    "https://example.com/cookie-policy",
    "https://example.com/accessibility",
    "https://example.com/platform-info",
    // Contact / about
    "https://example.com/contact",
    "https://example.com/contact-us",
    "https://example.com/about",
    "https://example.com/about-us",
    "https://example.com/our-story",
    "https://example.com/team",
    "https://example.com/our-team",
    // Careers
    "https://example.com/careers",
    "https://example.com/jobs",
    // FAQ / help
    "https://example.com/faq",
    "https://example.com/help",
    "https://example.com/support",
    // Partners / press
    "https://example.com/partners",
    "https://example.com/our-partners",
    "https://example.com/press",
  ])("classifies %s as utility", (url) => {
    expect(classifyPageType(url, makeConfig())).toBe("utility");
  });

  it("matches utility patterns on ANY path segment (not just the first)", () => {
    // /company/about → "about" is the second segment → utility
    expect(
      classifyPageType("https://example.com/company/about", makeConfig()),
    ).toBe("utility");
  });

  it("does NOT substring-match (e.g., /about-modern-design is 'other', not utility)", () => {
    // The segment "about-modern-design" is NOT in the utility set
    // (only exact-segment matches). Should classify as "other".
    expect(
      classifyPageType("https://example.com/about-modern-design", makeConfig()),
    ).toBe("other");
  });
});

describe("classifyPageType — other (fallback)", () => {
  it.each([
    "https://example.com/design-studio",
    "https://example.com/some-random-page",
    "https://example.com/marketing/landing-2024",
  ])("classifies %s as other (no pattern match)", (url) => {
    expect(classifyPageType(url, makeConfig())).toBe("other");
  });
});

describe("classifyPageType — query / hash tolerance", () => {
  it("ignores query string when classifying", () => {
    expect(
      classifyPageType(
        "https://example.com/locations/palo-alto?utm_source=ga4",
        makeConfig(),
      ),
    ).toBe("city");
  });

  it("ignores hash fragment when classifying", () => {
    expect(
      classifyPageType(
        "https://example.com/services/whole-home#section",
        makeConfig(),
      ),
    ).toBe("service");
  });
});

describe("classifyPageType — fallback heuristics when no urlPatterns", () => {
  const noPatterns = makeConfig({ urlPatterns: undefined });

  it("classifies /locations/{slug} as city via fallback", () => {
    expect(
      classifyPageType("https://example.com/locations/palo-alto", noPatterns),
    ).toBe("city");
  });

  it("classifies /locations (no slug) as hub via fallback", () => {
    expect(classifyPageType("https://example.com/locations", noPatterns)).toBe(
      "hub",
    );
  });

  it("classifies /services/{slug} as service via fallback", () => {
    expect(
      classifyPageType("https://example.com/services/whole-home", noPatterns),
    ).toBe("service");
  });

  it("classifies /projects/{slug} as project via fallback", () => {
    expect(
      classifyPageType(
        "https://example.com/projects/atherton-modern",
        noPatterns,
      ),
    ).toBe("project");
  });
});
