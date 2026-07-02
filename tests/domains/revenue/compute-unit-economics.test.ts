import { describe, it, expect } from "vitest";

import {
  computeUnitEconomicsFacts,
  isUsableRevenueModel,
  pagePathFromUrl,
  UNIT_ECONOMICS_BASIS,
  type Ga4DailyTrafficRow,
} from "@/domains/revenue/compute-unit-economics";

const BANNED_DASH = /[‒–—―]/;

const row = (over: Partial<Ga4DailyTrafficRow>): Ga4DailyTrafficRow => ({
  url: "https://example.com/page-a",
  date: "2026-06-30",
  sessions: 0,
  conversions: 0,
  ...over,
});

describe("pagePathFromUrl", () => {
  it("extracts the path from a full URL and strips query/hash", () => {
    expect(pagePathFromUrl("https://example.com/best-recipes?utm=x#top")).toBe("/best-recipes");
    expect(pagePathFromUrl("https://example.com")).toBe("/");
  });

  it("keeps a bare path and ensures a leading slash", () => {
    expect(pagePathFromUrl("/services/remodel")).toBe("/services/remodel");
    expect(pagePathFromUrl("services/remodel?x=1")).toBe("/services/remodel");
    expect(pagePathFromUrl("")).toBe("/");
  });
});

describe("isUsableRevenueModel", () => {
  it("requires a finite positive rate for the chosen kind", () => {
    expect(isUsableRevenueModel(undefined)).toBe(false);
    expect(isUsableRevenueModel({ kind: "rpm" })).toBe(false);
    expect(isUsableRevenueModel({ kind: "rpm", rpmUsd: 0 })).toBe(false);
    expect(isUsableRevenueModel({ kind: "rpm", rpmUsd: -5 })).toBe(false);
    expect(isUsableRevenueModel({ kind: "rpm", rpmUsd: 18.5 })).toBe(true);
    expect(isUsableRevenueModel({ kind: "per_lead" })).toBe(false);
    expect(isUsableRevenueModel({ kind: "per_lead", dollarsPerLead: 150 })).toBe(true);
    // A rate on the WRONG field does not activate the model.
    expect(isUsableRevenueModel({ kind: "per_lead", rpmUsd: 150 })).toBe(false);
  });
});

describe("computeUnitEconomicsFacts - rpm", () => {
  it("computes sessions / 1000 x rpm, rounded to cents", () => {
    const facts = computeUnitEconomicsFacts({
      tenantId: "tenant-x",
      rows: [row({ sessions: 2500 })],
      model: { kind: "rpm", rpmUsd: 20 },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      tenant_id: "tenant-x",
      page_path: "/page-a",
      day: "2026-06-30",
      source: "unit_economics",
      revenue_usd: 50,
      basis: UNIT_ECONOMICS_BASIS,
    });
    expect(facts[0]!.metadata).toEqual({ sessions: 2500, rpm_usd: 20 });
  });

  it("rounds to cents (137 sessions at $18.50 rpm = $2.53)", () => {
    const facts = computeUnitEconomicsFacts({
      tenantId: "t",
      rows: [row({ sessions: 137 })],
      model: { kind: "rpm", rpmUsd: 18.5 },
    });
    expect(facts[0]!.revenue_usd).toBe(2.53);
  });

  it("drops rows that compute to zero dollars", () => {
    const facts = computeUnitEconomicsFacts({
      tenantId: "t",
      rows: [row({ sessions: 0 }), row({ url: "https://example.com/b", sessions: 1000 })],
      model: { kind: "rpm", rpmUsd: 20 },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.page_path).toBe("/b");
  });
});

describe("computeUnitEconomicsFacts - per_lead", () => {
  it("computes key events x dollars per lead", () => {
    const facts = computeUnitEconomicsFacts({
      tenantId: "tenant-x",
      rows: [row({ conversions: 3 })],
      model: { kind: "per_lead", dollarsPerLead: 150 },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.revenue_usd).toBe(450);
    expect(facts[0]!.source).toBe("unit_economics");
    expect(facts[0]!.metadata).toEqual({ key_events: 3, dollars_per_lead: 150 });
  });

  it("high traffic with zero key events produces NO dollars (never fakes leads)", () => {
    const facts = computeUnitEconomicsFacts({
      tenantId: "t",
      rows: [row({ sessions: 50_000, conversions: 0 })],
      model: { kind: "per_lead", dollarsPerLead: 500 },
    });
    expect(facts).toHaveLength(0);
  });
});

describe("computeUnitEconomicsFacts - idempotent upsert shape", () => {
  const rows = [
    // Two stored urls normalize to ONE path on the same day -> one fact.
    row({ url: "https://example.com/a?utm=1", sessions: 400 }),
    row({ url: "https://example.com/a", sessions: 600 }),
    row({ url: "https://example.com/b", date: "2026-06-29", sessions: 1000 }),
  ];
  const model = { kind: "rpm" as const, rpmUsd: 10 };

  it("aggregates url variants into one (page, day) fact", () => {
    const facts = computeUnitEconomicsFacts({ tenantId: "t", rows, model });
    const a = facts.find((f) => f.page_path === "/a");
    expect(a!.revenue_usd).toBe(10); // (400 + 600) / 1000 * 10
  });

  it("emits each PK tuple (tenant, page, day, source) exactly once, deterministically ordered", () => {
    const first = computeUnitEconomicsFacts({ tenantId: "t", rows, model });
    const second = computeUnitEconomicsFacts({ tenantId: "t", rows: [...rows].reverse(), model });
    expect(second).toEqual(first); // same rows regardless of input order -> re-upsert is a no-op
    const keys = first.map((f) => `${f.tenant_id}|${f.page_path}|${f.day}|${f.source}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(first.map((f) => f.day)).toEqual([...first.map((f) => f.day)].sort());
  });

  it("returns [] for an unusable model instead of guessing", () => {
    expect(
      computeUnitEconomicsFacts({ tenantId: "t", rows, model: { kind: "rpm" } }),
    ).toEqual([]);
  });
});

describe("honesty labels", () => {
  it("the unit-economics basis is the honest phrase and never claims measurement", () => {
    expect(UNIT_ECONOMICS_BASIS).toBe("your rate x real traffic");
    expect(UNIT_ECONOMICS_BASIS.toLowerCase()).not.toContain("measured");
    expect(BANNED_DASH.test(UNIT_ECONOMICS_BASIS)).toBe(false);
  });
});
