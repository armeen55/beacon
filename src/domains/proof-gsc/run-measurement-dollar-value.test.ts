import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Loader-join contract for the change-level dollar attribution (BEACON_500
 * item 22): measureRecord composes the already-computed GA4 traffic outcome
 * with the operator's own unit-economics rate (item 3) via
 * computeChangeDollarValue (pure math, tested separately in
 * tests/domains/proof-gsc/change-dollar-value.test.ts).
 *
 * This file pins the WIRING: no revenue model -> dollarValue still attaches
 * with a clicks-only sentence; a revenue model -> the dollars match the
 * GA4-derived sessions/conversions delta; a GA4 read failure never touches
 * the GSC verdict (same fail-soft contract as trafficOutcome itself).
 *
 * gsc-window / ga4-window / citation-window / business-config all hit
 * Supabase or env directly, so they are mocked at the module boundary the
 * way run-measurement.test.ts already mocks I/O modules.
 */

const gscWindow = { clicks: 100, impressions: 1000, ctr: 0.1, position: 8 };

vi.mock("./gsc-window", () => ({
  readWindowForPages: vi.fn(async () => new Map([["https://iranopedia.com/singers", gscWindow]])),
  readLastFinalizedDate: vi.fn(async () => "2026-07-01"),
}));

const { ga4WindowMock, latestGa4Mock } = vi.hoisted(() => ({
  ga4WindowMock: vi.fn(),
  latestGa4Mock: vi.fn(),
}));

vi.mock("./ga4-window", () => ({
  readGa4WindowForPages: ga4WindowMock,
  readLatestGa4Date: latestGa4Mock,
}));

vi.mock("./citation-window", () => ({
  computeCitationOutcomeForRecord: vi.fn(async () => null),
}));

vi.mock("@/domains/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: vi.fn(async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() })),
  assemblePacketForUrl: vi.fn(() => ({ gsc: null })),
}));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/bridge", () => ({
  loadPageSurgeonForUrl: vi.fn(async () => ({ status: "none" })),
}));

vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: vi.fn(async () => []),
}));

const { businessConfigMock, hydrateMock } = vi.hoisted(() => ({
  businessConfigMock: vi.fn(),
  hydrateMock: vi.fn(),
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: businessConfigMock,
  hydrateBusinessConfigFromSupabase: hydrateMock,
}));

import { measureRecord } from "./run-measurement";
import type { ShippedChangeRecord } from "./shipped-change-store";

