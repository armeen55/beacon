import { describe, it, expect } from "vitest";
import { moveCandidateToActionPack, aeoActionPackToActionPack, dedupeActionPacks } from "@/domains/action-pack/adapters";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { AeoActionPack } from "@/domains/profound-coverage/types";

function move(p: Partial<MoveCandidate>): MoveCandidate {
  return {
    demandKey: p.demandKey ?? "k1",
    label: p.label ?? "persian girl names",
    gap: p.gap ?? "edit_page",
    score: p.score ?? 1234,
    components: p.components ?? { demand: 500, winnability: 0.5, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: p.confidence ?? "high",
    signals: p.signals ?? ["gsc"],
    ownedUrl: p.ownedUrl ?? "https://iranopedia.com/persian-female-first-names",
    competitorUrls: p.competitorUrls ?? ["https://momlovesbest.com/x"],
    fanoutSeeds: p.fanoutSeeds ?? [],
    rationale: p.rationale ?? "",
    aeoEvidence: p.aeoEvidence,
  };
}

function aeo(p: Partial<AeoActionPack>): AeoActionPack {
  return {
    action: p.action ?? "create_new_page",
    priorityScore: p.priorityScore ?? 800,
    targetUrl: p.targetUrl ?? null,
    newPageSlug: p.newPageSlug ?? "persian-kebab",
    title: p.title ?? "Persian Kebab Varieties",
    h1: p.h1 ?? null,
    directAnswerBrief: p.directAnswerBrief ?? "",
    sectionsToAdd: p.sectionsToAdd ?? [],
    faqQuestions: p.faqQuestions ?? ["koobideh vs barg"],
    schemaRecommendation: p.schemaRecommendation ?? "Article",
    sourceReferences: p.sourceReferences ?? [],
    competitorPagesToBeat: p.competitorPagesToBeat ?? ["https://garsononline.com/kebab"],
    internalLinks: p.internalLinks ?? [],
    measurementPlan: p.measurementPlan ?? [],
    evidence: p.evidence ?? "",
    needsSerpValidation: p.needsSerpValidation ?? true,
    promptId: p.promptId ?? null,
    prompt: p.prompt ?? "What are popular Persian kebab varieties?",
  };
}

describe("action-pack adapters", () => {
  it("maps a demand-graph edit Move + its aeoEvidence into an ActionPack", () => {
    const ap = moveCandidateToActionPack("t", move({
      aeoEvidence: { source: "profound", prompts: ["beautiful Persian girl names"], promptCount: 3, fanoutQueries: ["q1", "q2"], topCitedPages: [], topCitedDomains: [{ hostname: "momlovesbest.com", answers: 4 }], ownCitationCount: 0, competitorCitationCount: 4, recommendedContentShape: "answer block", confidence: "high", matchBasis: "x" },
    }));
    expect(ap).toBeTruthy();
    expect(ap!.actionType).toBe("edit_existing_page");
    expect(ap!.evidenceSources).toContain("rank_revenue");
    expect(ap!.evidenceSources).toContain("profound");
    expect(ap!.profoundReceipt?.topPrompt).toBe("beautiful Persian girl names");
    expect(ap!.profoundReceipt?.ownAbsent).toBe(true);
    expect(ap!.whyNotNoise.length).toBeGreaterThan(0);
  });

  it("skips non-actionable gaps (healthy/low_demand)", () => {
    expect(moveCandidateToActionPack("t", move({ gap: "healthy" }))).toBeNull();
    expect(moveCandidateToActionPack("t", move({ gap: "low_demand" }))).toBeNull();
  });

  it("maps a coverage AeoActionPack and does NOT overclaim dataforseo without a verdict", () => {
    const ap = aeoActionPackToActionPack("t", aeo({ needsSerpValidation: false }));
    expect(ap!.actionType).toBe("create_new_page");
    expect(ap!.origin).toBe("profound_coverage");
    expect(ap!.evidenceSources).toEqual(["profound"]); // NOT dataforseo / competitor_teardown
    expect(ap!.dataforseoValidation).toBeNull();
  });

  it("skips coverage 'ignore' packs", () => {
    expect(aeoActionPackToActionPack("t", aeo({ action: "ignore" }))).toBeNull();
  });

  it("dedupes by (actionType + target) keeping the higher score and merging sources", () => {
    const url = "https://iranopedia.com/persian-female-first-names";
    const a = moveCandidateToActionPack("t", move({ ownedUrl: url, score: 1000 }))!; // rank_revenue
    const b = aeoActionPackToActionPack("t", aeo({ action: "expand_existing_page", targetUrl: url, priorityScore: 50 }))!; // profound
    const { packs, removed } = dedupeActionPacks([a, b]);
    expect(removed).toBe(1);
    expect(packs).toHaveLength(1);
    expect(packs[0]!.priorityScore).toBe(1000); // higher wins
    expect(packs[0]!.evidenceSources).toEqual(expect.arrayContaining(["rank_revenue", "profound"])); // merged
  });
});
