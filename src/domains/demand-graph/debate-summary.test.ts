import { describe, it, expect } from "vitest";
import { humanizeDebateLine, summarizeSpecialistDebate } from "./debate-summary";
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

describe("operator-friendly fallback labels (B82++ reliability)", () => {
  it("an unknown specialist/objection key never leaks a raw machine token to the UI", () => {
    const s = summarizeSpecialistDebate([
      op({ specialist: "totally_new_specialist" as never, claim: "x", confidence: 0.5,
        objections: [{ kind: "brand_new_kind" as never, against: [], severity: "downgrade", detail: "d", evidenceRefs: [] }] }),
    ]);
    expect(s.voices[0].label).toBe("Another specialist");
    expect(s.voices[0].label).not.toContain("_");
    expect(s.objections[0].reason).toBe("Flagged a concern");
  });
});

describe("humanizeDebateLine (item 39 - no robotic template phrasing)", () => {
  it("pluralizes counted '(s)' templates properly", () => {
    expect(humanizeDebateLine("AI cites 3 competitor page(s) for this topic.")).toBe("AI cites 3 competitor pages for this topic.");
    expect(humanizeDebateLine("found 2 schema type(s) on the page")).toBe("found 2 schema types on the page");
  });

  it("a count of one becomes an article, not '1 ... page(s)'", () => {
    expect(humanizeDebateLine("AI cites 1 competitor page(s) for this topic.")).toBe("AI cites a competitor page for this topic.");
    expect(humanizeDebateLine("has 1 answerable question(s) at the top")).toBe("has an answerable question at the top");
  });

  it("a bare 'word(s)' with no count becomes the plural", () => {
    expect(humanizeDebateLine("competitor page(s) own this demand")).toBe("competitor pages own this demand");
  });

  it("spaces out snake_case tokens but never touches URLs or paths", () => {
    expect(humanizeDebateLine("create_page vetoed: you already rank for this.")).toBe("create page vetoed: you already rank for this.");
    expect(humanizeDebateLine("see https://x.com/some_page_here for details")).toBe("see https://x.com/some_page_here for details");
  });

  it("de-shouts enum words but keeps real initialisms", () => {
    expect(humanizeDebateLine("you have NO page at all")).toBe("you have no page at all");
    expect(humanizeDebateLine("it's an EDIT, not a new page")).toBe("it's an edit, not a new page");
    expect(humanizeDebateLine("Ranks #4 with 1.2% CTR and AI citations")).toBe("Ranks #4 with 1.2% CTR and AI citations");
  });

  it("swaps lab tokens for plain words", () => {
    expect(humanizeDebateLine("SERP is marketplace/UGC-dominated (5/10)")).toBe("The search results are marketplace/forum-dominated (5/10)");
    expect(humanizeDebateLine("Live SERP verdict: build.")).toBe("Live search results verdict: build.");
    expect(humanizeDebateLine("DataForSEO: you already rank")).toBe("Live Google results: you already rank");
  });

  it("is applied to every claim and objection detail in the summary", () => {
    const s = summarizeSpecialistDebate([
      op({ claim: "AI cites 2 competitor page(s) for this topic.",
        objections: [{ kind: "cant_outrank_serp", against: [], severity: "veto", detail: "SERP is marketplace/UGC-dominated (6/10)", evidenceRefs: [] }] }),
    ]);
    expect(s.voices[0].claim).toBe("AI cites 2 competitor pages for this topic.");
    expect(s.objections[0].detail).toBe("The search results are marketplace/forum-dominated (6/10)");
  });
});
