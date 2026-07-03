/**
 * results-csv (R14b) - shape pins for the /results spreadsheet download:
 * plain-word columns, one row per shipped change, never a raw verdict key.
 */
import { describe, expect, it } from "vitest";
import { buildResultsCsv, RESULTS_CSV_HEADERS, type ResultsCsvRow } from "./results-csv";

const WON: ResultsCsvRow = {
  path: "/best-persian-restaurants",
  actionType: "edit_meta",
  shippedAt: "2026-06-01T10:00:00.000Z",
  verdict: "won",
  windows: [
    { day: 7, ran: true, controlsUsed: 3, adjustedLift: 10, adjustedCtrLift: 0.004, adjustedPosLift: 0 },
    { day: 28, ran: true, controlsUsed: 3, adjustedLift: 40, adjustedCtrLift: 0.006, adjustedPosLift: 0 },
  ],
  baseline: { impressions: 1200, clicks: 40 },
  controlPages: ["/a", "/b", "/c"],
};

const MEASURING: ResultsCsvRow = {
  path: "/persian-tea",
  actionType: "add_answer_block",
  shippedAt: "2026-06-28T08:00:00.000Z",
  verdict: "measuring",
  windows: [{ day: 7, ran: false }],
  baseline: { impressions: 300, clicks: 9 },
  controlPages: ["/x", "/y"],
};

describe("buildResultsCsv", () => {
  it("emits the header row then one plain-word row per change", () => {
    const csv = buildResultsCsv([WON, MEASURING]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(RESULTS_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3);
    // the won row reads its 28-day basis window in the metric it was judged on (CTR for meta)
    expect(lines[1]).toContain("/best-persian-restaurants");
    expect(lines[1]).toContain("description change");
    expect(lines[1]).toContain("2026-06-01");
    expect(lines[1]).toContain("Helped");
    expect(lines[1]).toContain("28");
    // the measuring row has no basis window yet: blank read columns, honest status
    expect(lines[2]).toContain("Still measuring");
    expect(lines[2]).toContain("/persian-tea");
  });

  it("never leaks a raw action key, and raw verdict keys wear plain words", () => {
    const csv = buildResultsCsv([WON, MEASURING]);
    expect(csv).not.toContain("edit_meta");
    expect(csv).not.toContain("add_answer_block");
    // status column: the raw "won" key renders as "Helped", never bare
    expect(csv).toContain(",Helped,");
    expect(csv).toContain(",Still measuring,");
    expect(csv).not.toContain(",won,");
    expect(csv).not.toContain(",measuring,");
  });

  it("never emits an em or en dash", () => {
    expect(buildResultsCsv([WON, MEASURING])).not.toMatch(/[‒–—―]/);
  });
});
