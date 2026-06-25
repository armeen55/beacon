import { describe, it, expect } from "vitest";
import { isDemandGraphEnabledForTenant } from "@/domains/demand-graph/flag";

const env = (v?: string) => ({ ...(v === undefined ? {} : { BEACON_DEMAND_GRAPH_RECS: v }) }) as NodeJS.ProcessEnv;

describe("isDemandGraphEnabledForTenant — tenant isolation", () => {
  it("unset / empty / false → OFF for everyone", () => {
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", env())).toBe(false);
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", env(""))).toBe(false);
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", env("false"))).toBe(false);
  });

  it('"true" → ON for all tenants', () => {
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", env("true"))).toBe(true);
    expect(isDemandGraphEnabledForTenant("tenant-ritz-founder", env("true"))).toBe(true);
  });

  it("tenant allowlist enables ONLY the listed tenants (Iranopedia, not Ritz)", () => {
    const e = env("tenant-iranopedia");
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", e)).toBe(true);
    expect(isDemandGraphEnabledForTenant("tenant-ritz-founder", e)).toBe(false);
    expect(isDemandGraphEnabledForTenant("tenant-finglish", e)).toBe(false);
  });

  it("comma-separated allowlist + whitespace tolerance", () => {
    const e = env(" tenant-iranopedia , tenant-finglish ");
    expect(isDemandGraphEnabledForTenant("tenant-iranopedia", e)).toBe(true);
    expect(isDemandGraphEnabledForTenant("tenant-finglish", e)).toBe(true);
    expect(isDemandGraphEnabledForTenant("tenant-ritz-founder", e)).toBe(false);
  });
});
