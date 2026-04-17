import { describe, it, expect } from "vitest";
import {
  isTerminalVerdict,
  findLandingDay,
  computeChangeVerdict,
} from "./url-change-outcome";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { UrlCitationHistory } from "@/domains/product/url-citation-history";
import type { DailyPoint } from "./url-verdict";

// ---------------------------------------------------------------------------
// isTerminalVerdict
// ---------------------------------------------------------------------------

describe("isTerminalVerdict", () => {
  it("returns true for helping / hurting / nothing_yet", () => {
    expect(isTerminalVerdict("helping")).toBe(true);
    expect(isTerminalVerdict("hurting")).toBe(true);
    expect(isTerminalVerdict("nothing_yet")).toBe(true);
  });

  it("returns false for too_early and not_enough_data", () => {
    expect(isTerminalVerdict("too_early")).toBe(false);
    expect(isTerminalVerdict("not_enough_data")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findLandingDay
// ---------------------------------------------------------------------------

function series(start: string, counts: number[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}

describe("findLandingDay", () => {
  it("returns null when targetVerdict is nothing_yet (no discrete landing)", () => {
    const s = series("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5]);
    expect(findLandingDay(s, "2026-03-15", "nothing_yet")).toBeNull();
  });

  it("finds the first day the verdict crosses into helping", () => {
    // 14d baseline at 5/day, then 14d post at 15/day — strong lift from day 1.
    // But sustain ≥5 requires at least 5 days of post data; walk returns the first day
    // the verdict is "helping" (i.e. sustain threshold also hit).
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
    ]);
    const result = findLandingDay(s, "2026-03-15", "helping");
    expect(result).not.toBeNull();
    expect(result!.day).toBeGreaterThanOrEqual(5); // sustain requires ≥5 days
    expect(result!.day).toBeLessThanOrEqual(10); // landed quickly with strong lift
    expect(result!.z).toBeGreaterThanOrEqual(2.0);
  });

  it("returns null when verdict never crosses within post window", () => {
    // Flat baseline, flat after — verdict stays nothing_yet / too_early, never helping.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    ]);
    expect(findLandingDay(s, "2026-03-15", "helping")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeChangeVerdict — site-wide / no-URL handling
// ---------------------------------------------------------------------------

function makeChange(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "cl-t",
    timestamp: "2026-03-15T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: overrides.url ?? null,
    asset_name: "",
    change_description: overrides.change_description ?? "Set title tag",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-03-15T00:00:00Z",
    updated_at: "2026-03-15T00:00:00Z",
    tenant_id: "",
    ...overrides,
  };
}

function emptyHistory(): UrlCitationHistory {
  return {
    built_at: new Date().toISOString(),
    date_range: { first: "2026-03-01", last: "2026-03-29" },
    distinct_urls: 0,
    series: [],
  };
}

describe("computeChangeVerdict", () => {
  it("returns null for site-wide changes (no URL)", () => {
    const change = makeChange({ url: null });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns null for non-URL labels like 'Profound'", () => {
    const change = makeChange({ url: "Profound" });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns null when URL has no series in history", () => {
    const change = makeChange({ url: "/services/foo" });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns verdict when URL has a matching series", () => {
    const change = makeChange({ url: "/services/foo" });
    const history: UrlCitationHistory = {
      built_at: new Date().toISOString(),
      date_range: { first: "2026-03-01", last: "2026-03-29" },
      distinct_urls: 1,
      series: [
        {
          url: "/services/foo",
          raw_urls: ["https://example.com/services/foo"],
          is_owned: true,
          daily: [
            ...Array.from({ length: 14 }, (_, i) => ({
              date: new Date(
                new Date("2026-03-01T00:00:00Z").getTime() + i * 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
              count: 5,
              by_platform: { ChatGPT: 5 },
            })),
            ...Array.from({ length: 14 }, (_, i) => ({
              date: new Date(
                new Date("2026-03-16T00:00:00Z").getTime() + i * 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
              count: 15,
              by_platform: { ChatGPT: 15 },
            })),
          ],
        },
      ],
    };
    const result = computeChangeVerdict(change, history, "2026-03-29");
    expect(result).not.toBeNull();
    expect(result!.normalizedUrl).toBe("/services/foo");
    expect(result!.verdict.verdict).toBe("helping");
  });
});
