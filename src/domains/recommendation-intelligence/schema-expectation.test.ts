import { describe, expect, it } from "vitest";
import type { BusinessConfig } from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import { schemaExpectationForSnapshot } from "./schema-expectation";

const contentConfig = {
  name: "Example",
  domain: "example.com",
  industry: "publisher",
  locations: [],
  services: [],
  primaryCompetitors: [],
  contentSiteMode: true,
} as unknown as BusinessConfig;

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://example.com/iranian-singers",
    schema_types: [],
    extraction_certainty: "certain",
    title: "Iranian Singers",
    h1: "Iranian Singers",
    body_paragraph_sample: ["A detailed article about Iranian singers and their careers."],
    ...overrides,
  } as PageSnapshot;
}

describe("schemaExpectationForSnapshot", () => {
  it("expects Article, not local Service/FAQ schema, on content pages", () => {
    const result = schemaExpectationForSnapshot(snapshot(), contentConfig);
    expect(result?.assetLabel).toBe("content page");
    expect(result?.coverage.missing_required).toEqual(["Article"]);
  });

  it("does not propose Article on a Product page", () => {
    const result = schemaExpectationForSnapshot(
      snapshot({ schema_types: ["Product"] }),
      contentConfig,
    );
    expect(result?.assetLabel).toBe("store product page");
    expect(result?.coverage.missing_required).toEqual(["BreadcrumbList"]);
  });
});
