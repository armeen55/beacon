import { afterEach, describe, expect, it } from "vitest";
import { __resetBusinessConfigCacheForTests } from "./business-config";
import { getSiteConfig, resetSiteConfigCache } from "./site-config";

const previous = process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;

afterEach(() => {
  if (previous === undefined) delete process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT;
  else process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT = previous;
  __resetBusinessConfigCacheForTests();
  resetSiteConfigCache();
});

describe("tenant-keyed site config", () => {
  it("keeps two tenants' domain and brand isolated in one process", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON_BY_TENANT = JSON.stringify({
      "tenant-a": { name: "Alpha", domain: "alpha.example" },
      "tenant-b": { name: "Beta", domain: "beta.example" },
    });
    __resetBusinessConfigCacheForTests();
    resetSiteConfigCache();

    expect(getSiteConfig("tenant-a")).toMatchObject({
      siteDomain: "alpha.example",
      siteOrigin: "https://alpha.example",
      ownedBrandShort: "Alpha",
    });
    expect(getSiteConfig("tenant-b")).toMatchObject({
      siteDomain: "beta.example",
      siteOrigin: "https://beta.example",
      ownedBrandShort: "Beta",
    });
  });
});
