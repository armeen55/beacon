import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveBeaconSiteDomainForScan } from "@/domains/scanning/scan-site-domain";

describe("resolveBeaconSiteDomainForScan", () => {
  const pagesPath = join(process.cwd(), ".data", "pages.json");

  beforeEach(() => {
    delete process.env.BEACON_SITE_DOMAIN;
  });

  afterEach(() => {
    delete process.env.BEACON_SITE_DOMAIN;
  });

  it("prefers BEACON_SITE_DOMAIN when set", () => {
    process.env.BEACON_SITE_DOMAIN = "WWW.FOO.COM";
    expect(resolveBeaconSiteDomainForScan()).toBe("foo.com");
  });

  it("infers from pages registry when env unset and workspace has owned pages", () => {
    if (!existsSync(pagesPath)) return;
    expect(resolveBeaconSiteDomainForScan()).toBe("ritzbuilders.com");
  });
});
