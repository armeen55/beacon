import { describe, it, expect } from "vitest";
import {
  humanizeDebateLine,
  summarizeSpecialistDebate,
  computeAgreement,
  devilsAdvocateLine,
} from "./debate-summary";
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

describe("computeAgreement (P5 item 387 - the agreement score)", () => {
  it("self-hides (line null) when only one teammate could pick an action", () => {
    const a = computeAgreement([op({ specialist: "gsc", suggestedMoveTypes: ["edit_existing_page"] })], "edit_existing_page");
    expect(a.line).toBeNull();
    expect(a.total).toBe(1);
    expect(a.agreed).toBe(1);
  });

  it("self-hides with zero voters (amplifier-only opinions never 'agree' on an action)", () => {
    // Revenue + Publishing suggest no action - they weight, they never pick.
    const a = computeAgreement(
      [op({ specialist: "ga4", suggestedMoveTypes: [] }), op({ specialist: "wix", suggestedMoveTypes: [] })],
      "edit_existing_page",
    );
    expect(a.line).toBeNull();
    expect(a.total).toBe(0);
  });

  it("states unanimous agreement among the voters", () => {
    const a = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["change_title_meta"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["change_title_meta"] }),
      ],
      "change_title_meta",
    );
    expect(a.agreed).toBe(2);
    expect(a.total).toBe(2);
    expect(a.line).toBe("All 2 teammates who could weigh in agreed on this.");
  });

  it("counts the majority and names the odd one out's worry from a real objection", () => {
    const a = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "dataforseo", suggestedMoveTypes: ["edit_existing_page"],
          objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "hard SERP", evidenceRefs: [] }] }),
      ],
      "create_page",
    );
    expect(a.agreed).toBe(2);
    expect(a.total).toBe(3);
    expect(a.line).toBe("2 of 3 teammates agreed on this. The odd one out (Live Google results) worried about how hard this search is to win.");
  });

  it("prefers the VETO worry over a downgrade worry when naming the odd one out", () => {
    const a = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "dataforseo", suggestedMoveTypes: ["edit_existing_page"],
          objections: [
            { kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "ranks", evidenceRefs: [] },
          ] }),
      ],
      "create_page",
    );
    expect(a.line).toContain("worried about doubling up on a page you already rank for");
  });

  it("emits no em or en dash in the agreement line", () => {
    const a = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "clarity", suggestedMoveTypes: ["fix_ux"],
          objections: [{ kind: "fix_ux_first", against: ["create_page"], severity: "downgrade", detail: "friction", evidenceRefs: [] }] }),
      ],
      "create_page",
    );
    expect(a.line).not.toBeNull();
    expect(/[–—]/.test(a.line!)).toBe(false);
  });
});

describe("devilsAdvocateLine (P5 item 231/314 - the strongest case against)", () => {
  it("is null (self-hides) when nobody argued against the move", () => {
    expect(devilsAdvocateLine([op({ suggestedMoveTypes: ["change_title_meta"] })])).toBeNull();
    expect(devilsAdvocateLine([])).toBeNull();
  });

  it("states the strongest objection's own detail as the skeptic's take", () => {
    const line = devilsAdvocateLine([
      op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "dataforseo",
        objections: [{ kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "You already rank in the top 10 - this is an EDIT, not a new page.", evidenceRefs: [] }] }),
    ]);
    // humanizeDebateLine de-shouts EDIT but leaves the plain hyphen (only stripBannedDashes,
    // applied in team-review, would swap a hyphen-with-spaces for a comma).
    expect(line).toBe("The skeptic's take: You already rank in the top 10 - this is an edit, not a new page.");
  });

  it("picks the VETO objection over a downgrade when both are present", () => {
    const line = devilsAdvocateLine([
      op({ specialist: "wix",
        objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste only", evidenceRefs: [] }] }),
      op({ specialist: "dataforseo",
        objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace SERP dominates", evidenceRefs: [] }] }),
    ]);
    expect(line).toContain("The skeptic's take:");
    expect(line).toContain("marketplace search results dominates");
  });

  it("falls back to the plain reason when the objection detail is empty", () => {
    const line = devilsAdvocateLine([
      op({ specialist: "gsc", suggestedMoveTypes: ["create_page"],
        objections: [{ kind: "no_measured_demand", against: ["create_page"], severity: "downgrade", detail: "", evidenceRefs: [] }] }),
    ]);
    expect(line).toBe("The skeptic's take: No proven search demand yet");
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
