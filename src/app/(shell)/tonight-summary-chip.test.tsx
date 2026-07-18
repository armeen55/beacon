/**
 * TodaySummaryChip (FP5a, 2026-07-02) - render pins for the ONE line /changes
 * shows about today's batch, replacing the full DailyExperimentsSection that used
 * to render verbatim on BOTH / and /changes (the duplicate-home killer finding).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TodaySummaryChip } from "./tonight-summary-chip";

const SRC = readFileSync(resolve(__dirname, "tonight-summary-chip.tsx"), "utf8");

describe("TodaySummaryChip", () => {
  it("renders the one-line summary with both FP3 counts (panel lives below on /changes now)", () => {
    // Operator spec 2026-07-09 B-7: the batch panel moved to /changes, directly under
    // this chip - so the old "See them on Today" link is gone (it would be a dead end).
    const html = renderToStaticMarkup(<TodaySummaryChip picked={6} applied={6} />);
    expect(html).toContain("Today: 6 picked, 6 applied.");
    expect(html).not.toContain("See them on Today");
    expect(html).not.toContain('href="/"');
  });

  it("shows a partially applied batch honestly", () => {
    const html = renderToStaticMarkup(<TodaySummaryChip picked={5} applied={2} />);
    expect(html).toContain("Today: 5 picked, 2 applied.");
  });

  it("self-hides when nothing is picked (no bare-zero chip)", () => {
    expect(renderToStaticMarkup(<TodaySummaryChip picked={0} applied={0} />)).toBe("");
  });

  it("never emits an em or en dash", () => {
    const html = renderToStaticMarkup(<TodaySummaryChip picked={3} applied={1} />);
    expect(html).not.toMatch(/[–—]/);
  });

  it("never claims scheduled/overnight timing (Beacon has no scheduler)", () => {
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
