import { describe, it, expect } from "vitest";
import { gateCreatePageOwnership, gateCreatePageOwnershipWithRegistry } from "@/domains/demand-graph/create-page-ownership-gate";
import { buildOwnershipRegistry, type OwnershipRegistry } from "@/domains/ownership/registry";
import type { GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { AeoEvidence } from "@/domains/demand-graph/profound-evidence-fusion";

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

function cannibalCase(over: Partial<GscCannibalizationCase> & { query: string }): GscCannibalizationCase {
  return {
    competingUrls: [],
    urlCount: 0,
    totalClicks: 0,
    totalImpressions: 0,
    leadUrl: "",
    bestPosition: 0,
    weightedPosition: 0,
    ...over,
  };
}

describe("gateCreatePageOwnershipWithRegistry (N2)", () => {
  it("is byte-identical to gateCreatePageOwnership when no registry is passed", () => {
    const move = mv({ demandKey: "gap:travel", label: "Travel Iran Beautiful Natural Wonders", gap: "create_page", aeoEvidence: evidence({ ownCitationCount: 0 }) });
    const withoutRegistry = gateCreatePageOwnership([move]);
    expect(gateCreatePageOwnershipWithRegistry([move], null)).toEqual(withoutRegistry);
    expect(gateCreatePageOwnershipWithRegistry([move], undefined)).toEqual(withoutRegistry);
  });

  it("is byte-identical when the registry is empty (no queries resolved)", () => {
    const move = mv({ demandKey: "gap:travel", label: "Travel Iran Beautiful Natural Wonders", gap: "create_page", aeoEvidence: evidence({ ownCitationCount: 0 }) });
    const emptyRegistry: OwnershipRegistry = { byQuery: new Map(), conflicts: [], coverage: { totalQueries: 0, gscBasisCount: 0, serpClusterBasisCount: 0, unresolvedCount: 0 } };
    expect(gateCreatePageOwnershipWithRegistry([move], emptyRegistry)).toEqual(gateCreatePageOwnership([move]));
  });

  it("reclassifies a create_page candidate the registry already resolves to an owned page (gsc_ranks), even with zero AI citations", () => {
    const move = mv({ demandKey: "gap:names", label: "Persian Male Names", gap: "create_page", aeoEvidence: evidence({ ownCitationCount: 0 }) });
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "persian male names",
          totalImpressions: 500,
          competingUrls: [{ url: "https://iranopedia.com/persian-male-names", clicks: 20, impressions: 500, position: 2 }],
        }),
      ],
      clusters: [],
    });
    const result = gateCreatePageOwnershipWithRegistry([move], registry);
    expect(result.moves.length).toBe(1);
    expect(result.moves[0].gap).toBe("edit_page");
    expect(result.moves[0].ownedUrl).toBe("https://iranopedia.com/persian-male-names");
    expect(result.changes[0].action).toBe("reclassified");
    expect(result.changes[0].reason).toContain("gsc_ranks");
  });

  it("the citation gate still runs FIRST, a Move it already reclassifies is never re-processed by the registry", () => {
    const move = mv({
      demandKey: "gap:literature-persian",
      label: "Persian Literature",
      gap: "create_page",
      aeoEvidence: evidence({
        ownCitationCount: 2,
        topCitedPages: [{ url: "https://iranopedia.com/persian-literature", hostname: "iranopedia.com", isOwned: true, answers: 2 }],
      }),
    });
    // A registry that would (if it ran on the ORIGINAL move) name a DIFFERENT owner,
    // proving the citation gate's result, not the original label, is what the registry checks.
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "persian literature",
          totalImpressions: 500,
          competingUrls: [{ url: "https://iranopedia.com/some-other-page", clicks: 20, impressions: 500, position: 2 }],
        }),
      ],
      clusters: [],
    });
    const result = gateCreatePageOwnershipWithRegistry([move], registry);
    expect(result.moves[0].gap).toBe("edit_page");
    // Citation gate's own owned URL wins, the registry never re-touches a non-create_page move.
    expect(result.moves[0].ownedUrl).toBe("https://iranopedia.com/persian-literature");
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].reason).not.toContain("registry");
  });

  it("leaves a genuine create_page candidate untouched when the registry has no opinion", () => {
    const move = mv({ demandKey: "gap:travel", label: "Travel Iran Beautiful Natural Wonders", gap: "create_page", aeoEvidence: evidence({ ownCitationCount: 0 }) });
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "totally unrelated query",
          totalImpressions: 500,
          competingUrls: [{ url: "https://iranopedia.com/other", clicks: 20, impressions: 500, position: 2 }],
        }),
      ],
      clusters: [],
    });
    const result = gateCreatePageOwnershipWithRegistry([move], registry);
    expect(result.moves[0].gap).toBe("create_page");
    expect(result.changes.length).toBe(0);
  });
});
