import { describe, it, expect } from "vitest";
import type { EvidencePacket } from "./evidence-packet";
import type { GapKind, MoveComponents } from "./build-graph";
import type { Specialist, SpecialistOpinion } from "./specialist-opinions";
import { routeMove, GAP_TO_ACTION, parentTypeForAction } from "./move-router";

const STALE = "2026-06-26T00:00:00.000Z";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000,
  winnability: 0.8,
  dollarValue: 0,
  visibilityGap: 0.5,
  friction: 0,
  ...over,
});

function packet(gapType: GapKind, over: Partial<EvidencePacket["move"]> = {}): EvidencePacket {
  return {
    move: {
      key: "k1",
      gapType,
      label: "persian wedding traditions",
      confidence: "medium",
      score: 1000,
      components: components(),
      signals: ["GSC"],
      ...over,
    },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: [] },
    competitor: { topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "—", relevance: 0, looselyMatched: false, otherUrls: [] },
    yourPage: { url: "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0 },
    gaps: [],
    draft: { kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [], answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "" },
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "h1",
  };
}

function op(over: Partial<SpecialistOpinion> & { specialist: Specialist }): SpecialistOpinion {
  return {
    claim: "",
    evidenceRefs: [],
    confidence: 0.7,
    suggestedMoveTypes: [],
    objections: [],
    scoreContribution: {},
    staleAt: STALE,
    ...over,
  };
}

describe("routeMove — graceful degradation", () => {
  it("with NO opinions reproduces the graph gap + score (cannot regress today)", () => {
    for (const gap of ["create_page", "edit_page", "answer_block", "fix_experience", "healthy"] as GapKind[]) {
      const d = routeMove({ packet: packet(gap), opinions: [] });
      expect(d.action).toBe(GAP_TO_ACTION[gap]);
      expect(d.adjustedScore).toBe(d.baseScore);
      expect(d.baseScore).toBe(1000);
    }
  });
});

describe("routeMove — vetoes override the action", () => {
  it("cant_outrank_serp veto demotes create_page to wait", () => {
    const d = routeMove({
      packet: packet("create_page"),
      opinions: [op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("wait");
    expect(d.appliedObjections.some((o) => o.kind === "cant_outrank_serp")).toBe(true);
  });

  it("already_ranks veto re-routes create_page to an edit", () => {
    const d = routeMove({
      packet: packet("create_page"),
      opinions: [op({ specialist: "dataforseo", suggestedMoveTypes: ["edit_existing_page"], objections: [{ kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "ranks", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("edit_existing_page");
  });
});

describe("routeMove — Clarity is a downgrade in Sprint 1 (not a veto)", () => {
  it("keeps the content action but cuts the score and records the objection", () => {
    const d = routeMove({
      packet: packet("answer_block"),
      opinions: [op({ specialist: "clarity", suggestedMoveTypes: ["fix_ux"], objections: [{ kind: "fix_ux_first", against: ["add_answer_block"], severity: "downgrade", detail: "friction", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("add_answer_block"); // not overridden — downgrade, not veto
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
    expect(d.appliedObjections.some((o) => o.kind === "fix_ux_first")).toBe(true);
  });
});

describe("routeMove — Google + AI overlap boost", () => {
  it("raises confidence and score when GSC + Profound + DataForSEO overlap all agree", () => {
    const boosted = routeMove({
      packet: packet("create_page", { confidence: "medium" }),
      opinions: [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "dataforseo", suggestedMoveTypes: ["create_page"], scoreContribution: { scoreMultiplier: 1.3 } }),
      ],
    });
    expect(boosted.adjustedScore).toBeGreaterThan(boosted.baseScore);
    expect(boosted.adjustedScore).toBe(1300);
    expect(boosted.confidence).toBeGreaterThan(0.6);
  });
});

describe("routeMove — bounded downgrades cut the score", () => {
  it("not_pushable lowers the adjusted score and is recorded", () => {
    const d = routeMove({
      packet: packet("edit_page"),
      opinions: [op({ specialist: "wix", objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste-only", evidenceRefs: [] }], scoreContribution: { scoreMultiplier: 0.9 } })],
    });
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
    expect(d.appliedObjections.some((o) => o.kind === "not_pushable")).toBe(true);
  });
});

describe("routeMove — debate partition + parent types", () => {
  it("splits supporting vs dissenting opinions and maps the parent type", () => {
    const d = routeMove({
      packet: packet("edit_page"),
      opinions: [
        op({ specialist: "gsc", suggestedMoveTypes: ["change_title_meta"] }), // supports the winner
        op({ specialist: "profound", suggestedMoveTypes: ["add_answer_block"] }), // dissents
      ],
    });
    expect(d.action).toBe("change_title_meta");
    expect(d.parentType).toBe("content_move");
    expect(d.supporting.map((o) => o.specialist)).toContain("gsc");
    expect(d.dissenting.map((o) => o.specialist)).toContain("profound");
  });

  it("parentTypeForAction maps the taxonomy", () => {
    expect(parentTypeForAction("add_answer_block")).toBe("aeo_move");
    expect(parentTypeForAction("fix_ux")).toBe("cro_move");
    expect(parentTypeForAction("create_asset")).toBe("asset_move");
    expect(parentTypeForAction("wait")).toBe("wait");
  });
});
