/**
 * tenant-profile — the works-for-ANY-business profile engine (2026-07-06).
 *
 * Pins that a complete {businessType, services, serviceAreas, industry} verdict
 * is derived from a tenant's OWN snapshots + GSC + config, with ZERO tenant
 * hardcoding:
 *   - a content/encyclopedia fixture -> content_publisher + empty serviceAreas
 *     (the content-site no-op),
 *   - a local-service fixture -> local_service + serviceAreas from its markets,
 *   - the LLM seam is fail-soft: when it throws or returns null the
 *     deterministic heuristic stands,
 *   - empty-safe: no snapshots + no queries still returns an honest verdict.
 *
 * All substrate reads are INJECTED, so no test touches the repository, GSC, or
 * the network. business-config is the real disk-backed store (unique test
 * tenant id, cleaned up), matching launch-config.test.ts.
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
} from "./tenant-profile";
import {
  getBusinessConfig,
  saveBusinessConfig,
  __resetBusinessConfigCacheForTests,
  type BusinessConfig,
} from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import type { QuerySignal } from "./business-type";

const TENANT = "tenant-tenant-profile-test";
const TENANT_DIR = join(process.cwd(), ".data", "tenants", TENANT);

function cleanup() {
  rmSync(TENANT_DIR, { recursive: true, force: true });
  __resetBusinessConfigCacheForTests();
}

beforeEach(cleanup);
afterEach(cleanup);

/** Minimal PageSnapshot fixture — only the fields the deriver reads matter. */
function snapshot(over: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/",
    canonical_url: null,
    fetched_at: "2026-07-06T00:00:00.000Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    tenant_id: TENANT,
    ...over,
  };
}

const noSnapshots = async () => [] as PageSnapshot[];
const noQueries = async () => [] as QuerySignal[];

describe("profileFromSnapshotsAndConfig — fuse snapshots + config", () => {
  function baseConfig(over: Partial<BusinessConfig> = {}): BusinessConfig {
    // getBusinessConfig for an unknown tenant returns the merged placeholder,
    // which already has every required field; overlay what a test needs.
    return { ...getBusinessConfig(TENANT), ...over };
  }

  it("collects schema types, service + location terms, and entity names", () => {
    const p = profileFromSnapshotsAndConfig(
      [
        snapshot({
          schema_types: ["LocalBusiness"],
          service_terms: ["Roof Repair", "Gutter Cleaning"],
          location_terms: ["Austin"],
          schema_entity_names: ["Emergency Roofing"],
        }),
      ],
      baseConfig({ address: "1 Main St", phone: "555-0100" }),
    );
    expect(p.schemaTypes).toContain("LocalBusiness");
    expect(p.services).toEqual(
      expect.arrayContaining([
        "roof repair",
        "gutter cleaning",
        "emergency roofing",
      ]),
    );
    expect(p.locations).toContain("austin");
    expect(p.address).toBe("1 Main St");
    expect(p.phone).toBe("555-0100");
  });

  it("folds config-declared services/locations in (operator ground truth)", () => {
    const p = profileFromSnapshotsAndConfig(
      [],
      baseConfig({ services: ["Catering"], locations: ["Marana"] }),
    );
    expect(p.services).toContain("catering");
    expect(p.locations).toContain("marana");
  });

  it("content schema + no address/phone → contentSiteSignal true", () => {
    const p = profileFromSnapshotsAndConfig(
      [snapshot({ schema_types: ["Article", "WebSite"] })],
      baseConfig({ address: "", phone: "" }),
    );
    expect(p.contentSiteSignal).toBe(true);
  });

  it("content schema BUT with a phone → contentSiteSignal false (physical presence wins)", () => {
    const p = profileFromSnapshotsAndConfig(
      [snapshot({ schema_types: ["Article"] })],
      baseConfig({ phone: "555-0100", address: "" }),
    );
    expect(p.contentSiteSignal).toBe(false);
  });

  it("five substantial non-local pages close the no-schema publisher catch-22", () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      snapshot({
        id: `snap-${i}`,
        page_id: `page-${i}`,
        url: `https://example.com/article-${i}`,
        word_count: 900,
        h2_list: ["Background", "Details", "Sources"],
        schema_types: [],
        service_terms: [],
        location_terms: [],
      }),
    );
    const p = profileFromSnapshotsAndConfig(
      pages,
      baseConfig({ address: "", phone: "" }),
    );
    expect(p.contentSiteSignal).toBe(true);
  });

  it("four pages, local terms, or a phone keep the inference safely off", () => {
    const page = (i: number, serviceTerms: string[] = []) =>
      snapshot({
        id: `snap-${i}`,
        page_id: `page-${i}`,
        url: `https://example.com/page-${i}`,
        word_count: 900,
        h2_list: ["Overview", "Details"],
        service_terms: serviceTerms,
      });
    expect(
      profileFromSnapshotsAndConfig(
        Array.from({ length: 4 }, (_, i) => page(i)),
        baseConfig({ address: "", phone: "" }),
      ).contentSiteSignal,
    ).toBe(false);
    expect(
      profileFromSnapshotsAndConfig(
        Array.from({ length: 5 }, (_, i) => page(i, ["installation"])),
        baseConfig({ address: "", phone: "" }),
      ).contentSiteSignal,
    ).toBe(false);
    expect(
      profileFromSnapshotsAndConfig(
        Array.from({ length: 5 }, (_, i) => page(i)),
        baseConfig({ address: "", phone: "555-0100" }),
      ).contentSiteSignal,
    ).toBe(false);
  });

  it("empty snapshots + empty config → empty-safe profile, no crash", () => {
    const p = profileFromSnapshotsAndConfig([], baseConfig());
    expect(p.schemaTypes).toEqual([]);
    expect(p.services).toEqual([]);
    expect(p.locations).toEqual([]);
    expect(p.contentSiteSignal).toBe(false);
  });
});

