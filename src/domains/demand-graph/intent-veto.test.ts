import { describe, it, expect } from "vitest";
import type { EvidencePacket } from "./evidence-packet";
import type { GapKind, MoveComponents } from "./build-graph";
import { checkIntentVeto } from "./intent-veto";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000,
  winnability: 0.8,
  dollarValue: 0,
  visibilityGap: 0.5,
  friction: 0,
  ...over,
});

function packet(
  label: string,
  gapType: GapKind = "answer_block",
  fanoutSeeds: string[] = [],
  queries: EvidencePacket["demand"]["queries"] = [],
): EvidencePacket {
  return {
    move: {
      key: "k1",
      gapType,
      label,
      confidence: "medium",
      score: 1000,
      components: components(),
      signals: ["GSC"],
    },
    demand: { demandWeight: 1000, basis: "gsc", queries, fanoutSeeds },
    competitor: { topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "-", relevance: 0, looselyMatched: false, otherUrls: [] },
    yourPage: { url: "https://example.com/page", facts: null, gsc: null, dollarValue: 0, friction: 0 },
    research: null,
    gaps: [],
    draft: { kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [], answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "" },
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "h1",
  };
}

describe("checkIntentVeto - abstains (silent, conservative)", () => {
  it("returns null when the label has no classifiable signal", () => {
    expect(checkIntentVeto({ packet: packet(""), action: "add_answer_block" })).toBeNull();
  });

  it("returns null for a plain 'what is' style label on an answer block (the lever fits)", () => {
    const p = packet("persian wedding traditions", "answer_block");
    expect(checkIntentVeto({ packet: p, action: "add_answer_block" })).toBeNull();
  });

  it("returns null for create_page (not an answer-shaped lever) even on a date query", () => {
    const p = packet("chaharshanbe suri 2026", "create_page");
    expect(checkIntentVeto({ packet: p, action: "create_page" })).toBeNull();
  });

  it("returns null for fix_ux (not answer-shaped, not title/meta, not create_page)", () => {
    const p = packet("chaharshanbe suri 2026", "fix_experience");
    expect(checkIntentVeto({ packet: p, action: "fix_ux" })).toBeNull();
  });

  it("returns null on a navigational-looking label when the action isn't change_title_meta", () => {
    const p = packet("iranopedia login", "answer_block");
    expect(checkIntentVeto({ packet: p, action: "add_answer_block" })).toBeNull();
  });

  it("returns null on a transactional label when tenantHasNoTransactionalSurface is unset (unknown, not guessed)", () => {
    const p = packet("buy persian rug", "create_page");
    expect(checkIntentVeto({ packet: p, action: "create_page" })).toBeNull();
  });

  it("returns null on a transactional label when the tenant DOES have a transactional surface", () => {
    const p = packet("buy persian rug now", "create_page");
    expect(
      checkIntentVeto({ packet: p, action: "create_page", tenantHasNoTransactionalSurface: false }),
    ).toBeNull();
  });
});

