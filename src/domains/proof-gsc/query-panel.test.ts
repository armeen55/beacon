import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeQueryPanelOutcome, type QueryPanelWindow } from "./query-panel";

/**
 * query-panel.test.ts (P4 R10a, v1 item 150) - pins the fixed-query-panel
 * math: the panel/page percent pair, the direction-disagreement call with
 * its 5 percent noise floor, both plain disagreement sentences, the pre-window
 * pro-rating, and the honest-absence rules (thin panel -> null; thin clicks
 * -> percent null, never a fabricated rate).
 */

const win = (clicks: number, impressions: number): QueryPanelWindow => ({
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position: impressions > 0 ? 5 : 0,
});

const base = {
  queriesInPanel: 3,
  windowDays: 28,
  preWindowDays: 28,
  panelPre: win(100, 1000),
  panelPost: win(112, 1000),
  pagePreClicks: 400,
  pagePostClicks: 380,
};

describe("computeQueryPanelOutcome - disagreement", () => {
  it("panel up while the page fell: the exact plain sentence", () => {
    const out = computeQueryPanelOutcome(base);
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeCloseTo(0.12, 5);
    expect(out!.pageClicksPct).toBeCloseTo(-0.05, 5);
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toBe(
      "The searches this change targeted grew 12 percent, but the page overall fell 5 percent. Something else on the page lost ground.",
    );
  });

  it("panel down while the page grew: the gain-from-other-searches sentence", () => {
    const out = computeQueryPanelOutcome({
      ...base,
      panelPost: win(80, 900),
      pagePostClicks: 480,
    });
    expect(out).not.toBeNull();
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toBe(
      "The searches this change targeted fell 20 percent, but the page overall grew 20 percent. The gain is coming from other searches, not the ones we aimed at.",
    );
  });

  it("agreeing directions carry no disagreement sentence", () => {
    const out = computeQueryPanelOutcome({ ...base, pagePostClicks: 440 });
    expect(out).not.toBeNull();
    expect(out!.disagreesWithPage).toBe(false);
    expect(out!.sentence).toBeNull();
  });

  it("movement under the 5 percent floor on either side never counts as disagreement", () => {
    // Panel +2 percent, page -20 percent: the panel side is inside noise.
    const out = computeQueryPanelOutcome({
      ...base,
      panelPost: win(102, 1000),
      pagePostClicks: 320,
    });
    expect(out).not.toBeNull();
    expect(out!.disagreesWithPage).toBe(false);
    expect(out!.sentence).toBeNull();
  });

  it("pro-rates the pre window to a shorter post window before comparing", () => {
    // 7-day window vs a 28-day pre: 100 pre clicks scale to 25.
    const out = computeQueryPanelOutcome({
      ...base,
      windowDays: 7,
      panelPost: win(30, 300),
      pagePreClicks: 400, // scales to 100
      pagePostClicks: 80,
    });
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeCloseTo(0.2, 5);
    expect(out!.pageClicksPct).toBeCloseTo(-0.2, 5);
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toContain("grew 20 percent");
    expect(out!.sentence).toContain("fell 20 percent");
  });
});

describe("computeQueryPanelOutcome - honest absence", () => {
  it("null when the panel had no real pre-ship presence (under 50 impressions)", () => {
    const out = computeQueryPanelOutcome({ ...base, panelPre: win(10, 30) });
    expect(out).toBeNull();
  });

  it("null when there were no query-grain rows at all (all-zero pre window)", () => {
    const out = computeQueryPanelOutcome({ ...base, panelPre: win(0, 0), panelPost: win(0, 0) });
    expect(out).toBeNull();
  });

  it("percent is null (never a fabricated rate) when the pro-rated pre clicks are too thin", () => {
    const out = computeQueryPanelOutcome({
      ...base,
      panelPre: win(2, 500),
      panelPost: win(9, 500),
    });
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeNull();
    expect(out!.disagreesWithPage).toBe(false);
    expect(out!.sentence).toBeNull();
  });

  it("null on an empty panel", () => {
    expect(computeQueryPanelOutcome({ ...base, queriesInPanel: 0 })).toBeNull();
  });
});

describe("computeQueryPanelOutcome - the always-available panel line", () => {
  it("names the panel size and the before/after clicks in window units", () => {
    const out = computeQueryPanelOutcome({ ...base, windowDays: 7, panelPost: win(30, 300) });
    expect(out!.panelLine).toBe(
      "The 3 searches this change targeted went from about 25 clicks to 30 clicks over the 7 day window.",
    );
  });

  it("uses the singular form for a one-query panel", () => {
    const out = computeQueryPanelOutcome({ ...base, queriesInPanel: 1 });
    expect(out!.panelLine).toContain("The 1 search this change targeted");
  });
});

describe("copy guard - dash-clean, no em or en dashes in source", () => {
  it("query-panel.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "query-panel.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
    expect(src.includes("\u2013")).toBe(false);
  });
});
