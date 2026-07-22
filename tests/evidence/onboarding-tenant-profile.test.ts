/**
 * TENANT PROFILE: DERIVE + PERSIST (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/onboarding/tenant-profile.test.ts
 *   src/domains/onboarding/persist-tenant-profile.test.ts
 * (refresh-tenant-profile.test.ts deleted as D4: pure mock-threading wiring.)
 * Pins kept: works-for-ANY-business with zero tenant hardcoding, content-site
 * no-op (publisher carries no service areas), location terms alone never flip
 * a site local, LLM seam fail-soft + not consulted at high confidence, the
 * operator no-clobber pin, union-only location growth, fail-soft persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: vi.fn(async () => {}),
  syncTenantBusinessConfig: vi.fn(async () => {}),
}));

import {
  deriveTenantProfile,
  profileFromSnapshotsAndConfig,
  type BusinessTypeLlm,
  type TenantProfile,
} from "@/domains/onboarding/tenant-profile";
import { persistTenantProfile } from "@/domains/onboarding/persist-tenant-profile";
import * as businessConfig from "@/lib/business-config";
import {
  getBusinessConfig,
  saveBusinessConfig,
  __resetBusinessConfigCacheForTests,
  type BusinessConfig,
} from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import type { QuerySignal } from "@/domains/onboarding/business-type";

const TENANT = "tenant-evidence-profile-test";
const TENANT_DIR = join(process.cwd(), ".data", "tenants", TENANT);

function cleanup() {
  rmSync(TENANT_DIR, { recursive: true, force: true });
  __resetBusinessConfigCacheForTests();
}
beforeEach(cleanup);
afterEach(cleanup);

function snapshot(over: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1", page_id: "page-1", url: "https://example.com/", canonical_url: null,
    fetched_at: "2026-07-06T00:00:00.000Z", http_status: 200, title: null, meta_description: null,
    h1: null, h2_list: [], h3_count: 0, faqs: [], schema_types: [], location_terms: [],
    service_terms: [], internal_link_count: 0, external_link_count: 0, word_count: 0,
    robots_meta: null, has_canonical_mismatch: false, content_hash: "h", headings_hash: "h",
    faq_hash: "h", schema_hash: "h", tenant_id: TENANT, ...over,
  };
}
const noSnapshots = async () => [] as PageSnapshot[];
const noQueries = async () => [] as QuerySignal[];

describe("profileFromSnapshotsAndConfig", () => {
  const baseConfig = (over: Partial<BusinessConfig> = {}): BusinessConfig => ({
    ...getBusinessConfig(TENANT), ...over,
  });

  it("collects schema types, service + location terms, and entity names", () => {
    const p = profileFromSnapshotsAndConfig(
      [snapshot({
        schema_types: ["LocalBusiness"],
        service_terms: ["Roof Repair", "Gutter Cleaning"],
        location_terms: ["Austin"],
        schema_entity_names: ["Emergency Roofing"],
      })],
      baseConfig({ address: "1 Main St", phone: "555-0100" }),
    );
    expect(p.schemaTypes).toContain("LocalBusiness");
    expect(p.services).toEqual(expect.arrayContaining(["roof repair", "gutter cleaning", "emergency roofing"]));
    expect(p.locations).toContain("austin");
  });

  it("content schema + no address/phone flags contentSiteSignal; a phone kills it", () => {
    expect(
      profileFromSnapshotsAndConfig([snapshot({ schema_types: ["Article", "WebSite"] })], baseConfig({ address: "", phone: "" })).contentSiteSignal,
    ).toBe(true);
    expect(
      profileFromSnapshotsAndConfig([snapshot({ schema_types: ["Article"] })], baseConfig({ phone: "555-0100", address: "" })).contentSiteSignal,
    ).toBe(false);
  });

  it("five substantial non-local pages close the no-schema publisher catch-22; four do not", () => {
    const page = (i: number) => snapshot({
      id: `snap-${i}`, page_id: `page-${i}`, url: `https://example.com/article-${i}`,
      word_count: 900, h2_list: ["Background", "Details", "Sources"],
    });
    expect(
      profileFromSnapshotsAndConfig(Array.from({ length: 5 }, (_, i) => page(i)), baseConfig({ address: "", phone: "" })).contentSiteSignal,
    ).toBe(true);
    expect(
      profileFromSnapshotsAndConfig(Array.from({ length: 4 }, (_, i) => page(i)), baseConfig({ address: "", phone: "" })).contentSiteSignal,
    ).toBe(false);
  });
});

describe("deriveTenantProfile: end-to-end verdict from injected substrates", () => {
  it("content/encyclopedia fixture: content_publisher + EMPTY serviceAreas (the no-op pin)", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [snapshot({ schema_types: ["Article", "WebSite"] })],
      loadTopQueries: async () => [
        { query: "what is nowruz", impressions: 9000 },
        { query: "history of persia", impressions: 8000 },
      ],
    });
    expect(profile.businessType).toBe("content_publisher");
    expect(profile.serviceAreas).toEqual([]);
    expect(profile.suggestedSegment).toBe("content_publisher");
  });

  it("local presence via config address: local_service + serviceAreas from real queries", async () => {
    saveBusinessConfig(TENANT, { address: "10 Congress Ave, Austin, TX" });
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [snapshot({
        schema_types: ["HVACBusiness"],
        service_terms: ["ac repair", "furnace install"],
        location_terms: ["austin"],
      })],
      loadTopQueries: async () => [
        { query: "ac repair in Austin", impressions: 1200 },
        { query: "furnace install near Round Rock", impressions: 800 },
      ],
    });
    expect(profile.businessType).toBe("local_service");
    expect(profile.serviceAreas).toEqual(expect.arrayContaining(["Austin", "Round Rock"]));
  });

  it("location_terms ALONE (no address/phone) do NOT flip a site local", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [snapshot({ schema_types: ["WebSite"], location_terms: ["ca"] })],
      loadTopQueries: noQueries,
    });
    expect(profile.businessType).not.toBe("local_service");
    expect(profile.serviceAreas).toEqual([]);
  });

  it("empty-safe and fail-soft: no substrates or throwing substrates still return an honest verdict", async () => {
    const empty = await deriveTenantProfile({ tenantId: TENANT, loadSnapshots: noSnapshots, loadTopQueries: noQueries });
    expect(empty.businessType).toBe("other");
    expect(empty.suggestedSegment).toBeNull();

    const degraded = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => { throw new Error("repo down"); },
      loadTopQueries: async () => { throw new Error("gsc down"); },
    });
    expect(degraded.businessType).toBe("other");
  });
});

describe("deriveTenantProfile: LLM seam is fail-soft", () => {
  const ambiguous = { tenantId: TENANT, loadSnapshots: noSnapshots, loadTopQueries: noQueries };

  it("LLM throw or null is swallowed; refinement applies only when it returns a different type", async () => {
    const thrown: BusinessTypeLlm = async () => { throw new Error("llm exploded"); };
    expect((await deriveTenantProfile({ ...ambiguous, llm: thrown })).businessType).toBe("other");
    const nullLlm: BusinessTypeLlm = async () => null;
    expect((await deriveTenantProfile({ ...ambiguous, llm: nullLlm })).businessType).toBe("other");

    const refine = vi.fn(async () => ({ businessType: "saas" as const, confidence: "medium" as const }));
    const refined = await deriveTenantProfile({ ...ambiguous, llm: refine });
    expect(refine).toHaveBeenCalledTimes(1);
    expect(refined.businessType).toBe("saas");
    expect(refined.evidence.join(" ")).toContain("double-checked");
  });

  it("LLM is NOT consulted for a high-confidence deterministic verdict", async () => {
    const llm = vi.fn(async () => ({ businessType: "saas" as const, confidence: "high" as const }));
    await deriveTenantProfile({
      tenantId: TENANT,
      profile: {
        name: null, nameSource: null, description: null, industry: null, schemaTypes: [],
        phone: null, address: "1 Main St", locations: [], services: [], keyPages: [],
        socialProfiles: [], contentSiteSignal: false,
      },
      loadSnapshots: noSnapshots,
      loadTopQueries: noQueries,
      llm,
    });
    expect(llm).not.toHaveBeenCalled();
  });
});

// ── persistTenantProfile: write without clobbering the operator ─────────────

function profile(over: Partial<TenantProfile> = {}): TenantProfile {
  return {
    industry: "", businessType: "other", services: [], serviceAreas: [],
    confidence: "low", evidence: [], suggestedSegment: null, ...over,
  };
}

describe("persistTenantProfile: fills empty holes only", () => {
  it("records businessType, industry, services, locations when the config is empty", () => {
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({
        businessType: "local_service", industry: "roofing",
        services: ["roof repair", "gutter cleaning"], serviceAreas: ["Austin", "Round Rock"],
        suggestedSegment: "local_service",
      }),
    });
    expect(result.changedFields).toEqual(
      expect.arrayContaining(["businessType", "industry", "services", "locations"]),
    );
    expect(getBusinessConfig(TENANT).industry).toBe("roofing");
  });
});

describe("persistTenantProfile: the no-clobber pin (operator overrides win)", () => {
  it("does NOT overwrite operator-set industry, businessType, or a curated services list", () => {
    saveBusinessConfig(TENANT, { industry: "custom homes", businessType: "content_publisher", services: ["Bespoke Kitchens"] });
    const result = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service", industry: "roofing", services: ["generic a"] }),
    });
    expect(result.changedFields).not.toContain("industry");
    expect(result.changedFields).not.toContain("businessType");
    expect(result.changedFields).not.toContain("services");
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.industry).toBe("custom homes");
    expect(cfg.businessType).toBe("content_publisher");
    expect(cfg.services).toEqual(["Bespoke Kitchens"]);
    expect(result.businessType).toBe("content_publisher");
  });

  it("grows locations by UNION (keeps operator entries, adds new, no dupes, no-op when nothing new)", () => {
    saveBusinessConfig(TENANT, { locations: ["Austin"] });
    persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service", serviceAreas: ["Austin", "Round Rock", "Georgetown"] }),
    });
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.locations[0]).toBe("Austin");
    expect(cfg.locations).toEqual(expect.arrayContaining(["Austin", "Round Rock", "Georgetown"]));
    expect(cfg.locations.filter((l) => l.toLowerCase() === "austin")).toHaveLength(1);

    const noop = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service", serviceAreas: ["austin", "round rock", "georgetown"] }),
    });
    expect(noop.changedFields).not.toContain("locations");
  });

  it("never turns contentSiteMode OFF (that is an operator decision)", () => {
    saveBusinessConfig(TENANT, { contentSiteMode: true });
    const result = persistTenantProfile({ tenantId: TENANT, profile: profile({ businessType: "local_service" }) });
    expect(result.changedFields).not.toContain("contentSiteMode");
    expect(getBusinessConfig(TENANT).contentSiteMode).toBe(true);
  });
});

describe("persistTenantProfile: empty profile, segment decision, fail-soft", () => {
  it("byte-identical config when every field is filled and the profile is empty", () => {
    saveBusinessConfig(TENANT, {
      businessType: "content_publisher", contentSiteMode: true, industry: "custom homes",
      services: ["A", "B"], locations: ["Austin"],
    });
    const before = JSON.stringify(getBusinessConfig(TENANT));
    const result = persistTenantProfile({ tenantId: TENANT, profile: profile({ businessType: "content_publisher" }) });
    expect(result.changedFields).toEqual([]);
    expect(JSON.stringify(getBusinessConfig(TENANT))).toBe(before);
  });

  it("suggests a differing segment, never demotes a self-declared builder segment", () => {
    const suggest = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "local_service", suggestedSegment: "local_service" }),
      currentSegment: "content_publisher",
    });
    expect(suggest.segmentChanged).toBe(true);
    expect(suggest.segment).toBe("local_service");

    const pinned = persistTenantProfile({
      tenantId: TENANT,
      profile: profile({ businessType: "content_publisher", suggestedSegment: "content_publisher" }),
      currentSegment: "local_residential_builder",
    });
    expect(pinned.segmentChanged).toBe(false);
    expect(pinned.segment).toBeNull();
  });

  it("swallows a save error and returns a no-change result (never throws)", () => {
    const spy = vi.spyOn(businessConfig, "saveBusinessConfig").mockImplementation(() => {
      throw new Error("disk full");
    });
    try {
      const result = persistTenantProfile({
        tenantId: TENANT,
        profile: profile({ businessType: "local_service", industry: "roofing" }),
      });
      expect(result.changedFields).toEqual([]);
      expect(result.segmentChanged).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