function record(overrides: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "singers::2026-05-01",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "old title",
    after: "new title",
    shippedAt: "2026-05-01",
    baseline: { clicks: 50, impressions: 800, ctr: 0.06, position: 12, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

const treatedPage = "https://iranopedia.com/singers";

describe("measureRecord - change-level dollar attribution (item 22)", () => {
  beforeEach(() => {
    ga4WindowMock.mockReset();
    latestGa4Mock.mockReset();
    businessConfigMock.mockReset();
    hydrateMock.mockReset();
    // Default: full 28-day post window has elapsed, treated page gained
    // sessions/conversions, no controls (isolates the treated-page math).
    latestGa4Mock.mockResolvedValue("2026-05-29"); // 28 full days after ship
    ga4WindowMock.mockImplementation(async ({ start, end }: { start: string; end: string }) => {
      // Pre window call spans [ship-28d, ship); post window spans [ship, ship+28d).
      const isPost = start === "2026-05-01";
      if (isPost) {
        return new Map([[treatedPage, { sessions: 400, engagedSessions: 300, conversions: 8 }]]);
      }
      return new Map([[treatedPage, { sessions: 100, engagedSessions: 80, conversions: 2 }]]);
    });
  });

  it("attaches a clicks-only dollarValue when no revenue model is configured", async () => {
    businessConfigMock.mockReturnValue({ revenueModel: undefined });
    hydrateMock.mockResolvedValue(null);

    const now = new Date("2026-05-30T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(result.trafficOutcome?.ran).toBe(true);
    expect(result.dollarValue).not.toBeNull();
    expect(result.dollarValue?.usdPerMonth).toBeNull();
    expect(result.dollarValue?.basisSentence).not.toMatch(/\$/);
    expect(result.dollarValue?.basisSentence).not.toMatch(/[–—]/);
  });

  it("multiplies the GA4-derived sessions delta by the operator's rpm rate", async () => {
    businessConfigMock.mockReturnValue({ revenueModel: { kind: "rpm", rpmUsd: 10 } });
    hydrateMock.mockResolvedValue({ revenueModel: { kind: "rpm", rpmUsd: 10 } });

    const now = new Date("2026-05-30T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    // sessionsDelta = 400 - 100 = 300 over a 28-day window -> ~321.4/month;
    // *10/1000 ≈ 3.21. Just assert it is a real positive number tied to the
    // rate, not a hardcoded constant.
    expect(result.dollarValue?.usdPerMonth).not.toBeNull();
    expect(result.dollarValue!.usdPerMonth as number).toBeGreaterThan(0);
    expect(result.dollarValue?.basisSentence).toMatch(/\$/);
    expect(result.dollarValue?.basisSentence).toMatch(/your rate of \$10/);
  });

  it("multiplies the GA4-derived key-event delta by the operator's per_lead rate", async () => {
    businessConfigMock.mockReturnValue({ revenueModel: { kind: "per_lead", dollarsPerLead: 50 } });
    hydrateMock.mockResolvedValue({ revenueModel: { kind: "per_lead", dollarsPerLead: 50 } });

    const now = new Date("2026-05-30T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    // conversionsDelta = 8 - 2 = 6 over 28 days -> ~6.43/month; * 50 ≈ 321.
    expect(result.dollarValue?.usdPerMonth).not.toBeNull();
    expect(result.dollarValue!.usdPerMonth as number).toBeGreaterThan(0);
    expect(result.dollarValue?.basisSentence).toMatch(/\$50 per lead/);
  });

  it("never mutates the GSC verdict/windows regardless of the dollar figure", async () => {
    businessConfigMock.mockReturnValue({ revenueModel: { kind: "rpm", rpmUsd: 10 } });
    hydrateMock.mockResolvedValue(null);

    const now = new Date("2026-05-30T00:00:00Z");
    const withModel = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    businessConfigMock.mockReturnValue({ revenueModel: undefined });
    const withoutModel = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(withModel.verdict).toBe(withoutModel.verdict);
    expect(withModel.confidence).toBe(withoutModel.confidence);
    expect(withModel.windows).toEqual(withoutModel.windows);
  });

  it("is fail-soft: a business-config throw never blocks measurement or leaves a stale value", async () => {
    businessConfigMock.mockImplementation(() => {
      throw new Error("config store down");
    });
    hydrateMock.mockRejectedValue(new Error("config store down"));

    const now = new Date("2026-05-30T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(result.dollarValue).toBeNull();
    expect(result.verdict).toBeDefined();
  });

  it("is null (not a projected number) while the post window has not run yet", async () => {
    latestGa4Mock.mockResolvedValue(null); // no GA4 day since ship
    businessConfigMock.mockReturnValue({ revenueModel: { kind: "rpm", rpmUsd: 10 } });
    hydrateMock.mockResolvedValue(null);

    const now = new Date("2026-05-02T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(result.trafficOutcome?.ran).toBe(false);
    expect(result.dollarValue).toBeNull();
  });

  it("tracks the CONTROL-ADJUSTED lift, not the raw pre/post delta, when a control page moved too", async () => {
    // Reproduces a real Iranopedia shape: the treated page's raw sessions
    // FELL (87 -> 76), but its comparison page fell even further, so the
    // control-adjusted lift is a genuine positive win. dollarValue must
    // read positive here (matching trafficOutcome.label's own "+X% vs
    // similar pages" line), never the raw negative delta.
    const controlPage = "https://iranopedia.com/other-page";
    ga4WindowMock.mockImplementation(async ({ start }: { start: string }) => {
      const isPost = start === "2026-05-01";
      if (isPost) {
        return new Map([
          [treatedPage, { sessions: 76, engagedSessions: 60, conversions: 0 }],
          [controlPage, { sessions: 63, engagedSessions: 50, conversions: 0 }],
        ]);
      }
      return new Map([
        [treatedPage, { sessions: 87, engagedSessions: 70, conversions: 0 }],
        [controlPage, { sessions: 87, engagedSessions: 70, conversions: 0 }],
      ]);
    });
    businessConfigMock.mockReturnValue({ revenueModel: { kind: "rpm", rpmUsd: 10 } });
    hydrateMock.mockResolvedValue(null);

    const now = new Date("2026-05-30T00:00:00Z");
    const result = await measureRecord(
      "tenant-iranopedia",
      record({ controlPages: [controlPage] }),
      now,
      "2026-07-01",
    );

    // Sanity: the treated page's OWN raw sessions fell.
    expect(result.trafficOutcome?.treated.sessionsPost).toBeLessThan(
      result.trafficOutcome?.treated.sessionsPre ?? 0,
    );
    // But the control-adjusted lift is positive (treated fell less than the
    // control), so the dollar figure must be positive too, not negative.
    expect(result.trafficOutcome?.adjustedSessionsPct).not.toBeNull();
    expect(result.trafficOutcome!.adjustedSessionsPct as number).toBeGreaterThan(0);
    expect(result.dollarValue?.usdPerMonth).not.toBeNull();
    expect(result.dollarValue!.usdPerMonth as number).toBeGreaterThan(0);
  });
});
