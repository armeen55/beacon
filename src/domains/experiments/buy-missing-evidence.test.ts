import { describe, it, expect } from "vitest";
import type { EvidencePacket, DraftSkeleton } from "@/domains/demand-graph/evidence-packet";
import type { MoveComponents, GapKind } from "@/domains/demand-graph/build-graph";
import type { SerpSnapshot } from "@/domains/serp/serp-provider";
import type { SerpRunResult } from "@/domains/serp/dataforseo-serp";
import {
  findEvidenceGaps,
  buyEvidenceForPick,
  type EvidenceGapCandidate,
} from "./buy-missing-evidence";

const baseComponents = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});
const baseDraft = (): DraftSkeleton => ({
  kind: "deterministic_skeleton", titleSuggestion: "T", metaBrief: "M", outline: [],
  answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "n",
});

function packet(over: {
  move?: Partial<EvidencePacket["move"]>;
  yourPage?: Partial<EvidencePacket["yourPage"]>;
  competitor?: Partial<EvidencePacket["competitor"]>;
} = {}): EvidencePacket {
  const gapType: GapKind = over.move?.gapType ?? "edit_page";
  return {
    move: {
      key: "k1", gapType, label: "persian wedding traditions", confidence: "medium", score: 1000,
      components: baseComponents(over.move?.components), signals: over.move?.signals ?? ["GSC", "owned-page"],
      ...over.move,
    },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: [] },
    competitor: {
      topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "-",
      relevance: 0, looselyMatched: false, otherUrls: [], ...over.competitor,
    },
    yourPage: {
      url: "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0,
      ...over.yourPage,
    },
    gaps: [],
    draft: baseDraft(),
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash123",
  };
}

function candidate(over: Partial<EvidenceGapCandidate> = {}): EvidenceGapCandidate {
  return {
    url: "https://iranopedia.com/wedding",
    targetQuery: "persian wedding traditions",
    packet: packet(),
    rankScore: 100,
    hasCachedSerpPattern: false,
    hasFreshSerpHistory: false,
    ...over,
  };
}

