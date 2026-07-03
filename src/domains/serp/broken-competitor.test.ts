/**
 * broken-competitor.test.ts (BEACON_500 P9 v1 250+259).
 *
 * Pins the pure detector: it FIRES on a fixture where a rival held a top spot
 * earlier and is gone from the latest capture, is EMPTY on a fixture where the
 * rival is still present (no drop), and never produces a false positive (own
 * domain, noise domains, single-capture history, out-of-window captures, or the
 * tenant already owning the top slot). No I/O.
 */
import { describe, it, expect } from "vitest";

import {
  computeBrokenCompetitors,
  computeBrokenCompetitorsForQuery,
  type BrokenCompetitorHistoryRow,
} from "./broken-competitor";

const NOW = new Date("2026-07-03T00:00:00.000Z");
const OWN = "iranopedia.com";

function row(overrides: Partial<BrokenCompetitorHistoryRow> = {}): BrokenCompetitorHistoryRow {
  return {
    query: "persian wedding",
    capturedAt: "2026-07-01T00:00:00.000Z",
    ownRank: null,
    topDomains: [],
    ...overrides,
  };
}

describe("computeBrokenCompetitors (pure detector)", () => {
  it("is EMPTY on empty input", () => {
    expect(computeBrokenCompetitors([], OWN, { now: NOW })).toEqual([]);
  });

  it("FIRES when a competitor that held a top spot drops off the latest capture", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [
          { rank: 1, domain: "rival.com", url: "https://rival.com/persian-wedding" },
          { rank: 2, domain: "other.com", url: "https://other.com/x" },
        ],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [
          { rank: 1, domain: "other.com", url: "https://other.com/x" },
        ],
      }),
    ];
    const out = computeBrokenCompetitors(rows, OWN, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.domain).toBe("rival.com");
    expect(out[0]!.bestRankWhilePresent).toBe(1);
    expect(out[0]!.lastUrl).toBe("https://rival.com/persian-wedding");
    expect(out[0]!.sentence).toContain('persian wedding');
    expect(out[0]!.sentence).toContain("#1");
    // Voice: no em/en dashes.
    expect(out[0]!.sentence).not.toMatch(/[—–]/);
  });

  it("is EMPTY when the competitor is STILL present in the latest capture (no drop)", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/x" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 3, domain: "rival.com", url: "https://rival.com/x" }],
      }),
    ];
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("never reports the tenant's OWN domain as a broken competitor", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        ownRank: 2,
        topDomains: [{ rank: 2, domain: OWN, url: "https://iranopedia.com/wedding" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        ownRank: null,
        topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/x" }],
      }),
    ];
    // The own domain dropped, but it is never a "competitor" opening.
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("skips noise/aggregator domains that cycle in and out", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "pinterest.com", url: "https://pinterest.com/pin/1" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/x" }],
      }),
    ];
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("does not fire from a SINGLE capture (never inferred from one point)", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/x" }],
      }),
    ];
    expect(computeBrokenCompetitorsForQuery(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("is EMPTY when the tenant already owns the top slot in the latest capture", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/x" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        ownRank: 2,
        topDomains: [{ rank: 2, domain: OWN, url: "https://iranopedia.com/wedding" }],
      }),
    ];
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("ignores captures outside the window", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-01-01T00:00:00.000Z", // > 30d before NOW
        topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/x" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/x" }],
      }),
    ];
    // Only one in-window capture -> no diff -> empty.
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("does not fire when the earlier appearance was OUTSIDE the top slots (a demotion, not a disappearance)", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      row({
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 9, domain: "rival.com", url: "https://rival.com/x" }],
      }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/x" }],
      }),
    ];
    expect(computeBrokenCompetitors(rows, OWN, { now: NOW })).toEqual([]);
  });

  it("ranks the biggest vacated spot (lowest rank held) first across queries", () => {
    const rows: BrokenCompetitorHistoryRow[] = [
      // Query A: a #5 rival dropped.
      row({
        query: "iran flags",
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 5, domain: "a.com", url: "https://a.com/x" }],
      }),
      row({
        query: "iran flags",
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "z.com", url: "https://z.com/x" }],
      }),
      // Query B: a #1 rival dropped.
      row({
        query: "persian wedding",
        capturedAt: "2026-06-25T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "b.com", url: "https://b.com/x" }],
      }),
      row({
        query: "persian wedding",
        capturedAt: "2026-07-02T00:00:00.000Z",
        topDomains: [{ rank: 1, domain: "z.com", url: "https://z.com/x" }],
      }),
    ];
    const out = computeBrokenCompetitors(rows, OWN, { now: NOW });
    expect(out.map((o) => o.domain)).toEqual(["b.com", "a.com"]);
  });
});
