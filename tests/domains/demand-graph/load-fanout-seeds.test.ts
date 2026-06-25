import { describe, it, expect } from "vitest";

import { fanoutSeedsForNode } from "@/domains/demand-graph/load-fanout-seeds";
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
