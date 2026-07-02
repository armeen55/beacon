import { describe, it, expect } from "vitest";

import { fanoutSeedsForNode, mergeFanoutSources } from "@/domains/demand-graph/load-fanout-seeds";
import type { FanoutSeed } from "@/lib/connectors/profound/summarize-fanouts";

const seeds: FanoutSeed[] = [
  { subQuery: "what is the national animal of iran", weight: 50, prompts: [] },
  { subQuery: "asiatic cheetah facts", weight: 30, prompts: [] },
  { subQuery: "persian wedding traditions sofreh aghd", weight: 20, prompts: [] },
  { subQuery: "best laptops 2026", weight: 999, prompts: [] }, // off-topic, high weight
];

describe("fanoutSeedsForNode (Phase 5 fanout → node match)", () => {
  it("attaches fanout sub-queries that share a topic token, ranked by weight", () => {
    const got = fanoutSeedsForNode("iran national animal", ["asiatic cheetah"], seeds);
    expect(got).toContain("what is the national animal of iran");
    expect(got).toContain("asiatic cheetah facts");
    // the high-weight but off-topic "best laptops 2026" must NOT leak in
    expect(got).not.toContain("best laptops 2026");
  });

  it("returns empty (never invents) when nothing matches the node", () => {
    // No shared significant token with any seed → no fabricated attachment.
    expect(fanoutSeedsForNode("swimming pool installation", [], seeds)).toEqual([]);
  });

  it("returns empty when there are no fanout seeds at all (honest empty state)", () => {
    expect(fanoutSeedsForNode("iran national animal", ["asiatic cheetah"], [])).toEqual([]);
  });

  it("caps the number of seeds per node", () => {
    const many: FanoutSeed[] = Array.from({ length: 20 }, (_, i) => ({
      subQuery: `iran fact number ${i}`,
      weight: 20 - i,
      prompts: [],
    }));
    expect(fanoutSeedsForNode("iran facts", [], many, 6)).toHaveLength(6);
  });
});

describe("mergeFanoutSources (D1, native question expansion joins Profound fanouts)", () => {
  it("keeps distinct sub-queries from both sources, tagged by source", () => {
    const profound: FanoutSeed[] = [{ subQuery: "persian wedding traditions", weight: 10, prompts: ["p1"] }];
    const native: FanoutSeed[] = [{ subQuery: "what is chaharshanbe suri", weight: 3, prompts: ["p2"] }];
    const merged = mergeFanoutSources(profound, native);
    expect(merged).toHaveLength(2);
    const profoundOne = merged.find((s) => s.subQuery === "persian wedding traditions")!;
    expect(profoundOne.source).toBe("profound");
    const nativeOne = merged.find((s) => s.subQuery === "what is chaharshanbe suri")!;
    expect(nativeOne.source).toBe("native");
  });

  it("collapses the same real question from both sources into one, weight summed", () => {
    const profound: FanoutSeed[] = [{ subQuery: "what is Nowruz?", weight: 5, prompts: ["p1"] }];
    const native: FanoutSeed[] = [{ subQuery: "What is nowruz", weight: 2, prompts: ["p2"] }];
    const merged = mergeFanoutSources(profound, native);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ weight: 7, source: "profound" });
    expect(merged[0]!.prompts.sort()).toEqual(["p1", "p2"]);
  });

  it("ranks the merged set by weight descending", () => {
    const profound: FanoutSeed[] = [{ subQuery: "low weight question", weight: 1, prompts: [] }];
    const native: FanoutSeed[] = [{ subQuery: "high weight question", weight: 9, prompts: [] }];
    const merged = mergeFanoutSources(profound, native);
    expect(merged.map((s) => s.subQuery)).toEqual(["high weight question", "low weight question"]);
  });

  it("honest empty when both sources are empty", () => {
    expect(mergeFanoutSources([], [])).toEqual([]);
  });

  it("works with only a native source (Profound never synced for this tenant)", () => {
    const native: FanoutSeed[] = [{ subQuery: "native only question", weight: 4, prompts: ["p1"] }];
    const merged = mergeFanoutSources([], native);
    expect(merged).toEqual([{ subQuery: "native only question", weight: 4, prompts: ["p1"], source: "native" }]);
  });
});
