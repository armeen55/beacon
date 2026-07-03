/**
 * Tests for external-event-ledger (BEACON_500 N32).
 *
 * Coverage:
 *  - event detection per kind (shock -> google_update/traffic_shock, outage,
 *    own-site cluster)
 *  - dedupe vs weather (a suspected shock inside a confirmed update is dropped;
 *    eventCaveatForWindow yields ONE sentence for a shock, reusing weather's)
 *  - own-site cluster distinct-page floor (five edits to one page never trip it)
 *  - overlap read + reliability flags (no double-count of the shock into N10)
 */

import { describe, expect, it } from "vitest";
import {
  shockEntriesFromWeather,
  outageEntries,
  ownSiteClusterEntries,
  buildExternalEventLedger,
  overlappingExternalEvent,
  eventCaveatForWindow,
  eventReliabilityFlagsForWindow,
  MIN_PAGES_FOR_OWN_SITE_CLUSTER,
  type OutageSignal,
  type ShippedChangeDay,
} from "./external-event-ledger";
import type { ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { weatherCaveatSentence } from "@/domains/proof-gsc/algorithm-weather";

const confirmedShock: ShockWindow = {
  id: "confirmed:march-2026-core",
  start: "2026-03-10",
  end: "2026-03-24",
  kind: "confirmed",
  label: "the March 2026 Google core update",
};

const suspectedShock: ShockWindow = {
  id: "suspected:2026-05-02:down",
  start: "2026-04-29",
  end: "2026-05-12",
  kind: "suspected",
  label: "a sitewide shift I detected",
  direction: "down",
};

describe("shockEntriesFromWeather - relabels weather shocks into ledger kinds", () => {
  it("a confirmed shock becomes a google_update (confirmed, sitewide)", () => {
    const [e] = shockEntriesFromWeather([confirmedShock]);
    expect(e).toBeDefined();
    expect(e!.kind).toBe("google_update");
    expect(e!.scope).toBe("sitewide");
    expect(e!.confidence).toBe("confirmed");
    expect(e!.start).toBe("2026-03-10");
    expect(e!.plainDescription).toContain("the March 2026 Google core update");
    expect(e!.plainDescription).not.toMatch(/[—–]/);
  });

  it("a suspected shock becomes a traffic_shock (detected, sitewide)", () => {
    const [e] = shockEntriesFromWeather([suspectedShock]);
    expect(e!.kind).toBe("traffic_shock");
    expect(e!.confidence).toBe("detected");
  });

  it("DEDUPE vs weather: a suspected shock overlapping a confirmed update is dropped", () => {
    const overlappingSuspected: ShockWindow = {
      ...suspectedShock,
      id: "suspected:2026-03-15:down",
      start: "2026-03-12",
      end: "2026-03-20",
    };
    const entries = shockEntriesFromWeather([confirmedShock, overlappingSuspected]);
    // Only the confirmed google_update survives.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("google_update");
  });

  it("a suspected shock that does NOT overlap any confirmed update is kept", () => {
    const entries = shockEntriesFromWeather([confirmedShock, suspectedShock]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.kind).sort()).toEqual(["google_update", "traffic_shock"]);
  });
});

describe("outageEntries - deadman outages become connector_outage entries", () => {
  const severe: OutageSignal = {
    label: "the nightly data sync has stalled",
    lastRunAt: "2026-06-01T02:00:00Z",
    observedAt: "2026-06-04T09:00:00Z",
    severe: true,
  };

  it("a severe outage with a known start produces a machinery-scope entry", () => {
    const [e] = outageEntries([severe]);
    expect(e!.kind).toBe("connector_outage");
    expect(e!.scope).toBe("machinery");
    expect(e!.start).toBe("2026-06-01");
    expect(e!.end).toBe("2026-06-04");
    expect(e!.confidence).toBe("confirmed");
    expect(e!.plainDescription).not.toMatch(/[—–]/);
  });

  it("a non-severe (merely late) signal never produces an entry", () => {
    expect(outageEntries([{ ...severe, severe: false }])).toEqual([]);
  });

  it("a severe outage with no known start date is skipped, not fabricated", () => {
    expect(outageEntries([{ ...severe, lastRunAt: null }])).toEqual([]);
  });

  it("an outage whose start is after its observed date is skipped (no negative window)", () => {
    expect(outageEntries([{ ...severe, lastRunAt: "2026-06-10T00:00:00Z" }])).toEqual([]);
  });
});

describe("ownSiteClusterEntries - many distinct pages on one day = a cluster", () => {
  it("two-plus distinct pages on one day trips the cluster (the floor)", () => {
    const changes: ShippedChangeDay[] = [
      { path: "/a", shippedAt: "2026-06-20T10:00:00Z" },
      { path: "/b", shippedAt: "2026-06-20T11:00:00Z" },
    ];
    const [e] = ownSiteClusterEntries(changes);
    expect(e!.kind).toBe("own_site_change");
    expect(e!.start).toBe("2026-06-20");
    expect(e!.end).toBe("2026-06-20");
    expect(e!.plainDescription).toContain("2 pages");
  });

  it("five edits to ONE page never trip the cluster (counts distinct pages)", () => {
    const changes: ShippedChangeDay[] = [
      { path: "/a", shippedAt: "2026-06-20T10:00:00Z" },
      { path: "/a", shippedAt: "2026-06-20T10:05:00Z" },
      { path: "/a", shippedAt: "2026-06-20T10:10:00Z" },
      { path: "/a", shippedAt: "2026-06-20T10:15:00Z" },
      { path: "/a", shippedAt: "2026-06-20T10:20:00Z" },
    ];
    expect(ownSiteClusterEntries(changes)).toEqual([]);
  });

  it("a single page on one day never trips the cluster", () => {
    expect(
      ownSiteClusterEntries([{ path: "/a", shippedAt: "2026-06-20T10:00:00Z" }]),
    ).toEqual([]);
  });

  it("the floor is 2 distinct pages", () => {
    expect(MIN_PAGES_FOR_OWN_SITE_CLUSTER).toBe(2);
  });
});