function snapshot(over: Partial<SerpSnapshot> = {}): SerpSnapshot {
  return {
    query: "persian wedding traditions",
    results: [
      { rank: 1, url: "https://theknot.com/persian-wedding", title: "Persian Wedding", domain: "theknot.com" },
      { rank: 2, url: "https://example.com/x", title: "X", domain: "example.com" },
      { rank: 3, url: "https://example2.com/x", title: "X", domain: "example2.com" },
      { rank: 4, url: "https://example3.com/x", title: "X", domain: "example3.com" },
      { rank: 5, url: "https://example4.com/x", title: "X", domain: "example4.com" },
    ],
    features: [],
    source: "dataforseo",
    fetchedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function okRun(over: Partial<SerpRunResult> = {}): SerpRunResult {
  return {
    status: "ok",
    plan: { endpoint: "x", query: "persian wedding traditions", locationCode: 2840, languageCode: "en", estCostUsd: 0.003 },
    snapshot: snapshot(),
    costUsd: 0.003,
    detail: "5 results",
    ...over,
  };
}

describe("findEvidenceGaps", () => {
  it("finds no gap when the pick has no packet (nothing to debate)", () => {
    const gaps = findEvidenceGaps([candidate({ packet: null })]);
    expect(gaps).toHaveLength(0);
  });

  it("finds a gap when a packeted pick has neither cached pattern nor fresh history", () => {
    const gaps = findEvidenceGaps([candidate()]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.query).toBe("persian wedding traditions");
  });

  it("does NOT flag a gap when a cached SERP pattern already exists for the query", () => {
    const gaps = findEvidenceGaps([candidate({ hasCachedSerpPattern: true })]);
    expect(gaps).toHaveLength(0);
  });

  it("does NOT flag a gap when a fresh SERP history row already exists for the query", () => {
    const gaps = findEvidenceGaps([candidate({ hasFreshSerpHistory: true })]);
    expect(gaps).toHaveLength(0);
  });

  it("skips a candidate with an empty/blank target query", () => {
    const gaps = findEvidenceGaps([candidate({ targetQuery: "   " })]);
    expect(gaps).toHaveLength(0);
  });

  it("bounds to the top 5 picks by rankScore (item 39's bound), never more", () => {
    const picks = Array.from({ length: 12 }, (_, i) =>
      candidate({ url: `https://iranopedia.com/p${i}`, targetQuery: `query ${i}`, rankScore: i }),
    );
    const gaps = findEvidenceGaps(picks);
    expect(gaps.length).toBeLessThanOrEqual(5);
    // Highest rankScore picks (11, 10, 9, 8, 7) should be the ones chosen.
    const chosenQueries = gaps.map((g) => g.query).sort();
    expect(chosenQueries).toEqual(["query 10", "query 11", "query 7", "query 8", "query 9"]);
  });

  it("respects a custom maxGaps override", () => {
    const picks = Array.from({ length: 8 }, (_, i) =>
      candidate({ url: `https://iranopedia.com/p${i}`, targetQuery: `query ${i}`, rankScore: i }),
    );
    const gaps = findEvidenceGaps(picks, { maxGaps: 2 });
    expect(gaps).toHaveLength(2);
  });

  it("maxGaps of 0 buys nothing", () => {
    const gaps = findEvidenceGaps([candidate()], { maxGaps: 0 });
    expect(gaps).toHaveLength(0);
  });

  it("a mixed batch: some picks covered, some gaps, respecting the bound", () => {
    const picks = [
      candidate({ url: "https://iranopedia.com/a", targetQuery: "a", rankScore: 5, hasCachedSerpPattern: true }),
      candidate({ url: "https://iranopedia.com/b", targetQuery: "b", rankScore: 4 }),
      candidate({ url: "https://iranopedia.com/c", targetQuery: "c", rankScore: 3, packet: null }),
      candidate({ url: "https://iranopedia.com/d", targetQuery: "d", rankScore: 2 }),
    ];
    const gaps = findEvidenceGaps(picks);
    expect(gaps.map((g) => g.query)).toEqual(["b", "d"]);
  });
});

describe("buyEvidenceForPick", () => {
  it("buys and returns a build verdict + receipt sentence on a genuine content SERP", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      ownDomain: "iranopedia.com",
      runQuery: async () => okRun(),
    });
    expect(result.status).toBe("bought");
    expect(result.serpVerdict).toBeDefined();
    expect(result.serpVerdict!.verdict).toBe("build");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.receiptSentence).toContain("I checked Google live before finalizing this pick");
    expect(result.receiptSentence).toContain("persian wedding traditions");
  });

  it("fails soft to declined on a dry-run status (never fabricates evidence)", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => ({
        status: "dry_run", plan: okRun().plan, snapshot: null, costUsd: 0, detail: "dry-run",
      }),
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("dry_run");
    expect(result.serpVerdict).toBeUndefined();
    expect(result.costUsd).toBe(0);
  });

  it("fails soft to declined when the gauntlet reports capped (fail-closed spend guard)", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => ({
        status: "capped", plan: okRun().plan, snapshot: null, costUsd: 0, detail: "cap reached",
      }),
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("capped");
  });

  it("fails soft to declined when the gauntlet reports disabled (not configured)", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => ({
        status: "disabled", plan: okRun().plan, snapshot: null, costUsd: 0, detail: "not configured",
      }),
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("disabled");
  });

  it("fails soft to declined on an error status, never throwing", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => ({
        status: "error", plan: okRun().plan, snapshot: null, costUsd: 0, detail: "http 500",
      }),
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("error");
  });

  it("fails soft to declined when runQuery itself throws (network blew up)", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => {
        throw new Error("boom");
      },
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("error");
  });

  it("fails soft to declined when the snapshot has zero results", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      runQuery: async () => okRun({ snapshot: snapshot({ results: [] }) }),
    });
    expect(result.status).toBe("declined");
    expect(result.declineReason).toBe("no_results");
  });

  it("accepts a cache_hit status as a genuine, usable read (still 'bought')", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      ownDomain: "iranopedia.com",
      runQuery: async () => ({ ...okRun(), status: "cache_hit", costUsd: 0 }),
    });
    expect(result.status).toBe("bought");
    expect(result.serpVerdict).toBeDefined();
  });

  it("never emits an em or en dash anywhere in the receipt sentence", async () => {
    const gap = findEvidenceGaps([candidate()])[0]!;
    const result = await buyEvidenceForPick(gap, {
      ownDomain: "iranopedia.com",
      runQuery: async () => okRun(),
    });
    expect(/[–—]/.test(result.receiptSentence ?? "")).toBe(false);
  });
});
