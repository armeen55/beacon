import { describe, it, expect } from "vitest";
import { formatMoveCard } from "@/domains/demand-graph/move-card";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

function packet(over: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    move: { key: "k", gapType: "create_page", label: "persian wedding", confidence: "medium", score: 1000, components: { demand: 5000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 }, signals: ["AI"] },
    demand: { demandWeight: 5000, basis: "ai_attention", queries: [], fanoutSeeds: [] },
    competitor: { topUrl: "https://theknot.com/x", domain: "theknot.com", fetchStatus: "ok", facts: null, whatWins: "answer block · 1.8k words", relevance: 1, looselyMatched: false, otherUrls: [] },
    yourPage: { url: null, facts: null, gsc: null, dollarValue: 0, friction: 0 },
    gaps: [{ kind: "missing_page", detail: "no page" }],
    draft: { kind: "deterministic_skeleton", titleSuggestion: "Persian Wedding | Iranopedia", metaBrief: null, outline: ["A", "B"], answerBlockBrief: "answer", faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "x" },
    proofPlan: { metrics: ["new-page clicks", "Profound citations"], windowsDays: [7, 14, 28], controls: "x" },
    evidenceHash: "abc",
    ...over,
  } as EvidencePacket;
}

describe("formatMoveCard (Step 7 bridge, plain language)", () => {
  it("create_page → imperative move + plain why + proof in plain English", () => {
    const c = formatMoveCard(packet());
    expect(c.move).toBe("Create a new page: persian wedding");
    expect(c.draftReady).toBe(true);
    expect(c.proof).toContain("how often AI recommends you"); // Profound citations → plain
    expect(c.proof).toContain("7/14/28 days");
    expect(c.yourGap[0]).toContain("no page");
    expect(c.ship).toBe("Review & ship");
    expect(c.confidence).toBe("medium");
    expect(c.intent).toBe("informational"); // "persian wedding"
    expect(c.intentHint.toLowerCase()).toContain("concise answer");
    expect(c.effort).toBe("big"); // create_page
  });

  it("effort: answer_block is a quick win, create_page is a big build", () => {
    const quick = formatMoveCard(packet({
      move: { key: "k", gapType: "answer_block", label: "iran flag", confidence: "high", score: 1, components: { demand: 1, winnability: 0.5, dollarValue: 0, visibilityGap: 0.3, friction: 0 }, signals: ["GSC"] },
      gaps: [{ kind: "missing_answer_block", detail: "x" }],
    }));
    expect(quick.effort).toBe("quick");
  });

  it("loosely-matched competitor → honest 'not confirmed' instead of a teardown", () => {
    const c = formatMoveCard(packet({
      competitor: { topUrl: "https://x.com/y", domain: "x.com", fetchStatus: "ok", facts: null, whatWins: "...", relevance: 0.3, looselyMatched: true, otherUrls: [] },
    }));
    expect(c.whatWins.toLowerCase()).toContain("confirm");
  });

  it("errored competitor (facts null, http_error) → 'didn't load', NOT 'off-topic'", () => {
    const c = formatMoveCard(packet({
      competitor: { topUrl: "https://britannica.com/x", domain: "britannica.com", fetchStatus: "http_error", facts: null, whatWins: "—", relevance: 0, looselyMatched: false, otherUrls: [] },
    }));
    expect(c.whatWins).toContain("britannica.com");
    expect(c.whatWins.toLowerCase()).toContain("didn't load");
    expect(c.whatWins.toLowerCase()).not.toContain("off-topic");
    expect(c.teardownState).toBe("errored");
  });

  it("on-topic teardown whatWins is de-jargoned (no 'schema'/'answer block')", () => {
    const c = formatMoveCard(packet({
      competitor: { topUrl: "https://t.com/x", domain: "t.com", fetchStatus: "ok", facts: { wordCount: 3600 } as never, whatWins: "answer block · 12 schema type(s) · 3.6k words · strong internal linking", relevance: 1, looselyMatched: false, otherUrls: [] },
    }));
    expect(c.whatWins).not.toMatch(/\bschema\b/);
    expect(c.whatWins).not.toMatch(/answer block/);
    expect(c.whatWins).toContain("structured-data types");
    expect(c.whatWins).toContain("a direct answer up top");
  });

  it("no jargon: known SEO terms are translated", () => {
    const c = formatMoveCard(packet({
      move: { key: "k", gapType: "edit_page", label: "cities in iran", confidence: "high", score: 1, components: { demand: 1, winnability: 0.5, dollarValue: 2, visibilityGap: 0.3, friction: 0 }, signals: ["GSC"] },
      gaps: [{ kind: "weak_title", detail: "x" }, { kind: "missing_schema", detail: "y" }],
    }));
    expect(c.move).toBe("Improve your page: cities in iran");
    expect(c.yourGap.join(" ")).not.toMatch(/\bCTR\b|\bschema\b/);
    expect(c.why).toContain("leads/sales"); // dollarValue>0 surfaced
  });
});
