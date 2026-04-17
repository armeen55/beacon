import { describe, it, expect } from "vitest";
import { classifyAssetType } from "./classify-asset-type";

describe("classifyAssetType — core rules", () => {
  it("empty / null / undefined → homepage", () => {
    expect(classifyAssetType(null)).toBe("homepage");
    expect(classifyAssetType(undefined)).toBe("homepage");
    expect(classifyAssetType("")).toBe("homepage");
  });

  it("'/' and full host root → homepage", () => {
    expect(classifyAssetType("/")).toBe("homepage");
    expect(classifyAssetType("https://ritzbuilders.com")).toBe("homepage");
    expect(classifyAssetType("https://ritzbuilders.com/")).toBe("homepage");
  });

  it("hub pages (exact match) → hub_page", () => {
    expect(classifyAssetType("/locations")).toBe("hub_page");
    expect(classifyAssetType("/locations/")).toBe("hub_page");
    expect(classifyAssetType("/services")).toBe("hub_page");
    expect(classifyAssetType("/services/")).toBe("hub_page");
    expect(classifyAssetType("/explore-projects")).toBe("hub_page");
    expect(classifyAssetType("/explore-projects/")).toBe("hub_page");
    expect(classifyAssetType("/projects")).toBe("hub_page");
    expect(classifyAssetType("/available-homes")).toBe("hub_page");
  });

  it("city pages (/locations/<slug>) → city_page", () => {
    expect(classifyAssetType("/locations/menlo-park")).toBe("city_page");
    expect(classifyAssetType("/locations/menlo-park/")).toBe("city_page");
    expect(classifyAssetType("/locations/atherton")).toBe("city_page");
    expect(classifyAssetType("/locations/palo-alto")).toBe("city_page");
    expect(classifyAssetType("/locations/cupertino-custom-home-builder")).toBe(
      "city_page",
    );
    expect(
      classifyAssetType("https://ritzbuilders.com/locations/los-altos/"),
    ).toBe("city_page");
  });

  it("service pages (/services/<slug>) → service_page", () => {
    expect(classifyAssetType("/services/whole-home-remodel")).toBe(
      "service_page",
    );
    expect(classifyAssetType("/services/design-build")).toBe("service_page");
    expect(classifyAssetType("/services/teardown-rebuild")).toBe(
      "service_page",
    );
  });

  it("project pages → project_page", () => {
    expect(classifyAssetType("/explore-projects/riverside-way")).toBe(
      "project_page",
    );
    expect(classifyAssetType("/explore-projects/austin-avenue-los-altos")).toBe(
      "project_page",
    );
    expect(classifyAssetType("/projects/foo-bar")).toBe("project_page");
    expect(
      classifyAssetType("/available-homes/kiner-residence-willow-glen"),
    ).toBe("project_page");
  });

  it("process pages (explicit whitelist) → process_page", () => {
    expect(classifyAssetType("/our-process")).toBe("process_page");
    expect(classifyAssetType("/our-process/")).toBe("process_page");
    expect(classifyAssetType("/our-approach")).toBe("process_page");
    expect(classifyAssetType("/how-we-work")).toBe("process_page");
  });

  it("brand pages → brand_page", () => {
    expect(classifyAssetType("/our-difference")).toBe("brand_page");
    expect(classifyAssetType("/our-partners")).toBe("brand_page");
    expect(classifyAssetType("/our-awards")).toBe("brand_page");
    expect(classifyAssetType("/about-us")).toBe("brand_page");
    expect(classifyAssetType("/design-studio")).toBe("brand_page");
    expect(classifyAssetType("/faq")).toBe("brand_page");
    expect(classifyAssetType("/platform-info")).toBe("brand_page");
    expect(classifyAssetType("/privacy-policy")).toBe("brand_page");
    expect(classifyAssetType("/luxury-home-builder-bay-area")).toBe(
      "brand_page",
    );
    expect(classifyAssetType("/luxury-home-builder-bay-area/")).toBe(
      "brand_page",
    );
    expect(classifyAssetType("/custom-home-builder-bay-area")).toBe(
      "brand_page",
    );
  });

  it("infrastructure files (.txt/.xml) → sitemap", () => {
    expect(classifyAssetType("/llms.txt")).toBe("sitemap");
    expect(classifyAssetType("/sitemap.xml")).toBe("sitemap");
    expect(classifyAssetType("/robots.txt")).toBe("sitemap");
  });

  it("lead-capture pages → lead_form", () => {
    expect(classifyAssetType("/contact-us")).toBe("lead_form");
    expect(classifyAssetType("/contact")).toBe("lead_form");
    expect(classifyAssetType("/get-started")).toBe("lead_form");
  });

  it("unrecognized URL → service_page (legacy-compat default)", () => {
    expect(classifyAssetType("/something-random")).toBe("service_page");
    expect(classifyAssetType("/details/1")).toBe("service_page");
    expect(classifyAssetType("/all")).toBe("service_page");
  });

  it("case-insensitive path matching", () => {
    expect(classifyAssetType("/Locations/Menlo-Park")).toBe("city_page");
    expect(classifyAssetType("/OUR-PROCESS")).toBe("process_page");
  });

  it("does NOT confuse hub pages with their children", () => {
    // Guard: if my regex ordering were wrong, /locations could match
    // /^\/locations\/[^/]+/ somehow. Explicit guards:
    expect(classifyAssetType("/locations")).not.toBe("city_page");
    expect(classifyAssetType("/services")).not.toBe("service_page");
    expect(classifyAssetType("/explore-projects")).not.toBe("project_page");
  });
});

