import { describe, it, expect } from "vitest";
import { createPageClusterItems } from "@/domains/demand-graph/to-cluster-items";
import type { DemandGraph, MoveCandidate } from "@/domains/demand-graph/build-graph";

function move(p: Partial<MoveCandidate> & { gap: MoveCandidate["gap"] }): MoveCandidate {
  return {
    demandKey: p.demandKey ?? "k", label: p.label ?? "persian wedding", gap: p.gap,
    score: p.score ?? 1000,
    components: p.components ?? { demand: 5000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 },
    confidence: p.confidence ?? "high", signals: p.signals ?? ["AI"], ownedUrl: p.ownedUrl ?? null,
    competitorUrls: p.competitorUrls ?? [], fanoutSeeds: p.fanoutSeeds ?? [], rationale: p.rationale ?? "",
  };
}
function graph(moves: MoveCandidate[]): DemandGraph {
  return { demandNodes: [], pageNodes: [], edges: [], moves };
}

describe("createPageClusterItems (Step 5 — demand-driven page factory)", () => {
  it("includes ONLY create_page Moves, slugified + title-cased, ranked by demand", () => {
    const items = createPageClusterItems({
      graph: graph([
        move({ gap: "edit_page", demandKey: "e", label: "cities in iran" }),
        move({ gap: "create_page", demandKey: "a", label: "Persian Wedding", components: { demand: 100, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 } }),
        move({ gap: "create_page", demandKey: "b", label: "nowruz haft-sin", components: { demand: 900, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 } }),
      ]),
    });
    expect(items).toHaveLength(2); // only the 2 create_page
    expect(items[0]!.slug).toBe("nowruz-haft-sin"); // higher demand first
    expect(items[0]!.title).toBe("Nowruz Haft-sin");
    expect(items[1]!.slug).toBe("persian-wedding");
    expect(items.every((i) => i.brief.length > 0)).toBe(true);
  });

  it("dedupes by slug + respects max", () => {
    const items = createPageClusterItems({
      max: 1,
      graph: graph([
        move({ gap: "create_page", demandKey: "a", label: "persian wedding", components: { demand: 50, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 } }),
        move({ gap: "create_page", demandKey: "b", label: "nowruz", components: { demand: 99, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 } }),
      ]),
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.slug).toBe("nowruz");
  });

  it("brief is grounded but never empty even without a packet", () => {
    const items = createPageClusterItems({ graph: graph([move({ gap: "create_page", label: "persian music" })]) });
    expect(items[0]!.brief).toContain("persian music");
  });
});
