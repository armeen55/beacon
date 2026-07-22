/**
 * SPECIALIST OPINIONS + DEBATE SUMMARY (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/demand-graph/specialist-opinions.test.ts
 *   src/domains/demand-graph/debate-summary.test.ts
 * Pins kept: evidence-or-abstain per specialist, SERP veto/re-route, B82 no
 * raw machine tokens on operator surfaces, lab-token plain-language swaps,
 * dash-free agreement lines.
 */
import { describe, it, expect } from "vitest";
import type { EvidencePacket, EvidenceGap, DraftSkeleton } from "@/domains/demand-graph/evidence-packet";
import type { MoveComponents, GapKind } from "@/domains/demand-graph/build-graph";
import type { SerpValidation } from "@/domains/serp/serp-validation";
import {
  emitGscOpinion,
  emitGa4Opinion,
  emitClarityOpinion,
  emitProfoundOpinion,
  emitDataforseoOpinion,
  emitWixOpinion,
  emitCommerceAssetOpinion,
  attachOpinions,
  type SpecialistOpinion,
} from "@/domains/demand-graph/specialist-opinions";
import {
  humanizeDebateLine,
  summarizeSpecialistDebate,
  computeAgreement,
  devilsAdvocateLine,
} from "@/domains/demand-graph/debate-summary";

const NOW = "2026-06-25T00:00:00.000Z";

const baseComponents = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});

const baseDraft = (over: Partial<DraftSkeleton> = {}): DraftSkeleton => ({
  kind: "deterministic_skeleton", titleSuggestion: "T", metaBrief: "M", outline: [],
  answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "n", ...over,
});

function packet(over: {
  move?: Partial<EvidencePacket["move"]>;
  demand?: Partial<EvidencePacket["demand"]>;
  competitor?: Partial<EvidencePacket["competitor"]>;
  yourPage?: Partial<EvidencePacket["yourPage"]>;
  gaps?: EvidenceGap[];
  draft?: Partial<DraftSkeleton>;
} = {}): EvidencePacket {
  const gapType: GapKind = over.move?.gapType ?? "edit_page";
  return {
    move: {
      key: "k1", gapType, label: "persian wedding traditions", confidence: "medium", score: 1000,
      components: baseComponents(over.move?.components), signals: over.move?.signals ?? ["GSC", "owned-page"],
      ...over.move,
    },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: [], ...over.demand },
    competitor: {
      topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "-", relevance: 0,
      looselyMatched: false, otherUrls: [], ...over.competitor,
    },
    yourPage: { url: "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0, ...over.yourPage },
    research: null,
    gaps: over.gaps ?? [],
    draft: baseDraft(over.draft),
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash123",
  };
}

