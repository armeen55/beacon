import { describe, it, expect } from "vitest";
import { LEVER_LABEL, STATUS_LABEL, moveHeadline, trackingLine } from "./daily-experiments-copy";

// The card must READ like a friendly strategist, not a science console. These words are the ones the
// operator called out ("lab console sucks / max jargon sucks"). None may appear in a primary label.
const LAB_JARGON = /\b(experiment|control|controls|proof|measuring|verify|verification|treatment|reserve|reserved|placebo|lever|baseline|diff-in-diff)\b/i;
const DASHES = /[–—]/; // en dash, em dash - banned everywhere

const allStrings = [
  ...Object.values(LEVER_LABEL),
  ...Object.values(STATUS_LABEL),
  ...(["meta", "answer_block", "internal_link", "title", "h1"] as const).map((lever) => moveHeadline({ lever, pageLabel: "Chaharshanbe Suri" })),
  trackingLine(0),
  trackingLine(5),
];

describe("daily-experiments-copy — assistant-first, no lab jargon, no dashes", () => {
  it("no primary label leaks lab-console jargon", () => {
    for (const s of allStrings) {
      expect(s, `"${s}" contains lab jargon`).not.toMatch(LAB_JARGON);
    }
  });

  it("no em or en dashes anywhere in the card copy", () => {
    for (const s of allStrings) {
      expect(s, `"${s}" contains a banned dash`).not.toMatch(DASHES);
    }
  });

  it("moveHeadline reads as a friendly action per kind of change", () => {
    expect(moveHeadline({ lever: "meta", pageLabel: "Finglish" })).toBe("Sharpen the description on Finglish");
    expect(moveHeadline({ lever: "answer_block", pageLabel: "Chaharshanbe Suri" })).toBe("Put the answer first on Chaharshanbe Suri");
    expect(moveHeadline({ lever: "internal_link", pageLabel: "Nowruz" })).toContain("Add a helpful link");
    expect(moveHeadline({ lever: "title", pageLabel: "X" })).toContain("Tighten the title");
  });

  it("trackingLine explains the comparison in plain English", () => {
    expect(trackingLine(5)).toContain("5 similar pages");
    expect(trackingLine(1)).toContain("1 similar page");
    expect(trackingLine(1)).not.toContain("1 similar pages"); // pluralization
    expect(trackingLine(0)).toContain("First results in about a week");
  });

  it("status labels are plain (no 'measuring', 'verified', 'controls')", () => {
    expect(STATUS_LABEL.active).toBe("Live, tracking results");
    expect(STATUS_LABEL.verified_live).toBe("Change confirmed");
    expect(STATUS_LABEL.gsc_submitted).toBe("Sent to Google");
  });
});
