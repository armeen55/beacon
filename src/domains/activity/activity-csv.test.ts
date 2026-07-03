/**
 * activity-csv (R14b) - shape pins for the /activity spreadsheet download.
 */
import { describe, expect, it } from "vitest";
import { buildActivityCsv, ACTIVITY_CSV_HEADERS } from "./activity-csv";
import type { ActivityEvent } from "./activity-stream";

const EVENTS: ActivityEvent[] = [
  {
    at: "2026-07-02T04:10:00.000Z",
    kind: "spend",
    title: "Live Google results check",
    sentence: "I spent $0.03 checking live Google results for 12 keywords. Every paid call is logged before it runs.",
    href: "/settings/spend",
    linkLabel: "See all spend",
  },
  {
    at: "2026-07-01T20:00:00.000Z",
    kind: "shipped",
    title: "Change live on /cats",
    sentence: 'You shipped a "description, change" on /cats.',
    href: "/results#proof-1",
    linkLabel: "See the result",
  },
];

describe("buildActivityCsv", () => {
  it("emits the header then one row per stream event, quoting embedded commas", () => {
    const csv = buildActivityCsv(EVENTS);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(ACTIVITY_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("2026-07-02T04:10:00.000Z");
    expect(lines[1]).toContain("I spent $0.03 checking live Google results for 12 keywords");
    // the sentence with a comma and quotes is quoted per RFC 4180
    expect(lines[2]).toContain('"You shipped a ""description, change"" on /cats."');
  });

  it("handles an empty stream (header only)", () => {
    expect(buildActivityCsv([]).trimEnd()).toBe(ACTIVITY_CSV_HEADERS.join(","));
  });
});
