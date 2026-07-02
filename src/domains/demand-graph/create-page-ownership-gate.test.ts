import { describe, it, expect } from "vitest";
import { gateCreatePageOwnership } from "./create-page-ownership-gate";
import type { MoveCandidate } from "./build-graph";
import type { AeoEvidence } from "./profound-evidence-fusion";

const mv = (o: Partial<MoveCandidate> & { demandKey: string; label: string; gap: MoveCandidate["gap"] }): MoveCandidate => ({
  score: 1,
  components: { demand: 1, winnability: 1, dollarValue: 0, visibilityGap: 1, friction: 0 } as MoveCandidate["components"],
  confidence: "medium",
  signals: [],
  ownedUrl: null,
  competitorUrls: [],
  fanoutSeeds: [],
  rationale: "",
  ...o,
});

const evidence = (over: Partial<AeoEvidence> = {}): AeoEvidence => ({
  source: "profound",
  prompts: ["What are the most famous works of Persian literature?"],
  promptCount: 1,
  fanoutQueries: [],
  topCitedPages: [],
  topCitedDomains: [],
  ownCitationCount: 0,
  competitorCitationCount: 0,
  recommendedContentShape: "answer block",
  confidence: "high",
  matchBasis: "same competitors + subject",
  ...over,
});

describe("gateCreatePageOwnership", () => {
  it("operator ground-truth: reclassifies 'Persian Literature' (own page already cited) from create_page to edit_page", () => {
    const move = mv({
      demandKey: "gap:literature-persian",
      label: "Persian Literature",
      gap: "create_page",
      aeoEvidence: evidence({
        ownCitationCount: 2,
        topCitedPages: [
          { url: "https://iranopedia.com/persian-literature", hostname: "iranopedia.com", isOwned: true, answers: 2 },
          { url: "https://en.wikipedia.org/wiki/Persian_literature", hostname: "en.wikipedia.org", isOwned: false, answers: 5 },
        ],
      }),
    });
    const result = gateCreatePageOwnership([move]);
    expect(result.moves.length).toBe(1);
    expect(result.moves[0].gap).toBe("edit_page");
    expect(result.moves[0].ownedUrl).toBe("https://iranopedia.com/persian-literature");
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].action).toBe("reclassified");
  });

  it("drops (never mislabels) when own domain is cited but no specific URL is known", () => {
    const move = mv({
      demandKey: "gap:x",
      label: "Some Topic",
      gap: "create_page",
      aeoEvidence: evidence({ ownCitationCount: 1, topCitedPages: [{ url: "https://competitor.com/x", hostname: "competitor.com", isOwned: false, answers: 3 }] }),
    });
    const result = gateCreatePageOwnership([move]);
    expect(result.moves.length).toBe(0);
    expect(result.changes[0].action).toBe("dropped");
  });

  it("leaves a genuine create_page candidate (own citation count 0) untouched", () => {
    const move = mv({
      demandKey: "gap:travel",
      label: "Travel Iran Beautiful Natural Wonders",
      gap: "create_page",
      aeoEvidence: evidence({ ownCitationCount: 0 }),
    });
    const result = gateCreatePageOwnership([move]);
    expect(result.moves.length).toBe(1);
    expect(result.moves[0].gap).toBe("create_page");
    expect(result.changes.length).toBe(0);
  });

  it("leaves a create_page candidate with no aeoEvidence untouched", () => {
    const move = mv({ demandKey: "gap:y", label: "No Evidence Topic", gap: "create_page" });
    const result = gateCreatePageOwnership([move]);
    expect(result.moves.length).toBe(1);
    expect(result.changes.length).toBe(0);
  });

  it("never touches non-create_page moves", () => {
    const move = mv({
      demandKey: "edit-1",
      label: "Some page",
      gap: "edit_page",
      aeoEvidence: evidence({ ownCitationCount: 5, topCitedPages: [{ url: "https://iranopedia.com/x", hostname: "iranopedia.com", isOwned: true, answers: 5 }] }),
    });
    const result = gateCreatePageOwnership([move]);
    expect(result.moves[0].gap).toBe("edit_page");
    expect(result.changes.length).toBe(0);
  });
});
