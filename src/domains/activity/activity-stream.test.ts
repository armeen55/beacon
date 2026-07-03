/**
 * activity-stream (R14a) - composition pins for the /activity unified stream:
 * fixture stores in, one reverse-chronological plain-English stream out.
 */
import { describe, expect, it } from "vitest";

import {
  composeActivityStream,
  pageActivityEvents,
  type ActivityEvent,
  type ActivityInputs,
} from "./activity-stream";
import type { AppErrorRow } from "@/lib/obs/error-ledger";

const NOW = new Date("2026-07-03T12:00:00.000Z");

const EMPTY: ActivityInputs = {
  shipped: [],
  autopilotReceipts: [],
  plans: [],
  cronRuns: [],
  errorRows: [],
  connections: [],
};

function errorRow(at: string, route = "cron/sync-connectors"): AppErrorRow {
  return { id: at, at, tenantId: "t", route, action: "run", message: "boom", stack: null, context: {} };
}

describe("composeActivityStream (R14a)", () => {
  it("composes all five sources into ONE reverse-chronological stream", () => {
    const events = composeActivityStream(
      {
        shipped: [
          { id: "/cats::2026-07-01", path: "/cats", actionType: "edit_meta", shippedAt: "2026-07-01T20:00:00.000Z", verifiedLive: true },
        ],
        autopilotReceipts: [],
        plans: [
          { date: "2026-07-02", selectedCount: 6, estimatedMinutes: 30, acceptedAt: "2026-07-02T08:00:00.000Z" },
        ],
        cronRuns: [
          { job: "sync-connectors", started_at: "2026-07-03T07:00:00.000Z", finished_at: "2026-07-03T07:00:12.000Z", duration_ms: 12_000, ok: true },
        ],
        errorRows: [],
        connections: [
          { label: "Google Search Console", connectedAt: "2026-06-30T10:00:00.000Z" },
        ],
      },
      NOW,
    );
    expect(events.map((e) => e.kind)).toEqual(["cron", "plan", "shipped", "connection"]);
    // newest first, strictly by timestamp
    const ats = events.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    // every row carries the four operator answers: when, what, sentence, deep link
    for (const e of events) {
      expect(e.at).toBeTruthy();
      expect(e.title).toBeTruthy();
      expect(e.sentence).toBeTruthy();
      expect(e.href.startsWith("/")).toBe(true);
      expect(/[‒–—―]/.test(`${e.title} ${e.sentence}`)).toBe(false);
    }
  });

  it("names WHO shipped: a pushed autopilot receipt on the same page + day reads as Beacon's own ship", () => {
    const inputs: ActivityInputs = {
      ...EMPTY,
      shipped: [
        { id: "/a::2026-07-01", path: "/a", actionType: "edit_title", shippedAt: "2026-07-01T20:00:00.000Z", verifiedLive: true },
        { id: "/b::2026-07-01", path: "/b", actionType: "edit_meta", shippedAt: "2026-07-01T21:00:00.000Z", verifiedLive: false },
      ],
      autopilotReceipts: [
        { url: "https://example.com/a", shippedAt: "2026-07-01T20:00:01.000Z", result: "pushed", kind: "ship" },
      ],
    };
    const events = composeActivityStream(inputs, NOW);
    const a = events.find((e) => e.href.includes("/a::"))!;
    const b = events.find((e) => e.href.includes("/b::"))!;
    expect(a.sentence).toBe("I shipped a title change on /a myself and I am measuring it against similar pages.");
    expect(b.sentence).toBe("You shipped a description change on /b, and I am measuring it against similar pages.");
    expect(a.href).toBe("/results#proof-/a::2026-07-01");
  });

  it("cron receipts wear their PLAIN job names, never a raw key", () => {
    const events = composeActivityStream(
      {
        ...EMPTY,
        cronRuns: [
          { job: "sync-connectors", started_at: "2026-07-03T07:00:00.000Z", finished_at: "2026-07-03T07:00:12.000Z", duration_ms: 12_000, ok: true },
          { job: "measure-due", started_at: "2026-07-03T06:00:00.000Z", finished_at: "2026-07-03T06:00:05.000Z", duration_ms: 5_000, ok: false },
        ],
      },
      NOW,
    );
    expect(events[0]!.title).toBe("Nightly data sync");
    expect(events[0]!.sentence).toBe("This ran on schedule and took 12 seconds.");
    expect(events[1]!.title).toBe("Nightly results check");
    expect(events[1]!.sentence).toContain("This run failed.");
    expect(JSON.stringify(events)).not.toContain("sync-connectors");
  });

  it("errors stay OFF the stream below the spike floor and join as ONE row above it", () => {
    const nine = Array.from({ length: 9 }, (_, i) => errorRow(`2026-07-03T0${i}:00:00.000Z`));
    expect(composeActivityStream({ ...EMPTY, errorRows: nine }, NOW)).toHaveLength(0);

    const twelve = Array.from({ length: 12 }, (_, i) =>
      errorRow(`2026-07-03T${String(i).padStart(2, "0")}:10:00.000Z`),
    );
    const events = composeActivityStream({ ...EMPTY, errorRows: twelve }, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("errors");
    expect(events[0]!.sentence).toContain("Something failed 12 times since yesterday");
    expect(events[0]!.href).toBe("/diagnostics/errors");
  });

  it("plan accept + abandon and connection events speak plainly with deep links", () => {
    const events = composeActivityStream(
      {
        ...EMPTY,
        plans: [
          { date: "2026-07-02", selectedCount: 1, estimatedMinutes: 4, acceptedAt: "2026-07-02T08:00:00.000Z" },
          { date: "2026-07-01", selectedCount: 5, estimatedMinutes: 25, abandonedAt: "2026-07-01T09:00:00.000Z" },
        ],
        connections: [{ label: "Google Analytics", authFailedAt: "2026-07-01T05:00:00.000Z" }],
      },
      NOW,
    );
    expect(events[0]!.sentence).toBe("You approved 1 change for 2026-07-02, about 4 minutes of work.");
    expect(events[0]!.href).toBe("/#daily-experiments");
    expect(events[1]!.sentence).toBe("You cleared the 5-change plan I suggested for 2026-07-01 before approving it.");
    expect(events[2]!.sentence).toBe("Google Analytics lost its authorization. Reconnect it so I keep getting fresh data.");
    expect(events[2]!.href).toBe("/settings/connectors");
  });

  it("drops rows with unparseable timestamps instead of corrupting the sort", () => {
    const events = composeActivityStream(
      {
        ...EMPTY,
        shipped: [
          { id: "/x::bad", path: "/x", actionType: "edit_meta", shippedAt: "not-a-date", verifiedLive: false },
        ],
      },
      NOW,
    );
    expect(events).toHaveLength(0);
  });
});

describe("pageActivityEvents (paged 50)", () => {
  const mk = (i: number): ActivityEvent => ({
    at: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    kind: "cron",
    title: `t${i}`,
    sentence: "s",
    href: "/settings/health",
    linkLabel: "Source health",
  });

  it("slices 50 per page and clamps out-of-range pages", () => {
    const events = Array.from({ length: 120 }, (_, i) => mk(i));
    const p1 = pageActivityEvents(events, 1);
    expect(p1.rows).toHaveLength(50);
    expect(p1.pageCount).toBe(3);
    const p3 = pageActivityEvents(events, 3);
    expect(p3.rows).toHaveLength(20);
    expect(pageActivityEvents(events, 99).page).toBe(3);
    expect(pageActivityEvents(events, 0).page).toBe(1);
  });
});
