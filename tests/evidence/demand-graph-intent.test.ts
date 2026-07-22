/**
 * INTENT CLUSTERING + INTENT VETO (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/demand-graph/intent-clustering.test.ts (D-27..D-33)
 *   src/domains/demand-graph/intent-veto.test.ts (chaharshanbe wrong-lever bug)
 * Pins kept: singularization cannibalization merges, deduplicated demand math,
 * 50/mo floor with stated strategic exceptions, never-alphabetical ranking,
 * date/price answer-block veto with named evidence, dash-free generated copy.
 */
import { describe, it, expect } from "vitest";
import {
  clusterNewPageCandidates,
  applyNewPageFloor,
  rankNewPageClusters,
  deriveWinnability,
  deriveNewPageSignal,
  detectTrendSpike,
  detectSeasonalWindow,
  singularizeToken,
  labelTokens,
  type NewPageClusterCandidate,
} from "@/domains/demand-graph/intent-clustering";
import { checkIntentVeto } from "@/domains/demand-graph/intent-veto";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { GapKind, MoveComponents } from "@/domains/demand-graph/build-graph";

const cand = (over: Partial<NewPageClusterCandidate> & { id: string; label: string }): NewPageClusterCandidate => ({
  volume: null,
  ...over,
});

describe("D-27 singularization + clustering", () => {
  it("singularizes with the operator's simple rules (rug/director/company; keeps ss + short)", () => {
    expect(singularizeToken("rugs")).toBe("rug");
    expect(singularizeToken("directors")).toBe("director");
    expect(singularizeToken("companies")).toBe("company");
    expect(singularizeToken("glass")).toBe("glass");
    expect(singularizeToken("bus")).toBe("bus");
  });

  it("merges director/directors into ONE cluster; canonical is the higher-volume label", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "a", label: "Iranian director", volume: 200 }),
      cand({ id: "b", label: "Iranian directors", volume: 800 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Iranian directors");
    expect(out[0].variants.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("subset merge collapses a bare head noun into the specific higher-volume page", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "bare", label: "Rugs", volume: 100 }),
      cand({ id: "spec", label: "Kashan rug", volume: 900 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Kashan rug");
  });

  it("does NOT merge unrelated topics or different head nouns", () => {
    expect(
      clusterNewPageCandidates([
        cand({ id: "t", label: "Tehran", volume: 5000 }),
        cand({ id: "i", label: "Isfahan", volume: 4000 }),
      ]),
    ).toHaveLength(2);
    expect(
      clusterNewPageCandidates([
        cand({ id: "d", label: "Iranian director", volume: 200 }),
        cand({ id: "f", label: "Iranian filmmaker", volume: 200 }),
      ]),
    ).toHaveLength(2);
  });

  it("computes DEDUPLICATED demand = MAX + 30% of the sum of the others, never a blind sum", () => {
    const out = clusterNewPageCandidates([
      cand({ id: "a", label: "Iranian director", volume: 200 }),
      cand({ id: "b", label: "Iranian directors", volume: 800 }),
    ]);
    expect(out[0].clusterVolume).toBe(860);
  });

  it("labelTokens lowercases, strips punctuation, and singularizes", () => {
    expect(labelTokens("Kashan Rugs!")).toEqual(["kashan", "rug"]);
  });
});

describe("D-28 floor + strategic exception", () => {
  const stableCluster = (over: Partial<NewPageClusterCandidate> & { id: string; label: string; volume: number }) =>
    clusterNewPageCandidates([cand(over)])[0];

  it("drops a cluster under 50/mo with no strategic signal, keeps one above", () => {
    const { kept, dropped } = applyNewPageFloor([stableCluster({ id: "x", label: "Rare topic", volume: 20 })]);
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toContain("under 50/mo");
    const { kept: kept2 } = applyNewPageFloor([stableCluster({ id: "y", label: "Popular topic", volume: 5000 })]);
    expect(kept2[0].keptUnderFloorReason).toBeNull();
  });

  it("keeps a low-volume cluster on the AI-validated + competitor-cited exception WITH a stated reason", () => {
    const { kept } = applyNewPageFloor([
      stableCluster({ id: "z", label: "Niche but cited", volume: 10, aiValidated: true, competitorCited: true }),
    ]);
    expect(kept[0].keptUnderFloorReason).toBe(
      "kept despite low volume: AI already answers this and cites competitors",
    );
  });
});

describe("D-29 ranking (never alphabetical)", () => {
  it("a 27,100/mo cluster outranks a 50/mo one regardless of alphabetical order", () => {
    const low = clusterNewPageCandidates([cand({ id: "low", label: "4 in farsi", volume: 50 })])[0];
    const high = clusterNewPageCandidates([cand({ id: "high", label: "capital of iran", volume: 27100 })])[0];
    const ranked = rankNewPageClusters([low, high]);
    expect(ranked[0].label).toBe("capital of iran");
  });

  it("orders zero-volume strategic clusters by strategic weight, not by label", () => {
    const aiCited = clusterNewPageCandidates([
      cand({ id: "ai", label: "zeta topic", volume: 0, aiValidated: true, competitorCited: true }),
    ])[0];
    const compOnly = clusterNewPageCandidates([
      cand({ id: "co", label: "alpha topic", volume: 0, competitorCited: true }),
    ])[0];
    expect(rankNewPageClusters([compOnly, aiCited])[0].label).toBe("zeta topic");
  });
});

describe("deriveWinnability + D-33 signals", () => {
  it("rates BUILD/high above WAIT above no-verdict-neutral above REJECT", () => {
    const build = deriveWinnability({ verdict: "build", confidence: "high", contentDomainCount: 8 });
    const wait = deriveWinnability({ verdict: "wait", confidence: "medium", contentDomainCount: 5 });
    const reject = deriveWinnability({ verdict: "reject", confidence: "high", contentDomainCount: 2 });
    expect(build).toBeGreaterThan(wait);
    expect(wait).toBeGreaterThan(reject);
    expect(deriveWinnability(null)).toBe(0.5);
  });

  it("detects a query spike (Rising with evidence) and prefers Seasonal when both fire", () => {
    const monthly = [
      { month: 1, volume: 100 }, { month: 2, volume: 100 }, { month: 3, volume: 100 }, { month: 4, volume: 370 },
    ];
    const signal = deriveNewPageSignal({ trend: detectTrendSpike(monthly) });
    expect(signal.kind).toBe("rising");
    expect(signal.evidence).toBe("searches 3.7x usual this month");
    expect(deriveNewPageSignal({ trend: { multiplier: 3 }, seasonal: { peakMonthLabel: "March" } }).kind).toBe("seasonal");
  });

  it("labels a flat series Stable with no evidence line", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, volume: 500 }));
    const signal = deriveNewPageSignal({
      trend: detectTrendSpike(monthly),
      seasonal: detectSeasonalWindow(monthly, 6),
    });
    expect(signal.kind).toBe("stable");
    expect(signal.evidence).toBeNull();
  });
});