describe("buildExternalEventLedger - merge, dedupe, sort", () => {
  it("merges all three detectors, newest-first, most-specific-kind first", () => {
    const ledger = buildExternalEventLedger({
      shockWindows: [confirmedShock, suspectedShock],
      outageSignals: [
        { label: "sync stalled", lastRunAt: "2026-06-01T00:00:00Z", observedAt: "2026-06-05T00:00:00Z", severe: true },
      ],
      shippedChanges: [
        { path: "/a", shippedAt: "2026-06-20T00:00:00Z" },
        { path: "/b", shippedAt: "2026-06-20T00:00:00Z" },
      ],
    });
    // 4 events: own_site (06-20), outage (06-01), traffic_shock (04-29), google_update (03-10)
    expect(ledger.map((e) => e.kind)).toEqual([
      "own_site_change",
      "connector_outage",
      "traffic_shock",
      "google_update",
    ]);
  });

  it("is empty when every input is empty (checked-nothing is []) ", () => {
    expect(buildExternalEventLedger({})).toEqual([]);
  });

  it("is idempotent: same input, same ids", () => {
    const a = buildExternalEventLedger({ shockWindows: [confirmedShock] });
    const b = buildExternalEventLedger({ shockWindows: [confirmedShock] });
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });
});

describe("overlappingExternalEvent", () => {
  const ledger = buildExternalEventLedger({
    shockWindows: [confirmedShock],
    outageSignals: [
      { label: "sync stalled", lastRunAt: "2026-06-01T00:00:00Z", observedAt: "2026-06-05T00:00:00Z", severe: true },
    ],
  });

  it("returns the overlapping event", () => {
    const hit = overlappingExternalEvent("2026-03-12", "2026-03-15", ledger);
    expect(hit?.kind).toBe("google_update");
  });

  it("returns null when nothing overlaps", () => {
    expect(overlappingExternalEvent("2026-01-01", "2026-01-05", ledger)).toBeNull();
  });

  it("returns null for an empty window", () => {
    expect(overlappingExternalEvent("", "", ledger)).toBeNull();
  });
});

describe("eventCaveatForWindow - dedupe vs weather (the honesty rule)", () => {
  const shocks = [confirmedShock];
  const ledger = buildExternalEventLedger({
    shockWindows: shocks,
    outageSignals: [
      { label: "sync stalled", lastRunAt: "2026-06-01T00:00:00Z", observedAt: "2026-06-05T00:00:00Z", severe: true },
    ],
  });

  it("for a shock window, reuses the EXACT weather sentence (never a second sentence)", () => {
    const weather = weatherCaveatSentence(confirmedShock);
    const caveat = eventCaveatForWindow({
      windowStart: "2026-03-12",
      windowEnd: "2026-03-15",
      events: ledger,
      shockWindows: shocks,
      weatherSentence: weather,
    });
    expect(caveat).toBe(weather);
  });

  it("for a shock window with no supplied weather sentence, falls back to the ledger shock description (still one sentence)", () => {
    const caveat = eventCaveatForWindow({
      windowStart: "2026-03-12",
      windowEnd: "2026-03-15",
      events: ledger,
      shockWindows: shocks,
    });
    expect(caveat).toContain("the March 2026 Google core update");
  });

  it("for a NON-shock overlap (an outage), returns the ledger's own outage caveat", () => {
    const caveat = eventCaveatForWindow({
      windowStart: "2026-06-02",
      windowEnd: "2026-06-04",
      events: ledger,
      shockWindows: shocks,
    });
    expect(caveat).toContain("data pipeline stalled");
  });

  it("returns null when nothing overlaps", () => {
    expect(
      eventCaveatForWindow({
        windowStart: "2026-01-01",
        windowEnd: "2026-01-05",
        events: ledger,
        shockWindows: shocks,
      }),
    ).toBeNull();
  });
});

describe("eventReliabilityFlagsForWindow - feeds N10 without double-counting", () => {
  const ledger = buildExternalEventLedger({
    shockWindows: [confirmedShock],
    outageSignals: [
      { label: "sync stalled", lastRunAt: "2026-06-01T00:00:00Z", observedAt: "2026-06-05T00:00:00Z", severe: true },
    ],
  });

  it("a shock overlap sets weatherQuarantined (the existing N10 input), not the machinery bit", () => {
    const flags = eventReliabilityFlagsForWindow({ windowStart: "2026-03-12", windowEnd: "2026-03-15", events: ledger });
    expect(flags).toEqual({ weatherQuarantined: true, machineryOrCompoundFlagged: false });
  });

  it("an outage overlap sets ONLY the machinery bit (a fresh N10 input weather did not cover)", () => {
    const flags = eventReliabilityFlagsForWindow({ windowStart: "2026-06-02", windowEnd: "2026-06-04", events: ledger });
    expect(flags).toEqual({ weatherQuarantined: false, machineryOrCompoundFlagged: true });
  });

  it("no overlap is all-false (byte-identical to not calling it)", () => {
    const flags = eventReliabilityFlagsForWindow({ windowStart: "2026-01-01", windowEnd: "2026-01-05", events: ledger });
    expect(flags).toEqual({ weatherQuarantined: false, machineryOrCompoundFlagged: false });
  });
});
