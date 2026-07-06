/**
 * business-type — generic business-TYPE classifier (2026-07-06).
 *
 * Pins that EVERY verdict comes from the tenant's own signals, with ZERO
 * vertical/geo/brand hardcoding: a local-service site (address/phone) fires
 * local_service, a content site fires content_publisher with no service areas,
 * an online store fires ecommerce, a software product fires saas, and a
 * genuinely-ambiguous site stays "other" (the safe floor).
 */

import { describe, it, expect } from "vitest";

import {
  classifyBusinessType,
  segmentForBusinessType,
  type BusinessType,
} from "./business-type";
import type { DerivedBusinessProfile } from "./derive-business-profile";

function profile(over: Partial<DerivedBusinessProfile>): DerivedBusinessProfile {
  return {
    name: null,
    nameSource: null,
    description: null,
    industry: null,
    schemaTypes: [],
    phone: null,
    address: null,
    locations: [],
    services: [],
    keyPages: [],
    socialProfiles: [],
    contentSiteSignal: false,
    ...over,
  };
}

describe("classifyBusinessType — grounded, generic, no hardcoding", () => {
  it("physical presence (address) → local_service (high)", () => {
    const v = classifyBusinessType({
      profile: profile({
        address: "100 Ranch Rd, Fredericksburg, TX",
        locations: ["fredericksburg", "boerne"],
        services: ["custom home construction", "remodeling"],
      }),
    });
    expect(v.businessType).toBe("local_service");
    expect(v.confidence).toBe("high");
    expect(v.evidence.join(" ")).toContain("Fredericksburg");
  });

  it("phone alone (no JSON-LD address) → local_service", () => {
    const v = classifyBusinessType({
      profile: profile({ phone: "+1-520-555-0199", services: ["catering"] }),
    });
    expect(v.businessType).toBe("local_service");
  });

  it("content site (Article schema, no address/phone) → content_publisher, no local signal", () => {
    const v = classifyBusinessType({
      profile: profile({
        schemaTypes: ["Article", "WebSite"],
        contentSiteSignal: true,
        locations: ["ca"], // a region-only tag must NOT flip it local
      }),
    });
    expect(v.businessType).toBe("content_publisher");
    expect(v.confidence).toBe("high");
  });

  it("online store (Product schema + cart vocab + buy intent) → ecommerce", () => {
    const v = classifyBusinessType({
      profile: profile({
        schemaTypes: ["Product", "Offer", "WebSite"],
        services: ["shop", "cart", "shipping"],
      }),
      topQueries: [
        { query: "buy running shoes online", impressions: 900 },
        { query: "trail shoes price", impressions: 400 },
      ],
    });
    expect(v.businessType).toBe("ecommerce");
  });

  it("software product (SoftwareApplication schema) → saas", () => {
    const v = classifyBusinessType({
      profile: profile({
        schemaTypes: ["SoftwareApplication", "WebSite"],
        services: ["pricing", "log in", "docs"],
      }),
      topQueries: [{ query: "acme app pricing", impressions: 500 }],
    });
    expect(v.businessType).toBe("saas");
  });

  it("saas vocab + software intent (no schema) → saas (medium)", () => {
    const v = classifyBusinessType({
      profile: profile({ services: ["pricing", "sign up", "integrations"] }),
      topQueries: [
        { query: "acme software free trial", impressions: 700 },
        { query: "acme alternative", impressions: 200 },
      ],
    });
    expect(v.businessType).toBe("saas");
    expect(v.confidence).toBe("medium");
  });

  it("genuinely ambiguous site → other (safe floor)", () => {
    const v = classifyBusinessType({ profile: profile({}) });
    expect(v.businessType).toBe("other");
    expect(v.confidence).toBe("low");
  });

  it("null profile → other, honest evidence, no crash", () => {
    const v = classifyBusinessType({ profile: null });
    expect(v.businessType).toBe("other");
    expect(v.evidence.length).toBeGreaterThan(0);
  });

  it("no hardcoded vertical/geo/brand leaks into any verdict evidence", () => {
    const banned = ["ritz", "palo alto", "bay area", "iranopedia", "persian", "farsi"];
    for (const bt of ["local_service", "content_publisher", "ecommerce", "saas", "other"]) {
      // build a profile that lands on each type
      const v = classifyBusinessType({
        profile: profile(
          bt === "local_service"
            ? { address: "1 A St" }
            : bt === "content_publisher"
              ? { schemaTypes: ["Article"], contentSiteSignal: true }
              : bt === "ecommerce"
                ? { schemaTypes: ["Product"], services: ["cart", "shop"] }
                : bt === "saas"
                  ? { schemaTypes: ["SoftwareApplication"] }
                  : {},
        ),
      });
      const flat = v.evidence.join(" ").toLowerCase();
      for (const b of banned) expect(flat).not.toContain(b);
    }
  });
});

describe("segmentForBusinessType — maps type → segment (local engine on/off)", () => {
  const cases: Array<[BusinessType, "local_service" | "content_publisher" | null]> = [
    ["local_service", "local_service"],
    ["content_publisher", "content_publisher"],
    ["ecommerce", "content_publisher"], // non-local: local engines stay off
    ["saas", "content_publisher"],
    ["other", null],
  ];
  for (const [type, expected] of cases) {
    it(`${type} → ${expected ?? "null (keep default)"}`, () => {
      expect(segmentForBusinessType(type)).toBe(expected);
    });
  }
});