describe("deriveTenantProfile — end-to-end verdict from injected substrates", () => {
  it("content/encyclopedia fixture → content_publisher + empty serviceAreas", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [
        snapshot({ schema_types: ["Article", "WebSite"], service_terms: [] }),
      ],
      // People search it the way they read an encyclopedia — no place signal.
      loadTopQueries: async () => [
        { query: "what is nowruz", impressions: 9000 },
        { query: "history of persia", impressions: 8000 },
      ],
    });
    expect(profile.businessType).toBe("content_publisher");
    // The content-site no-op pin: a publisher carries NO service areas.
    expect(profile.serviceAreas).toEqual([]);
    expect(profile.suggestedSegment).toBe("content_publisher");
  });

  it("local presence via config address (rebuilt profile) → local_service + serviceAreas", async () => {
    // No launch profile: the nightly path rebuilds the profile from persisted
    // snapshots + config. A config address gives real physical presence.
    saveBusinessConfig(TENANT, { address: "10 Congress Ave, Austin, TX" });
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [
        snapshot({
          schema_types: ["HVACBusiness"],
          service_terms: ["ac repair", "furnace install"],
          location_terms: ["austin"],
        }),
      ],
      loadTopQueries: async () => [
        { query: "ac repair in Austin", impressions: 1200 },
        { query: "furnace install near Round Rock", impressions: 800 },
      ],
    });
    expect(profile.businessType).toBe("local_service");
    expect(profile.serviceAreas).toEqual(
      expect.arrayContaining(["Austin", "Round Rock"]),
    );
    expect(profile.services).toEqual(
      expect.arrayContaining(["ac repair", "furnace install"]),
    );
  });

  it("location_terms ALONE (no address/phone) do NOT flip a site local", async () => {
    // A region tag is not physical presence — the safe-floor pin.
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => [
        snapshot({ schema_types: ["WebSite"], location_terms: ["ca"] }),
      ],
      loadTopQueries: noQueries,
    });
    expect(profile.businessType).not.toBe("local_service");
    expect(profile.serviceAreas).toEqual([]);
  });

  it("local presence via injected launch profile → local_service + serviceAreas", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      profile: {
        name: "Acme HVAC",
        nameSource: null,
        description: null,
        industry: "hvac",
        schemaTypes: ["HVACBusiness"],
        phone: "+1-512-555-0100",
        address: "10 Congress Ave, Austin, TX",
        locations: ["austin"],
        services: ["ac repair", "furnace install"],
        keyPages: ["/"],
        socialProfiles: [],
        contentSiteSignal: false,
      },
      loadSnapshots: noSnapshots,
      loadTopQueries: async () => [
        { query: "ac repair in Austin", impressions: 1200 },
        { query: "furnace install near Round Rock", impressions: 800 },
      ],
    });
    expect(profile.businessType).toBe("local_service");
    expect(profile.suggestedSegment).toBe("local_service");
    expect(profile.serviceAreas).toEqual(
      expect.arrayContaining(["Austin", "Round Rock"]),
    );
    expect(profile.industry).toBe("hvac");
    expect(profile.services).toEqual(
      expect.arrayContaining(["ac repair", "furnace install"]),
    );
  });

  it("empty-safe: no snapshots, no queries → honest verdict, no crash", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: noSnapshots,
      loadTopQueries: noQueries,
    });
    // Nothing decisive → the safe floor, with no service areas.
    expect(profile.businessType).toBe("other");
    expect(profile.serviceAreas).toEqual([]);
    expect(profile.suggestedSegment).toBeNull();
    expect(profile.evidence.length).toBeGreaterThan(0);
  });

  it("degrades to config-only signals when a substrate read throws", async () => {
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: async () => {
        throw new Error("repo down");
      },
      loadTopQueries: async () => {
        throw new Error("gsc down");
      },
    });
    // Fail-soft: no throw, an honest verdict is still returned.
    expect(profile.businessType).toBe("other");
    expect(profile.serviceAreas).toEqual([]);
  });
});

