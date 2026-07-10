/**
 * load-monthly-pulse (P0-A truth fix, 2026-07-10) - architecture pins for the monthly
 * north-star loader after the non-additive GA4 sitewide-visits total was withdrawn:
 *   - the loader NEVER calls the summing ga4_monthly_sessions RPC (or any .rpc) and never
 *     touches the per-(url,date) GA4 table - a durable source pin so Wave 2 replaces it
 *     rather than quietly re-wiring the inflated sum back in;
 *   - the ONLY series it reads is the property-grain GSC daily totals, scoped to the
 *     tenant it was asked about (two-tenant isolation);
 *   - the returned view model carries the honest reconciliation state, no visits number,
 *     and never grades a visits goal from clicks;
 *   - no GSC data -> null so the card self-hides (never a bare zero).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const daily = vi.fn();
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadDailyTotalsForTenant: (...args: unknown[]) => daily(...args),
}));
const recon = vi.fn();
vi.mock("@/domains/north-star/ga4-sitewide-rollup", () => ({
  loadReconciledVisitsForTenant: (...args: unknown[]) => recon(...args),
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

import { loadMonthlyPulseForTenant } from "./load-monthly-pulse";

beforeEach(() => {
  daily.mockReset();
  recon.mockReset();
  // Default: no passing reconciliation -> the shipped hold-back stays.
  recon.mockResolvedValue({ status: "none" });
});

describe("loadMonthlyPulseForTenant (P0-A architecture pins)", () => {
  it("SOURCE PIN: the loader never calls an RPC and never reads the per-(url,date) GA4 table", () => {
    const src = readFileSync(resolve(__dirname, "load-monthly-pulse.ts"), "utf8");
    // No summed-page-rows path: no RPC call at all, and no reference to the GA4 URL table.
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toContain("ga4_url_traffic");
    expect(src).not.toContain("getSupabaseAdmin");
  });

  it("reads ONLY the property-grain GSC daily totals, scoped to the asked-for tenant", async () => {
    daily.mockResolvedValue([
      { date: "2026-05-10", clicks: 2000, impressions: 200000 },
      { date: "2026-05-20", clicks: 2100, impressions: 200000 },
      { date: "2026-06-10", clicks: 3004, impressions: 351000 },
      { date: "2026-07-02", clicks: 730, impressions: 90000 },
    ]);
    const now = new Date("2026-07-09T12:00:00Z");
    const pulse = await loadMonthlyPulseForTenant("tenant-a", 10000, now);
    // isolation: the GSC read was scoped to the tenant we asked about, no other tenant.
    expect(daily).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledWith("tenant-a", expect.any(Number));

    expect(pulse).not.toBeNull();
    // honest state present; no disputed visits number; goal never graded from clicks.
    expect(pulse!.reconciliationLine).toContain("Monthly visits need reconciliation");
    expect(pulse!.headline).toBe("June: 3,004 clicks from Google search.");
    expect(pulse!.goalLine).not.toContain("clears");
    expect(pulse!.months[0]).not.toHaveProperty("visits");
    expect(JSON.stringify(pulse)).not.toContain("12,862");
  });

  it("returns null (card self-hides) when there is no GSC data - never a bare zero", async () => {
    daily.mockResolvedValue([]);
    const pulse = await loadMonthlyPulseForTenant(
      "tenant-b",
      10000,
      new Date("2026-07-09T12:00:00Z"),
    );
    expect(pulse).toBeNull();
  });
});

describe("loadMonthlyPulseForTenant (Wave 2A - reconciliation gate)", () => {
  const GSC = [
    { date: "2026-06-10", clicks: 3004, impressions: 351000 },
    { date: "2026-07-02", clicks: 730, impressions: 90000 },
  ];

  it("card stays HELD-BACK without a passing reconciliation, even when GSC data exists", async () => {
    daily.mockResolvedValue(GSC);
    recon.mockResolvedValue({ status: "none" });
    const pulse = await loadMonthlyPulseForTenant("tenant-a", 10000, new Date("2026-07-09T12:00:00Z"));
    expect(pulse).not.toBeNull();
    expect(pulse!.reconciliationLine).toContain("Monthly visits need reconciliation");
    expect(pulse!.reconciledVisitsHeadline).toBeNull();
  });

  it("shows visits ONLY when a passing reconciliation is returned", async () => {
    daily.mockResolvedValue(GSC);
    recon.mockResolvedValue({
      status: "pass",
      months: [
        { month: "2026-06-01", visits: 12540, partial: false },
        { month: "2026-07-01", visits: 3120, partial: true },
      ],
      reconciledThrough: "2026-06-01",
    });
    const pulse = await loadMonthlyPulseForTenant("tenant-a", 10000, new Date("2026-07-09T12:00:00Z"));
    expect(pulse!.reconciledVisitsHeadline).toBe("June: 12,540 visits, reconciled against Analytics.");
  });

  it("mismatch reconciliation -> honest alert, still no visits number", async () => {
    daily.mockResolvedValue(GSC);
    recon.mockResolvedValue({ status: "mismatch" });
    const pulse = await loadMonthlyPulseForTenant("tenant-a", 10000, new Date("2026-07-09T12:00:00Z"));
    expect(pulse!.reconciliationLine).toContain("does not add up yet");
    expect(pulse!.reconciledVisitsHeadline).toBeNull();
  });
});
