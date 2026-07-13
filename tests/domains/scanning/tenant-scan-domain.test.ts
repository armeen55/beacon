import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeTenantScanDomain } from "@/domains/scanning/orchestrate-scan";

const SOURCE = readFileSync(
  join(process.cwd(), "src/domains/scanning/orchestrate-scan.ts"),
  "utf8",
);

describe("tenant-explicit scan domain", () => {
  it("normalizes a tenant host without accepting URL-shaped crawl scope", () => {
    expect(normalizeTenantScanDomain("WWW.Example.com")).toBe("example.com");
    expect(normalizeTenantScanDomain("https://www.example.com/")).toBe(
      "example.com",
    );
    expect(normalizeTenantScanDomain("https://example.com/private")).toBeNull();
    expect(
      normalizeTenantScanDomain("https://user:pass@example.com"),
    ).toBeNull();
    expect(normalizeTenantScanDomain("example.com:8443")).toBeNull();
    expect(normalizeTenantScanDomain("localhost")).toBeNull();
    expect(normalizeTenantScanDomain(" ")).toBeNull();
  });

  it("keeps sequential tenant resolutions independent", () => {
    expect([
      normalizeTenantScanDomain("iranopedia.com"),
      normalizeTenantScanDomain("ritzbuild.com"),
      normalizeTenantScanDomain("iranopedia.com"),
    ]).toEqual(["iranopedia.com", "ritzbuild.com", "iranopedia.com"]);
  });

  it("threads one explicit domain through crawl and finding generation", () => {
    expect(SOURCE).toContain("BEACON_SITE_DOMAIN: siteDomain");
    expect(SOURCE).toMatch(
      /regenerateScanFindings\(\{[\s\S]*?tenantId,[\s\S]*?siteDomain,/,
    );
    expect(SOURCE).not.toContain("getSiteConfig");
    expect(SOURCE).not.toContain("resolveBeaconSiteDomainForScan");
  });
});