describe("specialists: evidence or abstain", () => {
  it("GSC emits a striking-distance play with winnability boost, abstains without evidence", () => {
    const o = emitGscOpinion(
      packet({ yourPage: { gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 } } }),
      { nowIso: NOW },
    );
    expect(o!.suggestedMoveTypes).toContain("change_title_meta");
    expect(o!.scoreContribution.winnabilityDelta).toBe(0.3);
    expect(Date.parse(o!.staleAt) - Date.parse(NOW)).toBe(60 * 60 * 1000);
    expect(emitGscOpinion(packet({ move: { signals: ["AI"] }, yourPage: { gsc: null } }), { nowIso: NOW })).toBeNull();
  });

  it("GSC raises no_measured_demand when demand is an AI-attention proxy", () => {
    const o = emitGscOpinion(packet({ move: { signals: ["GSC"] }, demand: { basis: "ai_attention" } }), { nowIso: NOW });
    expect(o!.objections.some((ob) => ob.kind === "no_measured_demand" && ob.severity === "downgrade")).toBe(true);
  });

  it("GA4 is an amplifier (dollar value, no suggested move) and abstains at zero", () => {
    const o = emitGa4Opinion(packet({ yourPage: { dollarValue: 50 } }), { nowIso: NOW });
    expect(o!.suggestedMoveTypes).toEqual([]);
    expect(o!.scoreContribution.dollarValue).toBe(50);
    expect(emitGa4Opinion(packet({ yourPage: { dollarValue: 0 } }), { nowIso: NOW })).toBeNull();
  });

  it("Clarity fires fix_ux + a DOWNGRADE (not veto) at meaningful friction, abstains below floor", () => {
    const o = emitClarityOpinion(packet({ yourPage: { friction: 20 } }), { nowIso: NOW });
    expect(o!.suggestedMoveTypes).toEqual(["fix_ux"]);
    expect(o!.objections.find((ob) => ob.kind === "fix_ux_first")!.severity).toBe("downgrade");
    expect(emitClarityOpinion(packet({ yourPage: { friction: 5 } }), { nowIso: NOW })).toBeNull();
  });

  it("Profound emits add_answer_block on an on-topic rival citation, downgrades off-topic, abstains empty", () => {
    const o = emitProfoundOpinion(
      packet({
        move: { gapType: "answer_block", components: baseComponents({ visibilityGap: 0.9 }) },
        competitor: { topUrl: "https://theknot.com/content/persian-wedding-traditions", domain: "theknot.com", fetchStatus: "ok", relevance: 0.8, otherUrls: ["https://b.com/y"] },
      }),
      { nowIso: NOW },
    );
    expect(o!.suggestedMoveTypes).toContain("add_answer_block");
    expect(o!.scoreContribution.visibilityGapDelta).toBe(0.9);
    const off = emitProfoundOpinion(
      packet({ competitor: { topUrl: "https://x.com", domain: "x.com", fetchStatus: "ok", looselyMatched: true, relevance: 0.2 } }),
      { nowIso: NOW },
    );
    expect(off!.objections.some((ob) => ob.kind === "off_topic_competitor")).toBe(true);
    expect(emitProfoundOpinion(packet(), { nowIso: NOW })).toBeNull();
  });

  it("Commerce asset routes a tool gap to build_tool, abstains otherwise", () => {
    const o = emitCommerceAssetOpinion(
      packet({ gaps: [{ kind: "missing_tool", detail: "competitor has a calculator" }] }),
      { nowIso: NOW },
    );
    expect(o!.suggestedMoveTypes).toContain("build_tool");
    expect(emitCommerceAssetOpinion(packet(), { nowIso: NOW })).toBeNull();
  });

  it("attachOpinions returns only the specialists that have evidence (abstentions dropped)", () => {
    const ops = attachOpinions(
      packet({
        move: { gapType: "answer_block" },
        yourPage: { gsc: { clicks: 1, impressions: 2000, ctr: 0.01, position: 9 }, dollarValue: 30, friction: 20 },
        competitor: { topUrl: "https://theknot.com/x", domain: "theknot.com", fetchStatus: "ok", relevance: 0.8, otherUrls: [] },
      }),
      { nowIso: NOW },
    );
    expect(ops.map((o) => o.specialist).sort()).toEqual(["clarity", "ga4", "gsc", "profound"]);
  });
});

const serp = (over: Partial<SerpValidation> = {}): SerpValidation => ({
  topDomains: ["a.com", "b.com"], marketplaceUgcCount: 0, contentDomainCount: 7, profoundOverlapCount: 0,
  ownAlreadyRanks: false, intent: "content", verdict: "build", confidence: "medium",
  reasons: ["Content-page SERP, out-buildable."], ...over,
});

