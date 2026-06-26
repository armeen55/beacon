import { describe, it, expect } from "vitest";
import { summarizeSpecialistDebate } from "./debate-summary";
import type { SpecialistOpinion } from "./specialist-opinions";

const op = (over: Partial<SpecialistOpinion>): SpecialistOpinion => ({
  specialist: "gsc",
  claim: "Demand exists",
  evidenceRefs: [],
  confidence: 0.8,
  suggestedMoveTypes: [],
  objections: [],
  scoreContribution: {},
  staleAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("summarizeSpecialistDebate", () => {
  it("ranks voices by conviction and maps operator labels", () => {
    const s = summarizeSpecialistDebate([
      op({ specialist: "clarity", claim: "Lots of rage clicks", confidence: 0.5 }),
      op({ specialist: "gsc", claim: "5k impressions", confidence: 0.9 }),
    ]);
    expect(s.voices[0].label).toBe("Search demand"); // 0.9 leads
    expect(s.voices[0].confidencePct).toBe(90);
    expect(s.voices[1].label).toBe("Visitor behavior");
  });

  it("surfaces objections with veto first + flags hasVeto", () => {
    const s = summarizeSpecialistDebate([
      op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace SERP", evidenceRefs: [] }] }),
      op({ specialist: "wix", objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste only", evidenceRefs: [] }] }),
    ]);
    expect(s.hasVeto).toBe(true);
    expect(s.objections[0].severity).toBe("veto");
    expect(s.objections[0].reason).toMatch(/hard to win/);
    expect(s.headline).toMatch(/1 blocking/);
  });

  it("computes consensus + an honest empty headline", () => {
    expect(summarizeSpecialistDebate([]).headline).toMatch(/enough data/);
    expect(summarizeSpecialistDebate([]).consensusPct).toBe(0);
    const s = summarizeSpecialistDebate([op({ confidence: 0.6 }), op({ specialist: "ga4", confidence: 0.8 })]);
    expect(s.consensusPct).toBe(70);
    expect(s.headline).toMatch(/no objections/);
  });

  it("ignores malformed opinions (no claim) and clamps confidence", () => {
    const s = summarizeSpecialistDebate([op({ claim: "" }), op({ confidence: 2 })]);
    expect(s.voices).toHaveLength(1);
    expect(s.voices[0].confidencePct).toBe(100);
  });
});
