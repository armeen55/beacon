import { describe, it, expect } from "vitest";
import { attachProfoundEvidenceToMoves, aeoEvidenceSentence } from "@/domains/demand-graph/profound-evidence-fusion";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { PromptOpportunity } from "@/domains/profound-question-intelligence/prompt-opportunity";

function move(p: Partial<MoveCandidate>): MoveCandidate {
  return {
    demandKey: p.demandKey ?? "k",
    label: p.label ?? "persian names",
    gap: p.gap ?? "edit_page",
    score: p.score ?? 50,
    components: p.components ?? { demand: 100, winnability: 0.5, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: p.confidence ?? "medium",
    signals: p.signals ?? ["gsc"],
    ownedUrl: p.ownedUrl ?? null,
    competitorUrls: p.competitorUrls ?? [],
    fanoutSeeds: p.fanoutSeeds ?? [],
    rationale: p.rationale ?? "",
  };
}

function opp(p: Partial<PromptOpportunity>): PromptOpportunity {
  return {
    prompt: p.prompt ?? "What are beautiful Persian girl names?",
    promptId: p.promptId ?? null,
    topic: p.topic ?? "Iranopedia",
    executions: p.executions ?? 3,
    models: p.models ?? ["ChatGPT"],
    ownMentionCount: p.ownMentionCount ?? 0,
    ownCitationCount: p.ownCitationCount ?? 0,
    ownCitedUrls: p.ownCitedUrls ?? [],
    topCitedPages: p.topCitedPages ?? [],
    topCompetitorDomains: p.topCompetitorDomains ?? [],
    fanoutQueries: p.fanoutQueries ?? [],
    rawAnswerExamples: p.rawAnswerExamples ?? [],
    tags: p.tags ?? [],
    visibilityGap: p.visibilityGap ?? 1,
    citationGap: p.citationGap ?? 1,
    promptAttentionScore: p.promptAttentionScore ?? 1,
    recommendedMove: p.recommendedMove ?? "answer_block",
    evidence: p.evidence ?? "",
  };
}

// A corpus where "persian"/"iranian"/"famous" are PERVASIVE (generic → low IDF)
// and "names"/"films"/"athletes"/"kebab" are distinctive (high IDF).
const CORPUS: PromptOpportunity[] = [
  opp({ prompt: "What are beautiful Persian girl names?", topCompetitorDomains: [{ hostname: "momlovesbest.com", answers: 3 }], fanoutQueries: ["persian girl names meanings", "rare persian names"], ownCitationCount: 0 }),
  opp({ prompt: "What are strong Persian boy names?", topCompetitorDomains: [{ hostname: "peanut-app.io", answers: 2 }] }),
  opp({ prompt: "What are popular Iranian last names?", topCompetitorDomains: [{ hostname: "scarymommy.com", answers: 2 }] }),
  opp({ prompt: "What famous Iranian films won Oscars?", topCompetitorDomains: [{ hostname: "letterboxd.com", answers: 3 }] }),
  opp({ prompt: "Who are famous Iranian athletes?", topCompetitorDomains: [{ hostname: "olympics.com", answers: 2 }] }),
  opp({ prompt: "What are popular Persian foods?", topCompetitorDomains: [{ hostname: "seriouseats.com", answers: 2 }] }),
  opp({ prompt: "How do you make Persian kebab?", topCompetitorDomains: [{ hostname: "garsononline.com", answers: 2 }] }),
  opp({ prompt: "What is Persian Nowruz?", topCompetitorDomains: [{ hostname: "britannica.com", answers: 2 }] }),
];

describe("attachProfoundEvidenceToMoves", () => {
  it("attaches high-confidence evidence when AI cites the exact owned page", () => {
    const url = "https://iranopedia.com/persian-female-first-names";
    const o = opp({ prompt: "What are beautiful Persian girl names?", ownCitationCount: 2, ownCitedUrls: [url], topCompetitorDomains: [{ hostname: "honeyname.com", answers: 2 }] });
    const m = move({ label: "persian girl names", ownedUrl: url });
    const [out] = attachProfoundEvidenceToMoves([m], [o, ...CORPUS]);
    expect(out!.aeoEvidence).toBeTruthy();
    expect(out!.aeoEvidence!.confidence).toBe("high");
    expect(out!.aeoEvidence!.prompts).toContain("What are beautiful Persian girl names?");
  });

  it("attaches evidence on shared competitor domain + subject token", () => {
    const m = move({ label: "persian girl names", competitorUrls: ["https://momlovesbest.com/persian-girl-names"] });
    const [out] = attachProfoundEvidenceToMoves([m], CORPUS);
    expect(out!.aeoEvidence?.confidence).toBe("high");
    expect(out!.aeoEvidence?.topCitedDomains.some((d) => d.hostname === "momlovesbest.com")).toBe(true);
  });

  it("GUARD: generic shared tokens alone (famous/iranian) do NOT match unrelated pages", () => {
    // A move about FILMS must not pick up the ATHLETES prompt just because both
    // say "famous"/"iranian" (those are corpus-pervasive → down-weighted).
    const m = move({ label: "famous iranian films", ownedUrl: "https://iranopedia.com/famous-iranian-directors", competitorUrls: [] });
    const [out] = attachProfoundEvidenceToMoves([m], CORPUS);
    // It may match the films prompt (subject "films") but NEVER the athletes one.
    const prompts = out!.aeoEvidence?.prompts ?? [];
    expect(prompts.some((p) => p.toLowerCase().includes("athlete"))).toBe(false);
  });

  it("leaves a Move untouched when there is no real Profound match", () => {
    const m = move({ label: "wholesale plumbing invoices", competitorUrls: ["https://example-plumbing.com"] });
    const [out] = attachProfoundEvidenceToMoves([m], CORPUS);
    expect(out!.aeoEvidence).toBeUndefined();
  });

  it("returns moves unchanged when there are no opportunities", () => {
    const m = move({ label: "anything" });
    expect(attachProfoundEvidenceToMoves([m], [])[0]).toBe(m);
  });

  it("aeoEvidenceSentence reads as plain language with the prompt + competitors", () => {
    const m = move({ label: "persian girl names", competitorUrls: ["https://momlovesbest.com/x"] });
    const [out] = attachProfoundEvidenceToMoves([m], CORPUS);
    const s = aeoEvidenceSentence(out!.aeoEvidence!);
    expect(s).toContain("AI is asked");
    expect(s.toLowerCase()).toContain("persian girl names");
  });
});
