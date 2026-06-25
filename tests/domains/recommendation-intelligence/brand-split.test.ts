import { describe, it, expect } from "vitest";

import { splitBrandedTraffic, brandTokens } from "@/app/(shell)/today-brand-split-rows";

const q = (query: string, clicks: number, impressions = clicks * 10) => ({ query, clicks, impressions });

describe("brandTokens", () => {
  it("tokenizes name + domain, drops generic + short tokens", () => {
    expect(brandTokens(["Ritz Builders", "ritzbuilders.com"]).sort()).toEqual(["builders", "ritz", "ritzbuilders"]);
    expect(brandTokens(["iranopedia.com"])).toEqual(["iranopedia"]);
  });
});

describe("splitBrandedTraffic", () => {
  it("partitions branded vs discovery and computes discovery click share", () => {
    const s = splitBrandedTraffic(
      [q("iranopedia", 100), q("iranopedia farsi", 50), q("persian boy names", 200), q("nowruz traditions", 150)],
      ["iranopedia.com"],
    );
    expect(s.branded.clicks).toBe(150); // iranopedia + iranopedia farsi
    expect(s.discovery.clicks).toBe(350); // the two topic queries
    expect(s.discoveryClicksPct).toBe(70);
    expect(s.topDiscovery[0]!.query).toBe("persian boy names"); // biggest discovery
  });

  it("treats everything as discovery when no brand seeds", () => {
    const s = splitBrandedTraffic([q("a", 10), q("b", 5)], []);
    expect(s.discovery.clicks).toBe(15);
    expect(s.branded.clicks).toBe(0);
    expect(s.discoveryClicksPct).toBe(100);
  });

  it("is empty-safe", () => {
    const s = splitBrandedTraffic([], ["brand"]);
    expect(s.discoveryClicksPct).toBe(0);
    expect(s.topDiscovery).toHaveLength(0);
  });
});
