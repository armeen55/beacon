/**
 * Brand Knowledge-Graph presence detector tests (BEACON 500 P10, 2026-07-03).
 *
 * Covers: SELF-HIDES when well represented (Organization + sameAs); fires
 * "no_org_schema" when no brand schema; fires "no_sameas" when schema present
 * but no cross-links; null when config insufficient; and that the composed
 * Organization + WebSite schema is valid JSON-LD.
 */

import { describe, expect, it } from "vitest";

import {
  classifyBrandPresence,
  composeBrandEntitySchema,
  composeBrandEntityScript,
} from "@/domains/entity/eeat-brand-presence";
import type { BrandPresenceInput } from "@/domains/entity/eeat-types";
import { validateSchema } from "@/domains/pages/schema-validator";

function input(over: Partial<BrandPresenceInput> = {}): BrandPresenceInput {
  return {
    brandName: "Iranopedia",
    domain: "iranopedia.com",
    hasOrganizationSchema: false,
    hasSameAsLinks: false,
    siteRootUrl: "https://iranopedia.com/",
    fetchedAt: "2026-07-03T00:00:00Z",
    ...over,
  };
}

describe("classifyBrandPresence", () => {
  it("SELF-HIDES (null) when the brand is well represented (Organization + sameAs)", () => {
    const gap = classifyBrandPresence(
      input({ hasOrganizationSchema: true, hasSameAsLinks: true }),
    );
    expect(gap).toBeNull();
  });

  it("fires 'no_org_schema' when the site root carries no Organization schema", () => {
    const gap = classifyBrandPresence(input());
    expect(gap).not.toBeNull();
    expect(gap!.gap).toBe("no_org_schema");
    expect(gap!.brandName).toBe("Iranopedia");
    expect(gap!.siteRootUrl).toBe("https://iranopedia.com/");
  });

  it("fires 'no_sameas' when Organization schema is present but has no sameAs links", () => {
    const gap = classifyBrandPresence(
      input({ hasOrganizationSchema: true, hasSameAsLinks: false }),
    );
    expect(gap!.gap).toBe("no_sameas");
  });

  it("null when there is no brand name or no usable site root", () => {
    expect(classifyBrandPresence(input({ brandName: "" }))).toBeNull();
    expect(classifyBrandPresence(input({ brandName: "   " }))).toBeNull();
    expect(classifyBrandPresence(input({ siteRootUrl: null }))).toBeNull();
    expect(classifyBrandPresence(input({ siteRootUrl: "" }))).toBeNull();
  });
});

describe("composeBrandEntitySchema", () => {
  it("composes a valid Organization + WebSite JSON-LD graph", () => {
    const gap = classifyBrandPresence(input())!;
    const json = composeBrandEntitySchema(gap);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    const types = parsed["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite"]);
    const org = parsed["@graph"][0];
    expect(org.name).toBe("Iranopedia");
    expect(org.url).toBe("https://iranopedia.com/");
    // Valid per the scanner's own validator (Organization has name + url).
    expect(validateSchema(parsed)).toEqual([]);
  });

  it("wraps the schema in a ready-to-paste <script> tag", () => {
    const gap = classifyBrandPresence(input())!;
    const script = composeBrandEntityScript(gap);
    expect(script).toContain('<script type="application/ld+json">');
    expect(script).toContain("Iranopedia");
  });
});
