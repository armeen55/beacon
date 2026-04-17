import { describe, it, expect } from "vitest";
import {
  diffSchemaCoverage,
  EXPECTED_SCHEMA_BY_ASSET_TYPE,
} from "./expected-schema";

describe("diffSchemaCoverage — city_page", () => {
  it("menlo-park control: full stack satisfies all required (ZERO missing_required)", () => {
    // This is the live snapshot from production as of 2026-04-16.
    // menlo-park is the only city page in-account with the full stack;
    // the expected-schema map MUST say it satisfies all requirements.
    const result = diffSchemaCoverage("city_page", [
      "HomeAndConstructionBusiness",
      "WebPage",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(result.missing_required).toEqual([]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("palo-alto current state: FAQPage only → 3 missing_required", () => {
    const result = diffSchemaCoverage("city_page", ["FAQPage"]);
    expect(result.missing_required).toEqual([
      "BreadcrumbList",
      "WebPage",
      "(one of) LocalBusiness | HomeAndConstructionBusiness | ProfessionalService",
    ]);
    expect(result.satisfies_all_required).toBe(false);
  });

  it("LocalBusiness satisfies the oneOf group (not just HomeAndConstructionBusiness)", () => {
    const result = diffSchemaCoverage("city_page", [
      "LocalBusiness",
      "WebPage",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("ProfessionalService also satisfies the oneOf group", () => {
    const result = diffSchemaCoverage("city_page", [
      "ProfessionalService",
      "WebPage",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("partial satisfaction returns only the missing items", () => {
    const result = diffSchemaCoverage("city_page", [
      "FAQPage",
      "BreadcrumbList",
    ]);
    expect(result.missing_required).toEqual([
      "WebPage",
      "(one of) LocalBusiness | HomeAndConstructionBusiness | ProfessionalService",
    ]);
  });
});

describe("diffSchemaCoverage — process_page", () => {
  it("our-process current state: FAQPage only → missing HowTo", () => {
    const result = diffSchemaCoverage("process_page", ["FAQPage"]);
    expect(result.missing_required).toEqual(["HowTo"]);
  });

  it("HowTo + FAQPage → satisfies all required", () => {
    const result = diffSchemaCoverage("process_page", ["HowTo", "FAQPage"]);
    expect(result.satisfies_all_required).toBe(true);
  });
});

describe("diffSchemaCoverage — project_page", () => {
  it("riverside-way current state: FAQPage only → 2 missing", () => {
    const result = diffSchemaCoverage("project_page", ["FAQPage"]);
    expect(result.missing_required.sort()).toEqual(
      ["Article", "BreadcrumbList"].sort(),
    );
  });

  it("Article + BreadcrumbList + FAQPage → satisfies all", () => {
    const result = diffSchemaCoverage("project_page", [
      "Article",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });
});

describe("diffSchemaCoverage — homepage", () => {
  it("ritz homepage current state: FAQPage + HomeAndConstructionBusiness → satisfies all", () => {
    // From the live HTML audit — confirmed this set of @types emitted.
    const result = diffSchemaCoverage("homepage", [
      "FAQPage",
      "HomeAndConstructionBusiness",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("FAQPage only → missing the LocalBusiness-family oneOf", () => {
    const result = diffSchemaCoverage("homepage", ["FAQPage"]);
    expect(result.missing_required).toContain(
      "(one of) LocalBusiness | HomeAndConstructionBusiness | ProfessionalService | Organization",
    );
  });
});

describe("diffSchemaCoverage — service_page", () => {
  it("whole-home-remodel current state: FAQPage only → missing BreadcrumbList + Service/Offer", () => {
    const result = diffSchemaCoverage("service_page", ["FAQPage"]);
    expect(result.missing_required).toEqual([
      "BreadcrumbList",
      "(one of) Service | Offer",
    ]);
  });

  it("Service satisfies the oneOf group", () => {
    const result = diffSchemaCoverage("service_page", [
      "FAQPage",
      "BreadcrumbList",
      "Service",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("Offer ALSO satisfies the oneOf group", () => {
    const result = diffSchemaCoverage("service_page", [
      "FAQPage",
      "BreadcrumbList",
      "Offer",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });
});

describe("diffSchemaCoverage — brand_page", () => {
  it("luxury-home-builder-bay-area: Article+Service+FAQPage+BreadcrumbList → satisfies all required", () => {
    const result = diffSchemaCoverage("brand_page", [
      "Article",
      "Service",
      "FAQPage",
      "BreadcrumbList",
    ]);
    expect(result.satisfies_all_required).toBe(true);
  });

  it("our-difference current state: FAQPage + HomeAndConstructionBusiness → missing BreadcrumbList", () => {
    const result = diffSchemaCoverage("brand_page", [
      "FAQPage",
      "HomeAndConstructionBusiness",
    ]);
    expect(result.missing_required).toEqual(["BreadcrumbList"]);
  });
});

describe("diffSchemaCoverage — hub_page", () => {
  it("locations-hub current state: ProfessionalService + BreadcrumbList + FAQPage → missing CollectionPage/ItemList", () => {
    const result = diffSchemaCoverage("hub_page", [
      "ProfessionalService",
      "BreadcrumbList",
      "FAQPage",
    ]);
    expect(result.missing_required).toEqual(["(one of) CollectionPage | ItemList"]);
  });
});

describe("diffSchemaCoverage — non-content asset types (findings suppressed)", () => {
  it("infrastructure: never flags (required = [])", () => {
    expect(diffSchemaCoverage("infrastructure", []).satisfies_all_required).toBe(true);
    expect(diffSchemaCoverage("infrastructure", []).missing_required).toEqual([]);
  });

  it("sitemap: never flags (required = [])", () => {
    expect(diffSchemaCoverage("sitemap", []).satisfies_all_required).toBe(true);
  });

  it("directory_profile: never flags (required = [])", () => {
    expect(
      diffSchemaCoverage("directory_profile", []).satisfies_all_required,
    ).toBe(true);
  });
});

describe("diffSchemaCoverage — null / empty inputs", () => {
  it("null actualTypes → all required counted as missing", () => {
    const result = diffSchemaCoverage("city_page", null);
    expect(result.missing_required.length).toBeGreaterThan(0);
    expect(result.satisfies_all_required).toBe(false);
  });

  it("undefined actualTypes → all required counted as missing", () => {
    const result = diffSchemaCoverage("city_page", undefined);
    expect(result.missing_required.length).toBeGreaterThan(0);
  });

  it("empty array → all required counted as missing", () => {
    const result = diffSchemaCoverage("city_page", []);
    expect(result.missing_required.length).toBeGreaterThan(0);
  });
});

describe("EXPECTED_SCHEMA_BY_ASSET_TYPE — invariants", () => {
  it("has an entry for every AssetType in the union", () => {
    // The map is typed `Record<AssetType, ExpectedSchema>` so a missing key
    // fails typecheck, but assert at runtime for documentation.
    const assetTypes = [
      "homepage",
      "city_page",
      "service_page",
      "infrastructure",
      "sitemap",
      "directory_profile",
      "lead_form",
      "project_page",
      "process_page",
      "brand_page",
      "hub_page",
    ] as const;
    for (const a of assetTypes) {
      expect(EXPECTED_SCHEMA_BY_ASSET_TYPE[a]).toBeDefined();
    }
  });

  it("menlo-park's live schema satisfies city_page requirements (control check)", () => {
    // THIS is the reference test: if the expected-schema map for city_page
    // is ever over-specified, menlo-park will start erroring — flagging
    // the regression before it reaches the operator's dashboard.
    const live = ["HomeAndConstructionBusiness", "WebPage", "BreadcrumbList", "FAQPage"];
    const result = diffSchemaCoverage("city_page", live);
    expect(result.satisfies_all_required).toBe(true);
  });
});
