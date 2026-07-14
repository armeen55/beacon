import { describe, it, expect } from "vitest";
import type { EvidencePacket, EvidenceGap, DraftSkeleton } from "./evidence-packet";
import type { MoveComponents, GapKind } from "./build-graph";
import type { SerpValidation } from "@/domains/serp/serp-validation";
import {
  emitGscOpinion,
  emitGa4Opinion,
  emitClarityOpinion,
  emitProfoundOpinion,
  emitDataforseoOpinion,
  emitWixOpinion,
  emitLlmOpinion,
  emitCommerceAssetOpinion,
  attachOpinions,
} from "./specialist-opinions";

const NOW = "2026-06-25T00:00:00.000Z";

const baseComponents = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000,
  winnability: 0.8,
  dollarValue: 0,
  visibilityGap: 0.5,
  friction: 0,
  ...over,
});

const baseDraft = (over: Partial<DraftSkeleton> = {}): DraftSkeleton => ({
  kind: "deterministic_skeleton",
  titleSuggestion: "T",
  metaBrief: "M",
  outline: [],
  answerBlockBrief: null,
  faqQuestions: [],
  schemaRecommendations: [],
  assetSpec: null,
  asset: null,
  note: "n",
  ...over,
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
      key: "k1",
      gapType,
      label: "persian wedding traditions",
      confidence: "medium",
      score: 1000,
      components: baseComponents(over.move?.components),
      signals: over.move?.signals ?? ["GSC", "owned-page"],
      ...over.move,
    },
    demand: {
      demandWeight: 1000,
      basis: "gsc",
      queries: [],
      fanoutSeeds: [],
      ...over.demand,
    },
    competitor: {
      topUrl: null,
      domain: null,
      fetchStatus: null,
      facts: null,
      whatWins: "—",
      relevance: 0,
      looselyMatched: false,
      otherUrls: [],
      ...over.competitor,
    },
    yourPage: {
      url: "https://iranopedia.com/wedding",
      facts: null,
      gsc: null,
      dollarValue: 0,
      friction: 0,
      ...over.yourPage,
    },
    research: null,
    gaps: over.gaps ?? [],
    draft: baseDraft(over.draft),
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash123",
  };
}

describe("emitGscOpinion", () => {
  it("emits a title/edit play with a striking-distance winnability boost", () => {
    const o = emitGscOpinion(
      packet({ yourPage: { gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 } } }),
      { nowIso: NOW },
    );
    expect(o).not.toBeNull();
    expect(o!.suggestedMoveTypes).toContain("change_title_meta");
    expect(o!.scoreContribution.winnabilityDelta).toBe(0.3);
    expect(o!.evidenceRefs[0]!.source).toBe("gsc_daily_page_totals");
    // staleAt ≈ 1h after now
    expect(Date.parse(o!.staleAt) - Date.parse(NOW)).toBe(60 * 60 * 1000);
  });

  it("abstains when there is no GSC evidence at all", () => {
    expect(emitGscOpinion(packet({ move: { signals: ["AI"] }, yourPage: { gsc: null } }), { nowIso: NOW })).toBeNull();
  });

  it("raises no_measured_demand when demand is an AI-attention proxy", () => {
    const o = emitGscOpinion(
      packet({ move: { signals: ["GSC"] }, demand: { basis: "ai_attention" } }),
      { nowIso: NOW },
    );
    expect(o!.objections.some((ob) => ob.kind === "no_measured_demand" && ob.severity === "downgrade")).toBe(true);
  });
});

describe("emitGa4Opinion", () => {
  it("is an amplifier: dollar value, no suggested move", () => {
    const o = emitGa4Opinion(packet({ yourPage: { dollarValue: 50 } }), { nowIso: NOW });
    expect(o!.suggestedMoveTypes).toEqual([]);
    expect(o!.scoreContribution.dollarValue).toBe(50);
  });
  it("abstains when there is no measured value", () => {
    expect(emitGa4Opinion(packet({ yourPage: { dollarValue: 0 } }), { nowIso: NOW })).toBeNull();
  });
});

describe("emitClarityOpinion", () => {
  it("fires fix_ux + a fix_ux_first DOWNGRADE (not a veto) at meaningful friction", () => {
    const o = emitClarityOpinion(packet({ yourPage: { friction: 20 } }), { nowIso: NOW });
    expect(o!.suggestedMoveTypes).toEqual(["fix_ux"]);
    const obj = o!.objections.find((ob) => ob.kind === "fix_ux_first");
    expect(obj!.severity).toBe("downgrade");
    expect(obj!.against).toContain("add_answer_block");
  });
  it("abstains below the friction floor", () => {
    expect(emitClarityOpinion(packet({ yourPage: { friction: 5 } }), { nowIso: NOW })).toBeNull();
  });
});

