/**
 * seasonal/seasonality-voice tests (BEACON_500 item 69).
 *
 * Pins: abstains with no profile, objects (downgrade, never veto) when
 * shipping into a demand cliff, flags proactive "prep now" when the next
 * window opens 4-8 weeks out, stays silent otherwise, and the hard no-dash
 * rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { emitSeasonalOpinion, CLIFF_LOOKAHEAD_DAYS, PREP_LEAD_MIN_WEEKS, PREP_LEAD_MAX_WEEKS } from "./seasonality-voice";
import type { FamilyDemandProfile } from "./family-demand-profile";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

function packet(url: string | null = "/cheetah/species"): EvidencePacket {
  return {
    move: { key: "k1", gapType: "edit_page", label: "cheetah facts", confidence: "medium", score: 50, components: { demand: 10, winnability: 0, visibilityGap: 0, dollarValue: 0, friction: 0 }, signals: ["GSC"] },
    demand: { demandWeight: 10, basis: "gsc", queries: ["cheetah facts"], fanoutSeeds: [] },
    competitor: { topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "", relevance: 0, looselyMatched: false, otherUrls: [] },
    yourPage: { url, facts: null, gsc: { clicks: 10, impressions: 500, ctr: 0.02, position: 8 }, dollarValue: 0, friction: 0 },
    gaps: [],
    draft: { schemaRecommendations: [], assetSpec: null, asset: null, note: "" },
    proofPlan: { metrics: [], windowsDays: [7, 14, 28], controls: "" },
    evidenceHash: "h1",
  } as unknown as EvidencePacket;
}

function profile(over: Partial<FamilyDemandProfile> = {}): FamilyDemandProfile {
  return {
    pageFamily: "cheetah",
    weeksOfHistory: 6,
    yearsOfHistory: 1,
    weekly: [],
    annual: [],
    samplePages: ["/cheetah/species"],
    ...over,
  };
}

describe("emitSeasonalOpinion - abstention", () => {
  it("abstains when no profile is threaded (undefined extras)", () => {
    expect(emitSeasonalOpinion(packet(), {})).toBeNull();
  });

  it("abstains when seasonalProfile is explicitly null", () => {
    expect(emitSeasonalOpinion(packet(), { seasonalProfile: null })).toBeNull();
  });

  it("stays silent when the profile has an annual window but now is neither inside the cliff lookahead nor the prep-lead window", () => {
    // Peak in March; "now" is right after New Year's - about 9-10 weeks out, past the 8-week prep band.
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    const now = new Date("2026-01-01T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).toBeNull();
  });
});

describe("emitSeasonalOpinion - demand cliff objection", () => {
  it("objects (downgrade, never veto) when now sits inside the peak window close to its end", () => {
    expect(CLIFF_LOOKAHEAD_DAYS).toBe(10);
    // Peak window is March only; "now" = March 25 -> 6 days from the window closing (April 1).
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "repeated" }] });
    const now = new Date("2026-03-25T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).not.toBeNull();
    expect(out!.specialist).toBe("seasonal");
    expect(out!.objections).toHaveLength(1);
    expect(out!.objections[0]!.kind).toBe("seasonal_demand_cliff");
    expect(out!.objections[0]!.severity).toBe("downgrade");
    expect(out!.claim).toMatch(/falling edge/);
  });

  it("uses singular 'day' (not '1 days') when the window closes tomorrow", () => {
    const p = profile({ annual: [{ months: [5, 6], share: 1, annualImpressions: 4000, confidence: "one_season" }] });
    // Window is May 1 - July 1 (exclusive); June 30 is 1 day from closing.
    const now = new Date("2026-06-30T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).not.toBeNull();
    expect(out!.claim).toMatch(/about 1 day\. /);
    expect(out!.claim).not.toMatch(/1 days/);
  });

  it("does not fire the cliff objection when comfortably inside the window (far from closing)", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "repeated" }] });
    const now = new Date("2026-03-05T00:00:00Z"); // ~27 days to close - well outside the 10-day lookahead
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).toBeNull();
  });
});

describe("emitSeasonalOpinion - proactive prep", () => {
  it("flags 'prep now' when the next annual window opens 4-8 weeks out", () => {
    expect(PREP_LEAD_MIN_WEEKS).toBe(4);
    expect(PREP_LEAD_MAX_WEEKS).toBe(8);
    // Peak in March; now = mid-January -> about 6-7 weeks to March 1.
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    const now = new Date("2026-01-15T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).not.toBeNull();
    expect(out!.claim).toMatch(/prep now/i);
    expect(out!.objections).toEqual([]); // proactive prep is informational, not an objection
  });

  it("stays silent when the next window is more than 8 weeks out", () => {
    const p = profile({ annual: [{ months: [6], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    const now = new Date("2026-01-01T00:00:00Z"); // ~22 weeks to June
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out).toBeNull();
  });
});

describe("emitSeasonalOpinion - evidence + confidence discipline", () => {
  it("always attaches at least one evidenceRef pointing at computed family data", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "repeated" }] });
    const now = new Date("2026-03-25T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out!.evidenceRefs.length).toBeGreaterThan(0);
    expect(out!.evidenceRefs[0]!.specialist).toBe("seasonal");
    expect(out!.evidenceRefs[0]!.source).toBe("computed");
  });

  it("confidence stays within 0..1", () => {
    const p = profile({ annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }] });
    const now = new Date("2026-03-25T00:00:00Z");
    const out = emitSeasonalOpinion(packet(), { nowIso: now.toISOString(), seasonalProfile: p });
    expect(out!.confidence).toBeGreaterThanOrEqual(0);
    expect(out!.confidence).toBeLessThanOrEqual(1);
  });
});

describe("dash guard (hard rule)", () => {
  it("the seasonality-voice module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "seasonality-voice.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
