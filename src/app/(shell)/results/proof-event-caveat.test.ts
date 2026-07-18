/**
 * proof-event-caveat (N32 R21b, 2026-07-03) - the external-event ledger read side on /results.
 *
 * Two layers, both here:
 *   1. WIRING PINS (source-scan, the same posture as proof-weather-caveat.test.ts): the page must
 *      load the ledger, thread eventCaveatForWindow per row, thread machineryOrCompoundFlagged into
 *      the N10 verdict-reliability call, and render the event caveat behind the dedupe guard. A
 *      refactor that silently drops any of these fails here.
 *   2. FUNCTIONAL PROOF of the render dedupe rule (shouldRenderEventCaveat) fed by the REAL cores
 *      (eventCaveatForWindow + eventReliabilityFlagsForWindow): a non-shock overlap RENDERS, a
 *      shock overlap is DEDUPED against the weather sentence (one line, never two), and an empty
 *      ledger SELF-HIDES.
 *
 * The caveat sentence math itself is pinned in external-event-ledger.test.ts; this pins the wiring
 * and the row-level dedupe/self-hide the page implements.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { shouldRenderEventCaveat } from "./page";
import {
  buildExternalEventLedger,
  eventCaveatForWindow,
  eventReliabilityFlagsForWindow,
} from "@/domains/events/external-event-ledger";
import { weatherCaveatSentence, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";

function src(): string {
  return ["page.tsx", "results-ledger-card.tsx"]
    .map((file) => readFileSync(resolve(__dirname, file), "utf8"))
    .join("\n");
}

const confirmedShock: ShockWindow = {
  id: "confirmed:march-2026-core",
  start: "2026-03-10",
  end: "2026-03-24",
  kind: "confirmed",
  label: "the March 2026 Google core update",
};

const ledger = buildExternalEventLedger({
  shockWindows: [confirmedShock],
  outageSignals: [
    { label: "sync stalled", lastRunAt: "2026-06-01T00:00:00Z", observedAt: "2026-06-05T00:00:00Z", severe: true },
  ],
});

describe("Results page wires the external-event ledger (N32)", () => {
  it("loads the tenant's external events with the deadline-bound pattern", () => {
    const s = src();
    expect(s).toContain("loadExternalEvents");
    // deadline-bound (self-hides + never wedges the page on a slow read). Find the CALL site
    // (loadExternalEvents(tenantId)), not the import line.
    const idx = s.indexOf("loadExternalEvents(tenantId)");
    expect(idx).toBeGreaterThan(-1);
    const around = s.slice(Math.max(0, idx - 200), idx + 120);
    expect(around).toContain("valueWithDeadline");
  });

  it("threads eventCaveatForWindow per row against the same shock windows", () => {
    const s = src();
    expect(s).toContain("eventCaveatForWindow");
    const idx = s.indexOf("eventCaveatForWindow({");
    const call = s.slice(idx, idx + 400);
    expect(call).toContain("shockWindows");
    expect(call).toContain("weatherSentence");
  });

  it("threads machineryOrCompoundFlagged into the N10 verdict-reliability call", () => {
    const s = src();
    expect(s).toContain("eventReliabilityFlagsForWindow");
    expect(s).toContain("machineryOrCompoundFlagged");
    expect(s).toContain("eventMachineryFlagById");
  });

  it("renders the event caveat behind the dedupe guard (shouldRenderEventCaveat)", () => {
    const s = src();
    expect(s).toContain("shouldRenderEventCaveat(eventCaveat, pres?.weatherCaveat)");
  });

  it("has no em or en dash around the event-caveat render block", () => {
    const s = src();
    const idx = s.indexOf("shouldRenderEventCaveat(eventCaveat");
    const around = s.slice(Math.max(0, idx - 400), idx + 200);
    expect(around).not.toMatch(/[‒–—―]/);
  });
});

describe("N32 row dedupe/self-hide (shouldRenderEventCaveat fed by the real cores)", () => {
  it("RENDERS on a non-shock overlap (a connector outage the weather guard does not cover)", () => {
    const eventCaveat = eventCaveatForWindow({
      windowStart: "2026-06-02",
      windowEnd: "2026-06-04",
      events: ledger,
      shockWindows: [confirmedShock],
      weatherSentence: null, // no shock overlaps this window, so no weather line
    });
    expect(eventCaveat).toContain("data pipeline stalled");
    // The weather guard rendered nothing here, so the event line shows.
    expect(shouldRenderEventCaveat(eventCaveat, null)).toBe(true);
    // Its non-shock reliability bit demotes N10.
    const flags = eventReliabilityFlagsForWindow({ windowStart: "2026-06-02", windowEnd: "2026-06-04", events: ledger });
    expect(flags.machineryOrCompoundFlagged).toBe(true);
  });

  it("DEDUPES with weather on a shock overlap: the event caveat equals the weather line, so it is NOT rendered twice", () => {
    const weather = weatherCaveatSentence(confirmedShock);
    const eventCaveat = eventCaveatForWindow({
      windowStart: "2026-03-12",
      windowEnd: "2026-03-15",
      events: ledger,
      shockWindows: [confirmedShock],
      weatherSentence: weather,
    });
    // The core returns the EXACT weather sentence for a shock...
    expect(eventCaveat).toBe(weather);
    // ...so the render guard suppresses the second copy (one sentence, never two).
    expect(shouldRenderEventCaveat(eventCaveat, weather)).toBe(false);
    // And N10 gets the shock via weatherQuarantined, NOT the machinery bit (no double-count).
    const flags = eventReliabilityFlagsForWindow({ windowStart: "2026-03-12", windowEnd: "2026-03-15", events: ledger });
    expect(flags).toEqual({ weatherQuarantined: true, machineryOrCompoundFlagged: false });
  });

  it("SELF-HIDES when the ledger is empty (no events means no caveat, byte-identical to before)", () => {
    const empty = buildExternalEventLedger({});
    const eventCaveat = eventCaveatForWindow({
      windowStart: "2026-06-02",
      windowEnd: "2026-06-04",
      events: empty,
      shockWindows: [],
      weatherSentence: null,
    });
    expect(eventCaveat).toBeNull();
    expect(shouldRenderEventCaveat(eventCaveat, null)).toBe(false);
  });

  it("self-hides on a clean window (no overlap) even when the ledger has events", () => {
    const eventCaveat = eventCaveatForWindow({
      windowStart: "2026-01-01",
      windowEnd: "2026-01-05",
      events: ledger,
      shockWindows: [confirmedShock],
      weatherSentence: null,
    });
    expect(eventCaveat).toBeNull();
    expect(shouldRenderEventCaveat(eventCaveat, null)).toBe(false);
  });

  it("the rendered non-shock caveat carries no banned dashes", () => {
    const eventCaveat = eventCaveatForWindow({
      windowStart: "2026-06-02",
      windowEnd: "2026-06-04",
      events: ledger,
      shockWindows: [confirmedShock],
    });
    expect(eventCaveat ?? "").not.toMatch(/[‒–—―]/);
  });
});
