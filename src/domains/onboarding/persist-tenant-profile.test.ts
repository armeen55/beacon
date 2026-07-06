/**
 * persist-tenant-profile — write without clobbering the operator (2026-07-06).
 *
 * Pins the self-heal writer's ONE hard rule: OPERATOR OVERRIDES ARE PINNED.
 *   - genuinely empty config holes get filled from the derived profile,
 *   - a field the operator already set (industry / services / businessType /
 *     locations) is NEVER overwritten — the no-clobber pin,
 *   - service areas grow by UNION (new markets added, existing kept),
 *   - an empty profile changes nothing (byte-identical),
 *   - fail-soft: a save error is swallowed, not thrown,
 *   - segment change is suggested only when it genuinely differs and the tenant
 *     is not on the self-declared builder segment.
 *
 * business-config is the real disk store (unique test tenant id, cleaned up).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: vi.fn(async () => {}),
  syncTenantBusinessConfig: vi.fn(async () => {}),
}));

import { persistTenantProfile } from "./persist-tenant-profile";
import type { TenantProfile } from "./tenant-profile";
import * as businessConfig from "@/lib/business-config";
import {
  getBusinessConfig,
  saveBusinessConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";

const TENANT = "tenant-persist-profile-test";
const TENANT_DIR = join(process.cwd(), ".data", "tenants", TENANT);

function cleanup() {
  rmSync(TENANT_DIR, { recursive: true, force: true });
  __resetBusinessConfigCacheForTests();
}

beforeEach(cleanup);
afterEach(cleanup);

function profile(over: Partial<TenantProfile> = {}): TenantProfile {
  return {
    industry: "",
    businessType: "other",
    services: [],
    serviceAreas: [],
    confidence: "low",
    evidence: [],
    suggestedSegment: null,
    ...over,
  };
}

describe("persistTenantProfile — fills empty holes", () => {
  it("records businessType, industry, and services when the config is empty", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service",
        industry: "roofing",
        services: ["roof repair", "gutter cleaning"],
        serviceAreas: ["Austin", "Round Rock"],
        suggestedSegment: "local_service",
      }),
    });
    expect(result.changedFields).toEqual(
      expect.arrayContaining([
        "businessType",
        "industry",
        "services",
        "locations",
      ]),
    );
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.businessType).toBe("local_service");
    expect(cfg.industry).toBe("roofing");
    expect(cfg.services).toEqual(["roof repair", "gutter cleaning"]);
    expect(cfg.locations).toEqual(
      expect.arrayContaining(["Austin", "Round Rock"]),
    );
  });

  it("sets contentSiteMode for a content publisher", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "content_publisher",
        suggestedSegment: "content_publisher",
      }),
    });
    expect(result.changedFields).toContain("contentSiteMode");
    expect(getBusinessConfig(TENANT).contentSiteMode).toBe(true);
  });
});

describe("persistTenantProfile — no-clobber pin (operator overrides win)", () => {
  it("does NOT overwrite an operator-set industry", () => {
    saveBusinessConfig(TENANT, { industry: "custom homes" });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service", industry: "roofing" }),
    });
    expect(result.changedFields).not.toContain("industry");
    expect(getBusinessConfig(TENANT).industry).toBe("custom homes");
  });

  it("does NOT overwrite an operator-set businessType", () => {
    saveBusinessConfig(TENANT, { businessType: "content_publisher" });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service" }),
    });
    expect(result.changedFields).not.toContain("businessType");
    expect(getBusinessConfig(TENANT).businessType).toBe("content_publisher");
    // The returned businessType reflects the PINNED existing value.
    expect(result.businessType).toBe("content_publisher");
  });

  it("does NOT replace an operator-curated services list (a hand list is intentional)", () => {
    saveBusinessConfig(TENANT, { services: ["Bespoke Kitchens"] });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service",
        services: ["generic service a", "generic service b"],
      }),
    });
    expect(result.changedFields).not.toContain("services");
    expect(getBusinessConfig(TENANT).services).toEqual(["Bespoke Kitchens"]);
  });

  it("grows locations by UNION (keeps operator entries, adds new markets)", () => {
    saveBusinessConfig(TENANT, { locations: ["Austin"] });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service",
        serviceAreas: ["Austin", "Round Rock", "Georgetown"],
      }),
    });
    expect(result.changedFields).toContain("locations");
    const cfg = getBusinessConfig(TENANT);
    // Existing entry preserved and leads; new markets appended.
    expect(cfg.locations[0]).toBe("Austin");
    expect(cfg.locations).toEqual(
      expect.arrayContaining(["Austin", "Round Rock", "Georgetown"]),
    );
    // No duplicate of the already-present market.
    expect(cfg.locations.filter((l) => l.toLowerCase() === "austin")).toHaveLength(
      1,
    );
  });

  it("does not touch locations when the union adds nothing new", () => {
    saveBusinessConfig(TENANT, { locations: ["Austin", "Round Rock"] });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service",
        serviceAreas: ["austin", "round rock"], // same markets, different case
      }),
    });
    expect(result.changedFields).not.toContain("locations");
    expect(getBusinessConfig(TENANT).locations).toEqual(["Austin", "Round Rock"]);
  });

  it("a non-local type never writes service areas into locations", () => {
    saveBusinessConfig(TENANT, { locations: [] });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "content_publisher",
        // A content profile carries no serviceAreas anyway, but pin the guard.
        serviceAreas: ["Austin"],
      }),
    });
    expect(result.changedFields).not.toContain("locations");
    expect(getBusinessConfig(TENANT).locations).toEqual([]);
  });

  it("never turns contentSiteMode OFF (that is an operator decision)", () => {
    saveBusinessConfig(TENANT, { contentSiteMode: true });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service" }),
    });
    expect(result.changedFields).not.toContain("contentSiteMode");
    expect(getBusinessConfig(TENANT).contentSiteMode).toBe(true);
  });
});

describe("persistTenantProfile — empty profile is a no-op", () => {
  it("byte-identical config when every field is already filled + profile empty", () => {
    // A fully-configured tenant: businessType is already set, so an empty
    // (nothing-derived) profile has no hole to fill and writes nothing.
    saveBusinessConfig(TENANT, {
      businessType: "content_publisher",
      contentSiteMode: true,
      industry: "custom homes",
      services: ["A", "B"],
      locations: ["Austin"],
    });
    const before = JSON.stringify(getBusinessConfig(TENANT));
    const result = persistTenantProfile({
      tenantId: TENANT,
      // industry/services empty, no serviceAreas: fills nothing. businessType
      // "content_publisher" matches the pinned value, so it is not rewritten.
      profile: profile({ businessType: "content_publisher" }),
    });
    expect(result.changedFields).toEqual([]);
    const after = JSON.stringify(getBusinessConfig(TENANT));
    expect(after).toBe(before);
  });

  it("records only the derived businessType hole on an otherwise-empty tenant", () => {
    // On a fresh tenant with no businessType set, a derived "other" fills that
    // single empty hole and nothing else (industry/services/locations empty).
    const result = persistTenantProfile({ tenantId: TENANT, profile: profile() });
    expect(result.changedFields).toEqual(["businessType"]);
    expect(getBusinessConfig(TENANT).businessType).toBe("other");
    expect(getBusinessConfig(TENANT).industry).toBe("");
    expect(getBusinessConfig(TENANT).services).toEqual([]);
    expect(getBusinessConfig(TENANT).locations).toEqual([]);
  });
});

describe("persistTenantProfile — segment change decision", () => {
  it("suggests the derived segment when it differs from the current one", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service",
        suggestedSegment: "local_service",
      }),
      currentSegment: "content_publisher",
    });
    expect(result.segmentChanged).toBe(true);
    expect(result.segment).toBe("local_service");
  });

  it("no segment change when the derived segment matches the current one", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "content_publisher",
        suggestedSegment: "content_publisher",
      }),
      currentSegment: "content_publisher",
    });
    expect(result.segmentChanged).toBe(false);
    expect(result.segment).toBeNull();
  });

  it("never demotes a self-declared builder segment (human choice wins)", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "content_publisher",
        suggestedSegment: "content_publisher",
      }),
      currentSegment: "local_residential_builder",
    });
    expect(result.segmentChanged).toBe(false);
    expect(result.segment).toBeNull();
  });

  it("no segment change when the profile suggests none (null)", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "other", suggestedSegment: null }),
      currentSegment: "content_publisher",
    });
    expect(result.segmentChanged).toBe(false);
  });
});

describe("persistTenantProfile — fail-soft on save error", () => {
  it("swallows a save error and returns a no-change result (never throws)", () => {
    const spy = vi
      .spyOn(businessConfig, "saveBusinessConfig")
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    try {
      const result = persistTenantProfile({
        tenantId: TENANT,
        profile: profile({
          businessType: "local_service",
          industry: "roofing",
        }),
      });
      expect(spy).toHaveBeenCalled();
      expect(result.changedFields).toEqual([]);
      expect(result.segmentChanged).toBe(false);
      expect(result.segment).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