describe("emitDataforseoOpinion (live SERP verdict)", () => {
  it("abstains until a live SERP verdict is prepared; supports create_page with the overlap boost", () => {
    expect(emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), { nowIso: NOW })).toBeNull();
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW, serpVerdict: serp({ profoundOverlapCount: 2 }),
    });
    expect(o!.suggestedMoveTypes).toContain("create_page");
    expect(o!.scoreContribution.scoreMultiplier).toBe(1.3);
  });

  it("vetoes create_page on a marketplace/UGC SERP", () => {
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW, serpVerdict: serp({ intent: "marketplace_ugc", marketplaceUgcCount: 7, verdict: "reject" }),
    });
    const v = o!.objections.find((ob) => ob.kind === "cant_outrank_serp");
    expect(v!.severity).toBe("veto");
    expect(v!.against).toContain("create_page");
  });

  it("vetoes create_page and re-routes to edit when you already rank", () => {
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW, serpVerdict: serp({ ownAlreadyRanks: true, verdict: "reject" }),
    });
    expect(o!.objections.some((ob) => ob.kind === "already_ranks" && ob.severity === "veto")).toBe(true);
    expect(o!.suggestedMoveTypes).toContain("edit_existing_page");
  });

  it("Wix abstains when pushability is unknown; raises not_pushable + score cut when paste-only", () => {
    expect(emitWixOpinion(packet(), { nowIso: NOW })).toBeNull();
    const o = emitWixOpinion(packet(), { nowIso: NOW, pushable: false });
    expect(o!.objections.some((ob) => ob.kind === "not_pushable")).toBe(true);
    expect(o!.scoreContribution.scoreMultiplier).toBe(0.9);
  });
});

// ── debate summary ──────────────────────────────────────────────────────────

const op = (over: Partial<SpecialistOpinion>): SpecialistOpinion => ({
  specialist: "gsc", claim: "Demand exists", evidenceRefs: [], confidence: 0.8,
  suggestedMoveTypes: [], objections: [], scoreContribution: {}, staleAt: "2026-07-01T00:00:00.000Z", ...over,
});

describe("summarizeSpecialistDebate", () => {
  it("ranks voices by conviction and maps operator labels", () => {
    const s = summarizeSpecialistDebate([
      op({ specialist: "clarity", claim: "Lots of rage clicks", confidence: 0.5 }),
      op({ specialist: "gsc", claim: "5k impressions", confidence: 0.9 }),
    ]);
    expect(s.voices[0].label).toBe("Search demand");
    expect(s.voices[0].confidencePct).toBe(90);
    expect(s.voices[1].label).toBe("Visitor behavior");
  });

  it("surfaces objections with veto first + flags hasVeto; honest empty headline", () => {
    const s = summarizeSpecialistDebate([
      op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace SERP", evidenceRefs: [] }] }),
      op({ specialist: "wix", objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste only", evidenceRefs: [] }] }),
    ]);
    expect(s.hasVeto).toBe(true);
    expect(s.objections[0].severity).toBe("veto");
    expect(s.headline).toMatch(/1 blocking/);
    expect(summarizeSpecialistDebate([]).headline).toMatch(/enough data/);
  });

  it("B82 PIN: an unknown specialist/objection key never leaks a raw machine token to the UI", () => {
    const s = summarizeSpecialistDebate([
      op({
        specialist: "totally_new_specialist" as never, claim: "x", confidence: 0.5,
        objections: [{ kind: "brand_new_kind" as never, against: [], severity: "downgrade", detail: "d", evidenceRefs: [] }],
      }),
    ]);
    expect(s.voices[0].label).toBe("Another specialist");
    expect(s.voices[0].label).not.toContain("_");
    expect(s.objections[0].reason).toBe("Flagged a concern");
  });
});

describe("computeAgreement (P5 item 387)", () => {
  it("self-hides when only one teammate (or zero voters) could pick an action", () => {
    expect(computeAgreement([op({ suggestedMoveTypes: ["edit_existing_page"] })], "edit_existing_page").line).toBeNull();
    expect(
      computeAgreement(
        [op({ specialist: "ga4", suggestedMoveTypes: [] }), op({ specialist: "wix", suggestedMoveTypes: [] })],
        "edit_existing_page",
      ).total,
    ).toBe(0);
  });

  it("states unanimous agreement, names the odd one out's worry, prefers the VETO worry", () => {
    const unanimous = computeAgreement(
      [op({ specialist: "gsc", suggestedMoveTypes: ["change_title_meta"] }), op({ specialist: "profound", suggestedMoveTypes: ["change_title_meta"] })],
      "change_title_meta",
    );
    expect(unanimous.line).toBe("All 2 teammates who could weigh in agreed on this.");

    const split = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
        op({
          specialist: "dataforseo", suggestedMoveTypes: ["edit_existing_page"],
          objections: [{ kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "ranks", evidenceRefs: [] }],
        }),
      ],
      "create_page",
    );
    expect(split.agreed).toBe(2);
    expect(split.line).toContain("worried about doubling up on a page you already rank for");
  });

  it("emits no em or en dash in the agreement line", () => {
    const a = computeAgreement(
      [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({
          specialist: "clarity", suggestedMoveTypes: ["fix_ux"],
          objections: [{ kind: "fix_ux_first", against: ["create_page"], severity: "downgrade", detail: "friction", evidenceRefs: [] }],
        }),
      ],
      "create_page",
    );
    expect(a.line).not.toBeNull();
    expect(/[–—]/.test(a.line!)).toBe(false);
  });
});

