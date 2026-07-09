/**
 * MonthlyNorthStar render pins (2026-07-09, operator spec B-6) - rendered for
 * real via renderToStaticMarkup so we assert on the exact operator copy, not on
 * props. Mirrors the mocking style of ops-pipeline-deadman.test.tsx /
 * finish-setup-card.test.tsx (mock the loader module directly).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MonthlyPulse } from "@/domains/north-star/monthly-pulse";

let pulse: MonthlyPulse | null = null;

vi.mock("@/domains/north-star/load-monthly-pulse", () => ({
  loadMonthlyPulseForTenant: async () => pulse,
}));
// loadWithDeadline just needs to return the resolved data here (no timeout).
vi.mock("@/lib/load-with-deadline", () => ({
  loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }),
}));

import { MonthlyNorthStar } from "./monthly-north-star";

function fixturePulse(): MonthlyPulse {
  return {
    months: [
      { month: "2026-06-01", label: "June", visits: 12862, clicks: 3004, impressions: 50000 },
      { month: "2026-07-01", label: "July", visits: 2635, clicks: 900, impressions: 10000 },
    ],
    headline: "June: 12,862 visits and 3,004 clicks from Google search.",
    goalLine: "That clears your 10,000-a-month goal.",
    monthToDateLine: "July so far: 2,635 visits.",
    deltaLine: "June was up 13% on May.",
  };
}

beforeEach(() => {
  pulse = null;
});

describe("MonthlyNorthStar", () => {
  it("renders the headline, goal, delta, month-to-date sentences and the so-far chip", async () => {
    pulse = fixturePulse();
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toContain("June: 12,862 visits and 3,004 clicks from Google search.");
    expect(html).toContain("That clears your 10,000-a-month goal.");
    expect(html).toContain("June was up 13% on May.");
    expect(html).toContain("July so far: 2,635 visits.");
    expect(html).toContain("so far");
  });

  it("self-hides when the loader returns null", async () => {
    pulse = null;
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toBe("");
  });

  it("self-hides when headline is null", async () => {
    pulse = { ...fixturePulse(), headline: null };
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).toBe("");
  });

  it("never emits an em or en dash", async () => {
    pulse = fixturePulse();
    const html = renderToStaticMarkup(
      await MonthlyNorthStar({ tenantId: "tenant-iranopedia", monthlyVisitGoal: 10000 }),
    );
    expect(html).not.toMatch(/[–—]/);
  });
});
