import { describe, it, expect } from "vitest";

import {
  isGraphStale,
  isGraphSnapshotValid,
  GRAPH_FRESH_MS,
  GRAPH_SCHEMA_VERSION,
  type GraphSnapshotRow,
} from "./graph-snapshot-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import type { LoadGraphResult } from "./load-graph";
import type { MoveCandidate } from "./build-graph";

const NOW = Date.parse("2026-06-29T12:00:00Z");

/** A move carrying EVERY post-pass attachment (learning prior, proof caution, AEO
 *  evidence, canonical group) — the fields a serialization bug would silently drop. */
function richMove(over: Partial<MoveCandidate> = {}): MoveCandidate {
  return {
    demandKey: "k1",
    label: "persian boy names",
    gap: "edit_page",
    score: 87.5,
    components: { demand: 5000, winnability: 0.6, dollarValue: 1, visibilityGap: 0.4, friction: 0 } as unknown as MoveCandidate["components"],
    confidence: "high",
    signals: ["gsc", "profound"],
    ownedUrl: "https://iranopedia.com/persian-male-first-names",
    competitorUrls: ["https://babynama.com/x"],
    fanoutSeeds: ["what are common persian boy names?"],
    rationale: "ranks #6, AI cites a rival",
    learnedPrior: { multiplier: 1.12, decidedSample: 5, basis: "title_meta", tag: "won 4/5" },
    outcomeCaution: { kind: "measuring", multiplier: 1, label: "measuring", family: "aeo", reason: "mid-measurement" } as unknown as MoveCandidate["outcomeCaution"],
    aeoEvidence: { topPrompt: "best persian boy names", citedDomains: ["babynama.com"], ownAbsent: true } as unknown as MoveCandidate["aeoEvidence"],
    canonicalGroup: { alsoCovers: ["iranian boy names"], inheritFrom: null, reason: "near-dup", confidence: "high" } as unknown as MoveCandidate["canonicalGroup"],
    ...over,
  };
}

function snapshot(moves: MoveCandidate[]): LoadGraphResult {
  return {
    graph: {
      demandNodes: [{ key: "k1", label: "persian boy names", queries: [] } as never],
      pageNodes: [{ url: "https://iranopedia.com/persian-male-first-names", isOwned: true } as never],
      edges: [],
      moves,
    },
    coverage: {
      gscPages: 197, ga4Pages: 397, clarityPages: 179, competitorCitations: 9510,
      competitorEdges: 2061, createPageCandidates: 40, ownedCited: 37, emptySources: [],
      coherence: { suppressedCandidates: [], trimmedCandidates: [] },
      ownershipReclassified: [],
    },
  };
}

function row(over: Partial<GraphSnapshotRow> = {}): GraphSnapshotRow {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, computedAt: "2026-06-29T11:58:00Z", data: snapshot([richMove()]), ...over };
}

describe("graph-snapshot tenant isolation (store is per-tenant, never global)", () => {
  it("the demand-graph-snapshot store is classified per-tenant", () => {
    expect(classifyStore("demand-graph-snapshot")).toBe("per-tenant");
  });
  it("it is NOT a global store (would leak across tenants)", () => {
    expect(classifyStore("demand-graph-snapshot")).not.toBe("global");
  });
});

describe("isGraphStale (15-min TTL)", () => {
  it("a fresh snapshot (<15min) is not stale", () => {
    expect(isGraphStale(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW)).toBe(false);
  });
  it("a snapshot older than the TTL is stale", () => {
    expect(isGraphStale(new Date(NOW - GRAPH_FRESH_MS - 1000).toISOString(), NOW)).toBe(true);
  });
  it("an unparseable timestamp is treated as stale (recompute, don't trust)", () => {
    expect(isGraphStale("not-a-date", NOW)).toBe(true);
  });
});

describe("isGraphSnapshotValid (version + shape gate)", () => {
  it("a current-version, well-shaped snapshot is valid", () => {
    expect(isGraphSnapshotValid(row())).toBe(true);
  });
  it("null is invalid (cache miss)", () => {
    expect(isGraphSnapshotValid(null)).toBe(false);
  });
  it("a version mismatch is invalid (recompute, don't trust an old shape)", () => {
    expect(isGraphSnapshotValid(row({ schemaVersion: GRAPH_SCHEMA_VERSION - 1 }))).toBe(false);
  });
  it("a corrupt snapshot missing graph.moves is invalid", () => {
    const bad = row();
    // @ts-expect-error — deliberately corrupt the shape
    delete bad.data.graph.moves;
    expect(isGraphSnapshotValid(bad)).toBe(false);
  });
  it("a corrupt snapshot missing pageNodes is invalid", () => {
    const bad = row();
    // @ts-expect-error — deliberately corrupt
    delete bad.data.graph.pageNodes;
    expect(isGraphSnapshotValid(bad)).toBe(false);
  });
});

describe("serialization parity — ranking + learning + proof + research survive round-trip", () => {
  it("move order and scores are byte-identical after JSON round-trip", () => {
    const original = snapshot([richMove({ demandKey: "a", score: 90 }), richMove({ demandKey: "b", score: 80 }), richMove({ demandKey: "c", score: 70 })]);
    const round = JSON.parse(JSON.stringify(original)) as LoadGraphResult;
    const key = (m: MoveCandidate) => `${m.demandKey}|${m.score}|${m.gap}`;
    expect(round.graph.moves.map(key)).toEqual(original.graph.moves.map(key));
  });
  it("every attached field (learnedPrior / outcomeCaution / aeoEvidence / canonicalGroup) survives", () => {
    const original = snapshot([richMove()]);
    const round = JSON.parse(JSON.stringify(original)) as LoadGraphResult;
    const m = round.graph.moves[0];
    expect(m.learnedPrior).toEqual(original.graph.moves[0].learnedPrior);
    expect(m.outcomeCaution).toEqual(original.graph.moves[0].outcomeCaution);
    expect(m.aeoEvidence).toEqual(original.graph.moves[0].aeoEvidence);
    expect(m.canonicalGroup).toEqual(original.graph.moves[0].canonicalGroup);
    expect(m.components).toEqual(original.graph.moves[0].components);
  });
  it("coverage + node arrays survive (consumers read pageNodes for owned URLs)", () => {
    const original = snapshot([richMove()]);
    const round = JSON.parse(JSON.stringify(original)) as LoadGraphResult;
    expect(round.coverage).toEqual(original.coverage);
    expect(round.graph.pageNodes.length).toBe(original.graph.pageNodes.length);
    expect(round.graph.demandNodes.length).toBe(original.graph.demandNodes.length);
  });
});
