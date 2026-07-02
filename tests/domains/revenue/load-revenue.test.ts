import { describe, it, expect } from "vitest";

import {
  combinedBasisPhrase,
  mapRevenueFactRow,
  revenueBasisPhrase,
  summarizeRevenueByDay,
  summarizeRevenueByPage,
  type RevenueFact,
} from "@/domains/revenue/load-revenue";
import { fetchAdNetworkRevenueForTenant, AD_NETWORK_PROVIDERS } from "@/lib/connectors/adnetwork/registry";

const BANNED_DASH = /[‒–—―]/;

const fact = (over: Partial<RevenueFact>): RevenueFact => ({
  pagePath: "/a",
  day: "2026-06-30",
  source: "unit_economics",
  revenueUsd: 10,
  basis: "your rate x real traffic",
  ...over,
});

describe("mapRevenueFactRow", () => {
  it("maps a raw row and coerces numeric strings", () => {
    expect(
      mapRevenueFactRow({
        page_path: "/a",
        day: "2026-06-30",
        source: "unit_economics",
        revenue_usd: "12.34",
        basis: "your rate x real traffic",
      }),
    ).toEqual({
      pagePath: "/a",
      day: "2026-06-30",
      source: "unit_economics",
      revenueUsd: 12.34,
      basis: "your rate x real traffic",
    });
  });

  it("drops unknown sources and non-numeric dollars instead of guessing", () => {
    expect(
      mapRevenueFactRow({ page_path: "/a", day: "2026-06-30", source: "mystery", revenue_usd: 5, basis: "" }),
    ).toBeNull();
    expect(
      mapRevenueFactRow({ page_path: "/a", day: "2026-06-30", source: "ad_network", revenue_usd: "abc", basis: "measured" }),
    ).toBeNull();
  });
});

describe("honest basis labels", () => {
  it("estimated sources never read as measured; measured sources do", () => {
    expect(revenueBasisPhrase("unit_economics")).toBe("your rate x real traffic");
    expect(revenueBasisPhrase("unit_economics").toLowerCase()).not.toContain("measured");
    expect(revenueBasisPhrase("operator_manual").toLowerCase()).not.toContain("measured");
    expect(revenueBasisPhrase("ad_network").toLowerCase()).toContain("measured");
    expect(revenueBasisPhrase("affiliate").toLowerCase()).toContain("measured");
  });

  it("combined phrase: measured only stays measured, any estimate is disclosed", () => {
    expect(combinedBasisPhrase(["ad_network"])).toBe("measured");
    expect(combinedBasisPhrase(["ad_network", "affiliate"])).toBe("measured");
    expect(combinedBasisPhrase(["unit_economics"])).toBe("your rate x real traffic");
    expect(combinedBasisPhrase(["ad_network", "unit_economics"])).toBe(
      "part measured, part your rate x real traffic",
    );
  });

  it("no banned dash in any label", () => {
    const sources = ["ad_network", "unit_economics", "affiliate", "operator_manual"] as const;
    for (const s of sources) expect(BANNED_DASH.test(revenueBasisPhrase(s))).toBe(false);
    expect(BANNED_DASH.test(combinedBasisPhrase([...sources]))).toBe(false);
  });
});

describe("summarizeRevenueByPage / ByDay", () => {
  const facts = [
    fact({ pagePath: "/a", day: "2026-06-29", revenueUsd: 10 }),
    fact({ pagePath: "/a", day: "2026-06-30", revenueUsd: 5.5 }),
    fact({ pagePath: "/b", day: "2026-06-30", revenueUsd: 2, source: "ad_network", basis: "measured" }),
  ];

  it("aggregates per page with day counts, sources, and an honest phrase", () => {
    const byPage = summarizeRevenueByPage(facts);
    expect(byPage.get("/a")).toEqual({
      pagePath: "/a",
      revenueUsd: 15.5,
      days: 2,
      sources: ["unit_economics"],
      basisPhrase: "your rate x real traffic",
    });
    expect(byPage.get("/b")!.basisPhrase).toBe("measured");
  });

  it("aggregates per day ascending with the day's source mix", () => {
    const byDay = summarizeRevenueByDay(facts);
    expect(byDay.map((d) => d.day)).toEqual(["2026-06-29", "2026-06-30"]);
    expect(byDay[1]).toEqual({
      day: "2026-06-30",
      revenueUsd: 7.5,
      sources: ["ad_network", "unit_economics"],
    });
  });
});

describe("ad-network slot ships dark (fail closed)", () => {
  it("every registered provider reports not_connected", async () => {
    expect(AD_NETWORK_PROVIDERS.length).toBeGreaterThan(0);
    for (const p of AD_NETWORK_PROVIDERS) {
      const r = await p.fetchDailyRevenue({ tenantId: "t", startDate: "2026-06-01", endDate: "2026-06-30" });
      expect(r.connected).toBe(false);
    }
    const combined = await fetchAdNetworkRevenueForTenant({
      tenantId: "t",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(combined).toEqual({ connected: false, provider: null, reason: "not_connected" });
  });
});
