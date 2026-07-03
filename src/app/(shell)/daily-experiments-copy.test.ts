import { describe, it, expect } from "vitest";
import { EXCLUDED_REASON_COPY, LEVER_LABEL, STATUS_LABEL, excludedReasonSentence, moveHeadline, trackingLine } from "./daily-experiments-copy";
import { assessPower } from "@/domains/experiments/power-analysis";

// The card must READ like a friendly strategist, not a science console. These words are the ones the
// operator called out ("lab console sucks / max jargon sucks"). None may appear in a primary label.
const LAB_JARGON = /\b(experiment|control|controls|proof|measuring|verify|verification|treatment|reserve|reserved|placebo|lever|baseline|diff-in-diff)\b/i;
const DASHES = /[–—]/; // en dash, em dash - banned everywhere

// Item 35: the power-gate sentences the card shows for marginal/underpowered picks (ExpectationLines
// in daily-experiments-section.tsx). Must read as plain business copy, never a stats-class term.
// Checked separately from `allStrings` below: these sentences legitimately use plain-English words
// like "prove" and "verify" ("slower to verify" is the operator-approved phrasing), which the
// generic LAB_JARGON sweep below treats as lab console jargon in a DIFFERENT context (e.g. "verify
// this change is live"). The power line still gets its own, stricter statistics-jargon guard.
const LAB_JARGON_POWER = /\b(power analysis|mde|coefficient of variation|noise floor|statistical|p-value|sample size|confidence interval)\b/i;
const marginalSentence = assessPower({ forecastLow: 30, forecastHigh: 40, mde: { mdeClicksPerMonth: 50, confidence: "estimated" } }).sentence;
const underpoweredSentence = assessPower({ forecastLow: 5, forecastHigh: 8, mde: { mdeClicksPerMonth: 100, confidence: "rough" } }).sentence;

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

  // Item 35 - the power-gate line the card shows for a thin-traffic pick.
  it("the marginal/underpowered power sentences never leak stats-class jargon", () => {
    for (const s of [marginalSentence, underpoweredSentence]) {
      expect(s, `"${s}" contains power-analysis jargon`).not.toMatch(LAB_JARGON_POWER);
    }
  });

  it("the power sentences never contain a banned dash", () => {
    for (const s of [marginalSentence, underpoweredSentence]) {
      expect(s, `"${s}" contains a banned dash`).not.toMatch(DASHES);
    }
  });

  it("the underpowered sentence names a real number and the honest 'spending the slot elsewhere' reasoning", () => {
    expect(underpoweredSentence).toMatch(/\d/);
    expect(underpoweredSentence.toLowerCase()).toContain("tonight's slot");
  });

  it("the marginal sentence reads as 'worth doing, slower to verify', never as a silent drop", () => {
    expect(marginalSentence.toLowerCase()).toContain("worth doing");
    expect(marginalSentence).toMatch(/\d/);
  });
});

// R14a - the "Why not the others?" sentences: every planner ExcludedReason code has plain
// copy, the planner's own frozen sentence wins when present, and a raw code can never leak.
describe("excludedReasonSentence (R14a)", () => {
  // Mirrors ExcludedReason in daily-experiment-planner.ts (EligibilityReason + planner codes).
  const ALL_REASONS = [
    "page_measuring", "active_control", "same_family_measuring", "recent_no_lift",
    "ownership_uncertain", "high_risk_page", "stale_research", "compound_edit",
    "insufficient_controls", "page_family_cap", "action_family_cap", "high_traffic_cap",
    "budget_full", "over_max", "influenced_conflict", "underpowered", "lever_retired",
    "interference_hold", "last_clean_donor", "query_overlap_hold", "evidence_expired",
  ];

  it("every ExcludedReason code has first-person plain copy with no jargon and no dashes", () => {
    for (const reason of ALL_REASONS) {
      const s = EXCLUDED_REASON_COPY[reason];
      expect(s, `missing copy for ${reason}`).toBeTruthy();
      expect(s, `"${s}" contains lab jargon`).not.toMatch(LAB_JARGON);
      expect(s, `"${s}" contains a banned dash`).not.toMatch(DASHES);
      expect(s, `"${s}" leaks the raw code`).not.toContain("_");
    }
  });

  it("prefers the planner's own frozen plainReason sentence when one exists", () => {
    const s = excludedReasonSentence({
      reason: "query_overlap_hold",
      plainReason: "I am holding this because it competes for the same searches as tonight's pick for /persian-cat.",
    });
    expect(s).toBe("I am holding this because it competes for the same searches as tonight's pick for /persian-cat.");
  });

  it("falls back to the code translation, then to an honest generic hold - never a raw code", () => {
    expect(excludedReasonSentence({ reason: "budget_full" })).toBe("Tonight's time budget was already full.");
    expect(excludedReasonSentence({ reason: "some_future_reason" })).toBe("I held this one back tonight.");
  });
});
