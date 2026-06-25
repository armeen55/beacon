import { describe, it, expect } from "vitest";

import {
  detectToolIntent,
  buildToolOpportunities,
  buildAssetSpec,
  type ToolQueryInput,
} from "@/domains/demand-graph/tool-intent";

const q = (query: string, impressions: number, clicks = 0): ToolQueryInput => ({ query, impressions, clicks });

describe("detectToolIntent", () => {
  it("classifies the tool kind from generic vocabulary", () => {
    expect(detectToolIntent("farsi number converter").kind).toBe("converter");
    expect(detectToolIntent("persian name generator").kind).toBe("generator");
    expect(detectToolIntent("mortgage calculator").kind).toBe("calculator");
    expect(detectToolIntent("which iranian food are you quiz").kind).toBe("quiz");
    expect(detectToolIntent("adu feasibility checker").kind).toBe("checker");
    expect(detectToolIntent("project timeline estimator").kind).toBe("estimator");
  });
  it("is false for informational queries", () => {
    expect(detectToolIntent("history of persian new year").isToolIntent).toBe(false);
    expect(detectToolIntent("").isToolIntent).toBe(false);
  });
});

describe("buildToolOpportunities", () => {
  it("keeps tool-intent queries with demand, ranked by impressions", () => {
    const ops = buildToolOpportunities([
      q("persian name generator", 2000, 10),
      q("history of nowruz", 9000, 500), // informational → excluded
      q("farsi number converter", 800, 5),
      q("tiny tool query", 5), // below minImpressions
    ]);
    expect(ops.map((o) => o.kind)).toEqual(["generator", "converter"]);
    expect(ops[0]!.suggestion).toBe("Persian Name generator");
  });

  it("dedupes the same tool+topic, keeping the higher-demand phrasing", () => {
    const ops = buildToolOpportunities([
      q("convert farsi numbers", 300),
      q("farsi numbers converter", 1200),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.impressions).toBe(1200);
    expect(ops[0]!.kind).toBe("converter");
  });

  it("respects the cap", () => {
    const many = Array.from({ length: 10 }, (_, i) => q(`thing ${i} calculator`, 100 + i));
    expect(buildToolOpportunities(many, { cap: 3 })).toHaveLength(3);
  });

  it("carries the bare topic for spec generation", () => {
    const ops = buildToolOpportunities([q("persian name generator", 100)]);
    expect(ops[0]!.topic).toBe("persian name");
  });
});

describe("buildAssetSpec", () => {
  it("gives a kind-appropriate, topic-slotted build brief", () => {
    const gen = buildAssetSpec("generator", "persian name");
    expect(gen.summary).toContain("persian name");
    expect(gen.inputs.length).toBeGreaterThan(0);
    expect(gen.outputs.length).toBeGreaterThan(0);
    expect(gen.buildPath).toMatch(/client|widget|serverless/i);
    const conv = buildAssetSpec("converter", "farsi numbers");
    expect(conv.summary).toContain("farsi numbers");
    expect(conv.summary).not.toBe(gen.summary); // kind-specific
  });
  it("falls back to the generic tool spec for an unknown topic", () => {
    const spec = buildAssetSpec("tool", "");
    expect(spec.inputs.length).toBeGreaterThan(0);
    expect(spec.buildPath).toBeTruthy();
  });
});