// ── intent veto ─────────────────────────────────────────────────────────────

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});

function packet(
  label: string,
  gapType: GapKind = "answer_block",
  fanoutSeeds: string[] = [],
  queries: EvidencePacket["demand"]["queries"] = [],
): EvidencePacket {
  return {
    move: { key: "k1", gapType, label, confidence: "medium", score: 1000, components: components(), signals: ["GSC"] },
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

describe("checkIntentVeto: abstains silently when the lever fits or intent is unknown", () => {
  it("returns null for unclassifiable, fitting, and non-answer-shaped cases", () => {
    expect(checkIntentVeto({ packet: packet(""), action: "add_answer_block" })).toBeNull();
    expect(checkIntentVeto({ packet: packet("persian wedding traditions"), action: "add_answer_block" })).toBeNull();
    expect(checkIntentVeto({ packet: packet("chaharshanbe suri 2026", "create_page"), action: "create_page" })).toBeNull();
    expect(checkIntentVeto({ packet: packet("buy persian rug", "create_page"), action: "create_page" })).toBeNull();
  });
});

describe("checkIntentVeto rule 1: answer block cannot serve a date/price lookup", () => {
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

  it("VETOes add_answer_block on a dominant date intent with the plain-English phrasing", () => {
    const p = packet("chaharshanbe suri 2026", "answer_block", ["when is chaharshanbe suri", "chaharshanbe suri date"]);
    const obj = checkIntentVeto({ packet: p, action: "add_answer_block" });
    expect(obj!.kind).toBe("wrong_lever_for_intent");
    expect(obj!.severity).toBe("veto");
    expect(obj!.against).toEqual(["add_answer_block"]);
    expect(obj!.evidenceRefs.length).toBeGreaterThan(0);
    const phrased = checkIntentVeto({
      packet: packet("chaharshanbe suri 2026", "answer_block", ["chaharshanbe suri date 2026"]),
      action: "add_answer_block",
    });
    expect(phrased!.detail).toContain("That question wants a date, not a definition");
  });

  it("VETOes the same way on a cost/price query but not on change_title_meta", () => {
    const cost = checkIntentVeto({
      packet: packet("how much does a persian rug cost", "answer_block", ["persian rug price", "persian rug cost per square foot"]),
      action: "add_answer_block",
    });
    expect(cost!.severity).toBe("veto");
    expect(cost!.detail).toContain("a price");
    expect(
      checkIntentVeto({
        packet: packet("chaharshanbe suri 2026", "edit_page", ["when is chaharshanbe suri", "chaharshanbe suri date"]),
        action: "change_title_meta",
      }),
    ).toBeNull();
  });

  it("downgrades (not vetoes) when the dominant share is only probable (0.4-0.55)", () => {
    // "when" leads but only just: 52 vs 48 impressions -> share ~0.52, inside the
    // probable-not-certain band (0.4 to 0.55) -> downgrade, never a hard veto.
    const obj = checkIntentVeto({
      packet: packet("nowruz traditions", "answer_block", [], [
        { query: "when is nowruz 2027", impressions: 52, source: "gsc" },
        { query: "nowruz traditions", impressions: 48, source: "gsc" },
      ]),
      action: "add_answer_block",
    });
    expect(obj!.severity).toBe("downgrade");
    expect(obj!.detail).toContain("flagged");
  });

  it("never fires on what/how/where/who/list/compare dominant intents", () => {
    for (const label of [
      "how to make persian tea",
      "best persian restaurants near me",
      "who invented backgammon",
      "persian vs turkish rugs",
    ]) {
      expect(checkIntentVeto({ packet: packet(label), action: "add_answer_block" })).toBeNull();
    }
  });
});

describe("checkIntentVeto rules 2 + 3", () => {
  it("VETOes change_title_meta on a navigational label, not on informational", () => {
    const obj = checkIntentVeto({ packet: packet("iranopedia login", "edit_page"), action: "change_title_meta" });
    expect(obj!.severity).toBe("veto");
    expect(obj!.detail).toContain("navigational");
    expect(
      checkIntentVeto({ packet: packet("persian new year traditions", "edit_page"), action: "change_title_meta" }),
    ).toBeNull();
  });

  it("downgrades create_page for transactional intent when the tenant has no transactional surface", () => {
    const obj = checkIntentVeto({
      packet: packet("buy persian rug online", "create_page"),
      action: "create_page",
      tenantHasNoTransactionalSurface: true,
    });
    expect(obj!.severity).toBe("downgrade");
    expect(obj!.evidenceRefs[0]!.detail).toContain("no transactional surface");
    expect(
      checkIntentVeto({
        packet: packet("buy persian rug online", "edit_page"),
        action: "edit_existing_page",
        tenantHasNoTransactionalSurface: true,
      }),
    ).toBeNull();
  });
});

describe("checkIntentVeto: no em/en dashes anywhere in generated copy", () => {
  it("every generated detail string is dash-clean", () => {
    const cases: Array<[string, GapKind, Parameters<typeof checkIntentVeto>[0]["action"], boolean | undefined]> = [
      ["chaharshanbe suri 2026", "answer_block", "add_answer_block", undefined],
      ["persian rug cost", "answer_block", "add_answer_block", undefined],
      ["iranopedia login", "edit_page", "change_title_meta", undefined],
      ["buy persian rug online", "create_page", "create_page", true],
    ];
    for (const [label, gap, action, noSurface] of cases) {
      const obj = checkIntentVeto({ packet: packet(label, gap), action, tenantHasNoTransactionalSurface: noSurface });
      if (obj) expect(obj.detail).not.toMatch(/[–—]/);
    }
  });
});