describe("devilsAdvocateLine (P5 items 231/314)", () => {
  it("self-hides when nobody argued against; picks the VETO objection over a downgrade", () => {
    expect(devilsAdvocateLine([op({ suggestedMoveTypes: ["change_title_meta"] })])).toBeNull();
    const line = devilsAdvocateLine([
      op({ specialist: "wix", objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste only", evidenceRefs: [] }] }),
      op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace SERP dominates", evidenceRefs: [] }] }),
    ]);
    expect(line).toContain("The skeptic's take:");
    expect(line).toContain("marketplace search results dominates");
  });

  it("falls back to the plain reason when the objection detail is empty", () => {
    const line = devilsAdvocateLine([
      op({
        specialist: "gsc", suggestedMoveTypes: ["create_page"],
        objections: [{ kind: "no_measured_demand", against: ["create_page"], severity: "downgrade", detail: "", evidenceRefs: [] }],
      }),
    ]);
    expect(line).toBe("The skeptic's take: No proven search demand yet");
  });
});

describe("humanizeDebateLine (item 39: no robotic phrasing, no lab tokens)", () => {
  it("pluralizes counted '(s)' templates and articles a count of one", () => {
    expect(humanizeDebateLine("AI cites 3 competitor page(s) for this topic.")).toBe("AI cites 3 competitor pages for this topic.");
    expect(humanizeDebateLine("AI cites 1 competitor page(s) for this topic.")).toBe("AI cites a competitor page for this topic.");
    expect(humanizeDebateLine("competitor page(s) own this demand")).toBe("competitor pages own this demand");
  });

  it("spaces snake_case tokens but never touches URLs; de-shouts enum words, keeps initialisms", () => {
    expect(humanizeDebateLine("create_page vetoed: you already rank for this.")).toBe("create page vetoed: you already rank for this.");
    expect(humanizeDebateLine("see https://x.com/some_page_here for details")).toBe("see https://x.com/some_page_here for details");
    expect(humanizeDebateLine("it's an EDIT, not a new page")).toBe("it's an edit, not a new page");
    expect(humanizeDebateLine("Ranks #4 with 1.2% CTR and AI citations")).toBe("Ranks #4 with 1.2% CTR and AI citations");
  });

  it("swaps lab tokens for plain words and is applied to every claim + objection detail", () => {
    expect(humanizeDebateLine("Live SERP verdict: build.")).toBe("Live search results verdict: build.");
    expect(humanizeDebateLine("DataForSEO: you already rank")).toBe("Live Google results: you already rank");
    const s = summarizeSpecialistDebate([
      op({
        claim: "AI cites 2 competitor page(s) for this topic.",
        objections: [{ kind: "cant_outrank_serp", against: [], severity: "veto", detail: "SERP is marketplace/UGC-dominated (6/10)", evidenceRefs: [] }],
      }),
    ]);
    expect(s.voices[0].claim).toBe("AI cites 2 competitor pages for this topic.");
    expect(s.objections[0].detail).toBe("The search results are marketplace/forum-dominated (6/10)");
  });
});
