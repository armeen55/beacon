/**
 * launch-config — North-star ACCEPTANCE chain (2026-06-11).
 *
 * The full composed path a stranger triggers by clicking Launch:
 * URL → polite fetch (injected) → derived profile → typed-beats-derived
 * config → saveBusinessConfig. Pins:
 *   - a brand-new tenant created with ONLY a URL yields a complete,
 *     correct config (industry/phone/services/keyPages derived from the
 *     SITE) with ZERO Bay-Area/builder leakage,
 *   - typed wizard fields beat derived ones,
 *   - an unreachable site still persists a typed-fields config
 *     (failure-soft — an active tenant never runs on the placeholder),
 *   - launch is the scan opt-in (enabled: true), timezone stays UTC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncBusinessConfig: vi.fn(async () => {}),
  syncTenantBusinessConfig: vi.fn(async () => {}),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-launch-config-test"),
}));

import {
  deriveAndPersistTenantConfig,
  suggestSegmentFromProfile,
} from "./launch-config";
import {
  getBusinessConfig,
  __resetBusinessConfigCacheForTests,
} from "@/lib/business-config";

const TENANT = "tenant-launch-config-test";
const TENANT_DIR = join(process.cwd(), ".data", "tenants", TENANT);

const TUCSON_RESTAURANT_HTML = `<!doctype html><html><head>
<title>La Palma Taqueria | Tucson's Taqueria</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "La Palma Taqueria",
  "telephone": "+1-520-555-0199",
  "address": {"@type": "PostalAddress", "addressLocality": "Tucson", "addressRegion": "AZ"},
  "areaServed": ["Tucson", "Oro Valley"],
  "sameAs": ["https://www.yelp.com/biz/la-palma-tucson"]
}
</script></head><body>
<header><nav>
  <a href="/">Home</a>
  <a href="/catering">Catering</a>
  <a href="/taco-bar">Taco Bar</a>
  <a href="/about">About</a>
</nav></header>
</body></html>`;

function fetchFor(routes: Record<string, string | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) return new Response("nf", { status: 404 });
    if (typeof route === "number") return new Response("", { status: route });
    return new Response(route, { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetBusinessConfigCacheForTests();
});
afterEach(() => {
  rmSync(TENANT_DIR, { recursive: true, force: true });
  __resetBusinessConfigCacheForTests();
});

describe("deriveAndPersistTenantConfig — URL-only acceptance", () => {
  it("persists a complete derived config for a site Beacon has never seen", async () => {
    const fetchImpl = fetchFor({
      "https://lapalma.com/robots.txt": 404,
      "https://lapalma.com/": TUCSON_RESTAURANT_HTML,
    });
    const result = await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "lapalma.com",
      typedName: "La Palma Taqueria",
      typedCities: [],
      fetchImpl,
    });

    expect(result.outcome).toBe("derived_and_saved");
    expect(existsSync(join(TENANT_DIR, "business-config.json"))).toBe(true);

    // Survives a restart: resolve from disk with a cold cache.
    __resetBusinessConfigCacheForTests();
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.name).toBe("La Palma Taqueria");
    expect(cfg.domain).toBe("lapalma.com");
    expect(cfg.industry).toBe("restaurant");
    expect(cfg.phone).toBe("+1-520-555-0199");
    expect(cfg.locations).toEqual(
      expect.arrayContaining(["Tucson", "AZ", "Oro Valley"]),
    );
    expect(cfg.services).toEqual(
      expect.arrayContaining(["catering", "taco bar"]),
    );
    expect(cfg.keyPages).toEqual(
      expect.arrayContaining(["/", "/catering", "/taco-bar"]),
    );
    expect(cfg.scanSettings.enabled).toBe(true); // launch IS the opt-in
    expect(cfg.scanSettings.timezone).toBe("UTC"); // never a geo guess

    // ZERO leakage from any other tenant's vertical/geo.
    const flat = JSON.stringify(cfg).toLowerCase();
    for (const banned of ["palo alto", "menlo park", "atherton", "bay area", "ritz", "custom home"]) {
      expect(flat).not.toContain(banned);
    }
  });

  it("typed wizard fields BEAT derived values", async () => {
    const fetchImpl = fetchFor({
      "https://lapalma.com/robots.txt": 404,
      "https://lapalma.com/": TUCSON_RESTAURANT_HTML,
    });
    await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "lapalma.com",
      typedName: "La Palma Tacos & Cantina", // human's spelling wins
      typedCities: ["Marana"],
      fetchImpl,
    });
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.name).toBe("La Palma Tacos & Cantina");
    expect(cfg.locations[0]).toBe("Marana"); // typed cities lead
    expect(cfg.locations).toEqual(expect.arrayContaining(["Tucson"]));
  });

  it("unreachable site → typed-fields config still persisted (failure-soft)", async () => {
    const fetchImpl = fetchFor({
      "https://downsite.com/robots.txt": 404,
      "https://downsite.com/": 500,
    });
    const result = await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "downsite.com",
      typedName: "Down Site Co",
      typedCities: ["Reno"],
      fetchImpl,
    });
    expect(result.outcome).toBe("typed_only_saved");
    const cfg = getBusinessConfig(TENANT);
    expect(cfg.name).toBe("Down Site Co");
    expect(cfg.domain).toBe("downsite.com");
    expect(cfg.locations).toEqual(["Reno"]);
    expect(cfg.industry).toBe(""); // honest blank — nothing invented
  });

  it("unusable domain → skipped (defensive; wizard validates upstream)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await deriveAndPersistTenantConfig({
      tenantId: TENANT,
      domain: "???",
      fetchImpl,
    });
    expect(result.outcome).toBe("skipped_no_domain");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("suggestSegmentFromProfile — site signals → segment", () => {
  it("article schema + no address → content_publisher", () => {
    const p = deriveBusinessProfileFixture({ contentSiteSignal: true });
    expect(suggestSegmentFromProfile(p)).toBe("content_publisher");
  });
  it("physical presence (address/phone/locations) → local_service", () => {
    expect(
      suggestSegmentFromProfile(
        deriveBusinessProfileFixture({ address: "1 Main St, Tucson, AZ" }),
      ),
    ).toBe("local_service");
    expect(
      suggestSegmentFromProfile(deriveBusinessProfileFixture({ phone: "555" })),
    ).toBe("local_service");
    expect(
      suggestSegmentFromProfile(
        deriveBusinessProfileFixture({ locations: ["tucson"] }),
      ),
    ).toBe("local_service");
  });
  it("ambiguous site → null (provisioning default stands)", () => {
    expect(suggestSegmentFromProfile(deriveBusinessProfileFixture({}))).toBeNull();
    expect(suggestSegmentFromProfile(null)).toBeNull();
  });
});

function deriveBusinessProfileFixture(
  over: Partial<import("./derive-business-profile").DerivedBusinessProfile>,
): import("./derive-business-profile").DerivedBusinessProfile {
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