describe("emitProfoundOpinion", () => {
  it("emits add_answer_block when AI cites an on-topic competitor and not you", () => {
    const o = emitProfoundOpinion(
      packet({
        move: { gapType: "answer_block", components: baseComponents({ visibilityGap: 0.9 }) },
        competitor: { topUrl: "https://theknot.com/content/persian-wedding-traditions", domain: "theknot.com", fetchStatus: "ok", relevance: 0.8, otherUrls: ["https://b.com/y"] },
      }),
      { nowIso: NOW },
    );
    expect(o!.suggestedMoveTypes).toContain("add_answer_block");
    expect(o!.scoreContribution.visibilityGapDelta).toBe(0.9);
    expect(o!.confidence).toBe(0.7);
    // Profound cadence ≈ 12h
    expect(Date.parse(o!.staleAt) - Date.parse(NOW)).toBe(12 * 60 * 60 * 1000);
  });
  it("downgrades for an off-topic (loosely matched) citation", () => {
    const o = emitProfoundOpinion(
      packet({ competitor: { topUrl: "https://x.com", domain: "x.com", fetchStatus: "ok", looselyMatched: true, relevance: 0.2 } }),
      { nowIso: NOW },
    );
    expect(o!.objections.some((ob) => ob.kind === "off_topic_competitor")).toBe(true);
    expect(o!.confidence).toBe(0.4);
  });
  it("abstains with no competitor citation", () => {
    expect(emitProfoundOpinion(packet(), { nowIso: NOW })).toBeNull();
  });
});

const serp = (over: Partial<SerpValidation> = {}): SerpValidation => ({
  topDomains: ["a.com", "b.com"],
  marketplaceUgcCount: 0,
  contentDomainCount: 7,
  profoundOverlapCount: 0,
  ownAlreadyRanks: false,
  intent: "content",
  verdict: "build",
  confidence: "medium",
  reasons: ["Content-page SERP — out-buildable."],
  ...over,
});

describe("emitDataforseoOpinion", () => {
  it("abstains until a live SERP verdict is prepared", () => {
    expect(emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), { nowIso: NOW })).toBeNull();
  });
  it("supports create_page and applies the overlap boost when Google+AI overlap", () => {
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW,
      serpVerdict: serp({ profoundOverlapCount: 2 }),
    });
    expect(o!.suggestedMoveTypes).toContain("create_page");
    expect(o!.scoreContribution.scoreMultiplier).toBe(1.3);
    // DataForSEO cadence ≈ 14d
    expect(Date.parse(o!.staleAt) - Date.parse(NOW)).toBe(14 * 24 * 60 * 60 * 1000);
  });
  it("vetoes create_page on a marketplace/UGC SERP", () => {
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW,
      serpVerdict: serp({ intent: "marketplace_ugc", marketplaceUgcCount: 7, verdict: "reject" }),
    });
    const v = o!.objections.find((ob) => ob.kind === "cant_outrank_serp");
    expect(v!.severity).toBe("veto");
    expect(v!.against).toContain("create_page");
  });
  it("vetoes create_page and re-routes to edit when you already rank", () => {
    const o = emitDataforseoOpinion(packet({ move: { gapType: "create_page" } }), {
      nowIso: NOW,
      serpVerdict: serp({ ownAlreadyRanks: true, verdict: "reject" }),
    });
    expect(o!.objections.some((ob) => ob.kind === "already_ranks" && ob.severity === "veto")).toBe(true);
    expect(o!.suggestedMoveTypes).toContain("edit_existing_page");
  });
});

describe("emitWixOpinion", () => {
  it("abstains when CMS pushability is unknown", () => {
    expect(emitWixOpinion(packet(), { nowIso: NOW })).toBeNull();
  });
  it("raises not_pushable + a score cut when the target is paste-only", () => {
    const o = emitWixOpinion(packet(), { nowIso: NOW, pushable: false });
    expect(o!.objections.some((ob) => ob.kind === "not_pushable")).toBe(true);
    expect(o!.scoreContribution.scoreMultiplier).toBe(0.9);
  });
  it("affirms a field-publishable target with no objection", () => {
    const o = emitWixOpinion(packet(), { nowIso: NOW, pushable: true });
    expect(o!.objections).toEqual([]);
  });
});

describe("emitLlmOpinion", () => {
  it("abstains in deterministic mode (no LLM in the product yet)", () => {
    expect(emitLlmOpinion(packet(), { nowIso: NOW })).toBeNull();
  });
});

describe("emitCommerceAssetOpinion", () => {
  it("routes a tool-gap opportunity to build_tool", () => {
    const o = emitCommerceAssetOpinion(
      packet({ gaps: [{ kind: "missing_tool", detail: "competitor has a calculator" }] }),
      { nowIso: NOW },
    );
    expect(o!.suggestedMoveTypes).toContain("build_tool");
    expect(o!.specialist).toBe("commerce_asset");
  });
  it("abstains when there is no asset-shaped opportunity", () => {
    expect(emitCommerceAssetOpinion(packet(), { nowIso: NOW })).toBeNull();
  });
});

describe("attachOpinions", () => {
  it("returns only the specialists that have evidence (abstentions dropped)", () => {
    const ops = attachOpinions(
      packet({
        move: { gapType: "answer_block" },
        yourPage: { gsc: { clicks: 1, impressions: 2000, ctr: 0.01, position: 9 }, dollarValue: 30, friction: 20 },
        competitor: { topUrl: "https://theknot.com/x", domain: "theknot.com", fetchStatus: "ok", relevance: 0.8, otherUrls: [] },
      }),
      { nowIso: NOW },
    );
    const specialists = ops.map((o) => o.specialist).sort();
    expect(specialists).toEqual(["clarity", "ga4", "gsc", "profound"]);
  });
});