describe("classifyAssetType — parity with legacy inferAssetType() for URLs present in live data", () => {
  // Legacy `inferAssetType()` behavior reproduced locally to compare against.
  function legacyInferAssetType(url: string): string {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
    if (!path || path === "/") return "homepage";
    if (/\/locations?\//i.test(path)) return "city_page";
    if (/\/services?\//i.test(path)) return "service_page";
    if (/\/projects?\//i.test(path)) return "project_page";
    return "service_page";
  }

  const realUrls = [
    "/",
    "/about-us",
    "/all",
    "/available-homes/kiner-residence-willow-glen",
    "/available-homes/princeton-residence-menlo-park",
    "/custom-home-builder-bay-area",
    "/custom-home-builder-bay-area/",
    "/design-studio",
    "/details/1",
    "/details/2",
    "/explore-projects",
    "/explore-projects/austin-avenue-los-altos",
    "/explore-projects/louis-road-palo-alto",
    "/explore-projects/riverside-way",
    "/llms.txt",
    "/locations/",
    "/locations/atherton",
    "/locations/cupertino-custom-home-builder",
    "/locations/cupertino-custom-home-builder/",
    "/locations/los-altos",
    "/locations/menlo-park",
    "/locations/menlo-park/",
    "/locations/palo-alto",
    "/locations/saratoga",
    "/luxury-home-builder-bay-area",
    "/luxury-home-builder-bay-area/",
    "/our-awards",
    "/our-difference",
    "/our-process",
    "/services/whole-home-remodel",
  ];

  // Intentional, documented upgrades — classifications the new classifier
  // refines beyond the legacy's 4-bucket coverage.
  const intentionalUpgrades: Record<string, string> = {
    "/about-us": "brand_page",
    "/custom-home-builder-bay-area": "brand_page",
    "/custom-home-builder-bay-area/": "brand_page",
    "/design-studio": "brand_page",
    "/explore-projects": "hub_page",
    // Legacy `/projects?\//` regex required literal `/projects/` so
    // `/explore-projects/*` fell through to the service_page default.
    // New classifier recognizes them explicitly.
    "/explore-projects/austin-avenue-los-altos": "project_page",
    "/explore-projects/louis-road-palo-alto": "project_page",
    "/explore-projects/riverside-way": "project_page",
    "/available-homes/kiner-residence-willow-glen": "project_page",
    "/available-homes/princeton-residence-menlo-park": "project_page",
    "/llms.txt": "sitemap",
    "/locations/": "hub_page",
    "/luxury-home-builder-bay-area": "brand_page",
    "/luxury-home-builder-bay-area/": "brand_page",
    "/our-awards": "brand_page",
    "/our-difference": "brand_page",
    "/our-process": "process_page",
  };

  for (const url of realUrls) {
    it(`URL "${url}" classifies correctly (parity or intentional upgrade)`, () => {
      const newResult = classifyAssetType(url);
      const expected =
        intentionalUpgrades[url] ?? legacyInferAssetType(url);
      expect(newResult).toBe(expected);
    });
  }
});