describe("deriveTenantProfile — LLM seam is fail-soft", () => {
  // A non-local, non-content fixture whose deterministic verdict is NOT high,
  // so the LLM refinement branch is reached.
  const ambiguous = {
    tenantId: TENANT,
    loadSnapshots: noSnapshots,
    loadTopQueries: noQueries,
  };

  it("LLM that THROWS is swallowed → deterministic verdict stands", async () => {
    const llm: BusinessTypeLlm = async () => {
      throw new Error("llm exploded");
    };
    const profile = await deriveTenantProfile({ ...ambiguous, llm });
    expect(profile.businessType).toBe("other");
  });

  it("LLM that returns null → deterministic verdict stands", async () => {
    const llm: BusinessTypeLlm = async () => null;
    const profile = await deriveTenantProfile({ ...ambiguous, llm });
    expect(profile.businessType).toBe("other");
  });

  it("LLM refinement is applied when it returns a different type", async () => {
    const llm = vi.fn(async () => ({
      businessType: "saas" as const,
      confidence: "medium" as const,
    }));
    const profile = await deriveTenantProfile({ ...ambiguous, llm });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(profile.businessType).toBe("saas");
    expect(profile.evidence.join(" ")).toContain("double-checked");
  });

  it("LLM is NOT consulted for a high-confidence deterministic verdict", async () => {
    const llm = vi.fn(async () => ({
      businessType: "saas" as const,
      confidence: "high" as const,
    }));
    // Inject a high-confidence local profile (address → high).
    await deriveTenantProfile({
      tenantId: TENANT,
      profile: {
        name: null,
        nameSource: null,
        description: null,
        industry: null,
        schemaTypes: [],
        phone: null,
        address: "1 Main St",
        locations: [],
        services: [],
        keyPages: [],
        socialProfiles: [],
        contentSiteSignal: false,
      },
      loadSnapshots: noSnapshots,
      loadTopQueries: noQueries,
      llm,
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it("does not touch the network by default (default llm is a no-op)", async () => {
    // No llm injected → the default NO_LLM returns null; verdict is heuristic.
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      loadSnapshots: noSnapshots,
      loadTopQueries: noQueries,
    });
    expect(profile.businessType).toBe("other");
  });
});

describe("deriveTenantProfile — reads real config for industry fallback", () => {
  it("falls back to config.industry when the profile has none", async () => {
    saveBusinessConfig(TENANT, { industry: "landscaping" });
    const profile = await deriveTenantProfile({
      tenantId: TENANT,
      profile: {
        name: null,
        nameSource: null,
        description: null,
        industry: null, // profile has no industry
        schemaTypes: [],
        phone: null,
        address: null,
        locations: [],
        services: [],
        keyPages: [],
        socialProfiles: [],
        contentSiteSignal: false,
      },
      loadSnapshots: noSnapshots,
      loadTopQueries: noQueries,
    });
    expect(profile.industry).toBe("landscaping");
  });
});