describe("checkIntentVeto - rule 1: answer-shaped lever cannot serve a date/price lookup (the chaharshanbe bug)", () => {
  it("uses real impression-weighted GSC queries instead of guessing from the move label", () => {
    const p = packet("nowruz traditions", "answer_block", [], [
      { query: "when is nowruz 2027", impressions: 900, source: "gsc" },
      { query: "nowruz traditions", impressions: 100, source: "gsc" },
    ]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    expect(obj?.severity).toBe("veto");
    expect(obj?.detail).toContain("when is nowruz 2027");
    expect(obj?.evidenceRefs[0]?.detail).toContain("90%");
  });

  it("VETOes add_answer_block when the dominant intent is clearly 'when' (a date)", () => {
    const p = packet("chaharshanbe suri 2026", "answer_block", ["when is chaharshanbe suri", "chaharshanbe suri date"]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    expect(obj).not.toBeNull();
    expect(obj!.kind).toBe("wrong_lever_for_intent");
    expect(obj!.severity).toBe("veto");
    expect(obj!.against).toEqual(["add_answer_block"]);
    // Constitution law 2: the objection must name its evidence (the real queries).
    expect(obj!.detail).toContain("chaharshanbe suri");
    expect(obj!.detail).toContain("date");
    expect(obj!.evidenceRefs.length).toBeGreaterThan(0);
    expect(obj!.evidenceRefs[0]!.detail).toContain("when");
  });

  it("uses the plain-English 'that question wants a date, not a definition' phrasing", () => {
    const p = packet("chaharshanbe suri 2026", "answer_block", ["chaharshanbe suri date 2026"]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    expect(obj!.detail).toContain("That question wants a date, not a definition");
    expect(obj!.detail).toContain("blocked");
  });

  it("VETOes add_answer_block the same way on a cost/price query", () => {
    const p = packet("how much does a persian rug cost", "answer_block", ["persian rug price", "persian rug cost per square foot"]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    expect(obj).not.toBeNull();
    expect(obj!.severity).toBe("veto");
    expect(obj!.detail).toContain("a price");
  });

  it("does NOT fire on change_title_meta for a when/cost mismatch (a title can still promise a date without changing shape)", () => {
    const p = packet("chaharshanbe suri 2026", "edit_page", ["when is chaharshanbe suri", "chaharshanbe suri date"]);
    expect(checkIntentVeto({ packet: p, action: "change_title_meta" })).toBeNull();
  });

  it("downgrades (not vetoes) when the dominant share is only 'probable' (0.4-0.55)", () => {
    // Mix the label (weight 2, "what") with fanouts that split across "when" (weight 1 x2) so the
    // "when" share lands in the probable-not-certain band.
    const p = packet("nowruz traditions", "answer_block", ["when is nowruz", "nowruz date this year"]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    // label=2 "what" (nowruz traditions has no when/cost/etc cue -> defaults to "what"),
    // fanouts=2 "when" -> when share = 2/4 = 0.5, inside [0.4, 0.55) -> downgrade.
    expect(obj).not.toBeNull();
    expect(obj!.severity).toBe("downgrade");
    expect(obj!.detail).toContain("flagged");
  });

  it("never fires on 'what'/'how'/'where'/'who'/'list'/'compare' dominant intents (only when/cost break an answer block)", () => {
    const cases: Array<[string, GapKind]> = [
      ["how to make persian tea", "answer_block"],
      ["best persian restaurants near me", "answer_block"],
      ["who invented backgammon", "answer_block"],
      ["persian vs turkish rugs", "answer_block"],
    ];
    for (const [label, gap] of cases) {
      const obj = checkIntentVeto({ packet: packet(label, gap), action: "add_answer_block" });
      expect(obj).toBeNull();
    }
  });
});

describe("checkIntentVeto - rule 2: title/meta rewrite on a navigational query", () => {
  it("VETOes change_title_meta when the label reads as navigational (wants a different page)", () => {
    const p = packet("iranopedia login", "edit_page");
    const obj = checkIntentVeto({ packet: p, action: "change_title_meta" });
    expect(obj).not.toBeNull();
    expect(obj!.kind).toBe("wrong_lever_for_intent");
    expect(obj!.severity).toBe("veto");
    expect(obj!.against).toEqual(["change_title_meta"]);
    expect(obj!.detail).toContain("iranopedia login");
    expect(obj!.detail).toContain("navigational");
  });

  it("does not fire on change_title_meta for a normal informational query", () => {
    const p = packet("persian new year traditions", "edit_page");
    expect(checkIntentVeto({ packet: p, action: "change_title_meta" })).toBeNull();
  });
});

describe("checkIntentVeto - rule 3: create_page for transactional intent with no transactional surface", () => {
  it("downgrades create_page when the label is transactional and the tenant has no transactional surface", () => {
    const p = packet("buy persian rug online", "create_page");
    const obj = checkIntentVeto({ packet: p, action: "create_page", tenantHasNoTransactionalSurface: true });
    expect(obj).not.toBeNull();
    expect(obj!.severity).toBe("downgrade"); // probable, not certain - an informational page can still redirect the demand
    expect(obj!.against).toEqual(["create_page"]);
    expect(obj!.detail).toContain("buy persian rug online");
    expect(obj!.evidenceRefs[0]!.detail).toContain("no transactional surface");
  });

  it("does not fire for edit_existing_page even with no transactional surface (rule only targets create_page)", () => {
    const p = packet("buy persian rug online", "edit_page");
    expect(
      checkIntentVeto({ packet: p, action: "edit_existing_page", tenantHasNoTransactionalSurface: true }),
    ).toBeNull();
  });
});

describe("checkIntentVeto - no em/en dashes anywhere in generated copy", () => {
  it("every generated detail string is dash-clean", () => {
    const cases: Array<[string, EvidencePacket["move"]["gapType"], Parameters<typeof checkIntentVeto>[0]["action"], boolean | undefined]> = [
      ["chaharshanbe suri 2026", "answer_block", "add_answer_block", undefined],
      ["persian rug cost", "answer_block", "add_answer_block", undefined],
      ["iranopedia login", "edit_page", "change_title_meta", undefined],
      ["buy persian rug online", "create_page", "create_page", true],
    ];
    for (const [label, gap, action, noSurface] of cases) {
      const obj = checkIntentVeto({ packet: packet(label, gap), action, tenantHasNoTransactionalSurface: noSurface });
      if (obj) {
        expect(obj.detail).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});
