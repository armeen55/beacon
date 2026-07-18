import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { proofBadgeLabel, proofBadgeMaturesOn } from "./proof-badge";
import { plainSearchHeadline } from "./proof-plain-search-line";
import { buildMeasurementPresentation, type MaturityInput } from "@/domains/proof-gsc/measurement-maturity";

/**
 * proof-split-clock (MASTER PLAN v2 N11, operator correction 2026-07-02) - the
 * recrawl gate applies ONLY to Google-search outcomes. Pins the split:
 *
 *   SEARCH lane (GSC ranking / impressions / clicks / CTR): gated. A row whose
 *   recrawl is unconfirmed reads Waiting, leaks no direction, shows no false
 *   "matures" countdown, and never trains learning.
 *
 *   TRAFFIC/BEHAVIOR lane (GA4 trafficOutcome, Clarity, conversions): NOT
 *   gated. Their clock is live_at; the /results card renders the traffic read
 *   unconditionally on rec.trafficOutcome - never behind any recrawl check.
 *
 * Also pins that the C2 badge vocabulary (six words) and the C4 See-the-math
 * structure survive the gate: a recrawl-pending row maps to exactly "Waiting"
 * and its plain Search line is "Not clear yet." - no new badge words.
 */

const NOW = new Date("2026-06-30T12:00:00Z");

function pendingInput(over: Partial<MaturityInput> = {}): MaturityInput {
  return {
    shippedAt: "2026-06-17",
    now: NOW,
    latestGscDate: "2026-06-27",
    windows: [
      { day: 7, ran: true },
      { day: 14, ran: false },
      { day: 28, ran: false },
    ],
    verdict: "lost",
    controlsUsed: 3,
    baselineImpressions: 4000,
    overlap: null,
    live: true,
    recrawlPending: true,
    recrawlDaysBlind: 13,
    ...over,
  };
}

describe("split clock - SEARCH lane is recrawl-gated", () => {
  it("a recrawl-pending row's badge is exactly 'Waiting' (C2 vocabulary preserved, no new words)", () => {
    const pres = buildMeasurementPresentation(pendingInput());
    expect(proofBadgeLabel(pres)).toBe("Waiting");
  });
  it("no false countdown: the badge secondary 'matures X' text is silent while the search clock has not started", () => {
    const pres = buildMeasurementPresentation(pendingInput());
    expect(proofBadgeMaturesOn(pres)).toBeNull();
  });
  it("the plain Search line is 'Not clear yet.' - a stale-index lean never renders as probably helping/hurting", () => {
    const pres = buildMeasurementPresentation(pendingInput({ verdict: "lost" }));
    expect(plainSearchHeadline(pres.direction, false)).toBe("Not clear yet.");
  });
  it("the caveat names both clocks: search waiting, visit tracking already running", () => {
    const pres = buildMeasurementPresentation(pendingInput());
    expect(pres.recrawlPendingCaveat).toContain("so the search clock has not started");
    expect(pres.recrawlPendingCaveat).toContain("Visit tracking started the day the change went live.");
  });
});

describe("split clock - TRAFFIC lane is NOT recrawl-gated (source pin on the /results card)", () => {
  const source = readFileSync(resolve(__dirname, "results-ledger-card.tsx"), "utf8");

  it("the GA4 traffic block renders unconditionally on rec.trafficOutcome", () => {
    // The exact unconditional JSX condition - if someone wraps it in a recrawl
    // check, this literal disappears and the pin fails loudly.
    expect(source).toContain("{rec.trafficOutcome ? (() => {");
  });
  it("no recrawl field ever gates the traffic/citation/rank attachment renders", () => {
    // recrawl* identifiers may appear ONLY in the presentation input wiring and
    // the visible caveat line - never combined with an attachment render. Scan
    // EVERY occurrence of each attachment so a gate added at any of them fails.
    const attachmentBlocks = ["rec.trafficOutcome", "rec.citationOutcome", "rec.rankOutcome"];
    for (const marker of attachmentBlocks) {
      let idx = source.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      while (idx !== -1) {
        // No recrawl reference within the 300 chars leading into the
        // attachment usage (i.e., its guarding condition).
        const guardWindow = source.slice(Math.max(0, idx - 300), idx);
        expect(guardWindow).not.toContain("recrawlPending");
        expect(guardWindow).not.toContain("recrawlConfirmedAt");
        idx = source.indexOf(marker, idx + marker.length);
      }
    }
  });
  it("the visible recrawl caveat line renders through the same seam as the sibling guards", () => {
    expect(source).toContain("{pres?.recrawlPendingCaveat ? (");
  });
});
