/**
 * MonthlyNorthStar render pins (2026-07-09 origin; 2026-07-10 P0-A truth fix) - rendered
 * for real via renderToStaticMarkup so we assert on the exact operator copy. After P0-A
 * the strip must render the honest reconciliation state and NEVER any disputed sitewide
 * visits total, and must never celebrate the goal from clicks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MonthlyPulse } from "@/domains/north-star/monthly-pulse";
import {
  MONTHLY_VISITS_RECONCILIATION_LINE,
  MONTHLY_VISITS_RECONCILED_LINE,
  MONTHLY_VISITS_MISMATCH_LINE,
} from "@/domains/north-star/monthly-pulse";

let pulse: MonthlyPulse | null = null;

vi.mock("@/domains/north-star/load-monthly-pulse", () => ({
  loadMonthlyPulseForTenant: async () => pulse,
}));
// loadWithDeadline just needs to return the resolved data here (no timeout).
vi.mock("@/lib/load-with-deadline", () => ({
  loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }),
}));

import { MonthlyNorthStar } from "./monthly-north-star";

// The disputed GA4 visits totals that used to headline this strip - asserted absent.
const DISPUTED_VISITS = ["18,740", "32,482", "17,800", "11,370", "12,862", "2,635"];

function fixturePulse(): MonthlyPulse {
  return {
    months: [
      { month: "2026-06-01", label: "June", clicks: 3004, impressions: 351000 },
      { month: "2026-07-01", label: "July", clicks: 730, impressions: 90000 },
    ],
    headline: "June: 3,004 clicks from Google search.",
    reconciliationLine: MONTHLY_VISITS_RECONCILIATION_LINE,
    goalLine:
      "I can't grade your 10,000-visits-a-month goal yet because monthly visits need reconciliation. I will score it as soon as that number is trustworthy.",
    monthToDateLine: "July so far: 730 clicks from Google search.",
    deltaLine: "June clicks were down 27% from May.",
    reconciledVisitsHeadline: null,
    reconciledGoalLine: null,
    reconciledMonthToDateLine: null,
  };
}

beforeEach(() => {
  pulse = null;
});

describe("MonthlyNorthStar (P0-A)", () => {
  it("renders the clicks headline, honest reconciliation line, ungradeable-goal line, delta, month-to-date, and so-far chip", async () => {
    pulse = fixturePulse();
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toContain("June: 3,004 clicks from Google search.");
    expect(html).toContain("Monthly visits need reconciliation");
    expect(html).toContain("grade your 10,000-visits-a-month goal yet"); // apostrophe is HTML-escaped in markup
    expect(html).toContain("June clicks were down 27% from May.");
    expect(html).toContain("July so far: 730 clicks from Google search.");
    expect(html).toContain("so far");
    expect(html).toContain("These are your Search Console clicks.");
  });

  it("renders NO disputed sitewide-visits total and never celebrates the goal", async () => {
    pulse = fixturePulse();
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    for (const n of DISPUTED_VISITS) expect(html).not.toContain(n);
    expect(html).not.toContain("clears");
    expect(html).not.toMatch(/[\d,]+ visits\b/); // no "N visits" figure anywhere
  });

  it("self-hides when the loader returns null", async () => {
    pulse = null;
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toBe("");
  });

  it("self-hides when headline is null (no clicks to prove)", async () => {
    pulse = { ...fixturePulse(), headline: null };
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toBe("");
  });

  it("two-tenant isolation: the honest state renders identically for any tenant (no per-tenant leak in copy)", async () => {
    pulse = fixturePulse();
    const a = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    const b = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-ritz-founder", monthlyVisitGoal: 10000 }),
    );
    expect(a).toBe(b);
    expect(a).not.toContain("iranopedia");
    expect(a).not.toContain("ritz");
  });

  it("never emits an em or en dash", async () => {
    pulse = fixturePulse();
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).not.toMatch(/[–—]/);
  });

  it("PASS: renders the reconciled visits headline + reconciled line + visits goal", async () => {
    pulse = {
      ...fixturePulse(),
      reconciliationLine: MONTHLY_VISITS_RECONCILED_LINE,
      reconciledVisitsHeadline: "June: 12,540 visits, reconciled against Analytics.",
      reconciledGoalLine: "June cleared your 10,000-visits-a-month goal with 12,540 visits.",
      reconciledMonthToDateLine: "July so far: 3,120 visits.",
      goalLine: null,
    };
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toContain("June: 12,540 visits, reconciled against Analytics.");
    expect(html).toContain("These visits are reconciled against Analytics");
    expect(html).toContain("cleared your 10,000-visits-a-month goal with 12,540 visits.");
    expect(html).toContain("July so far: 3,120 visits.");
    expect(html).not.toMatch(/[–—]/);
  });

  it("MISMATCH: renders the honest alert and NO visits number", async () => {
    pulse = { ...fixturePulse(), reconciliationLine: MONTHLY_VISITS_MISMATCH_LINE };
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toContain("does not add up yet");
    expect(html).not.toMatch(/[\d,]+ visits\b/);
  });
});
