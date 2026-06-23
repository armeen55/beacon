import { describe, it, expect } from "vitest";

import {
  parseSerpHypothesis,
  generateSerpHypothesis,
} from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";

describe("parseSerpHypothesis — pure parser (TASK 2)", () => {
  const asked = ["iran flag", "persian flag"];

  it("always labels the result synthetic + suspected, never observed", () => {
    const h = parseSerpHypothesis(
      {
        queries: [
          {
            query: "iran flag",
            likely_features: ["image_pack", "knowledge_panel"],
            feature_likely_owns_answer: true,
            click_loss_cause: "image pack answers above the organic link",
            confidence: "medium",
            rationale: "flag queries trigger an image pack",
            recommended_check: "search incognito and look for an image pack",
          },
        ],
        overall: { feature_likely_owns_answer: true, summary: "Image-led SERP." },
      },
      asked,
    );
    expect(h).not.toBeNull();
    expect(h!.source).toBe("synthetic");
    expect(h!.serpStatus).toBe("suspected"); // never "observed"
    expect(h!.featureLikelyOwnsAnswer).toBe(true);
    expect(h!.queries[0].likelyFeatures).toEqual(["image_pack", "knowledge_panel"]);
  });

  it("keeps ONLY asked queries (drops hallucinated extra queries)", () => {
    const h = parseSerpHypothesis(
      {
        queries: [
          { query: "iran flag", likely_features: ["image_pack"], feature_likely_owns_answer: true, confidence: "low" },
          { query: "made up query", likely_features: ["video"], feature_likely_owns_answer: true, confidence: "low" },
        ],
        overall: {},
      },
      asked,
    );
    expect(h!.queries).toHaveLength(1);
    expect(h!.queries[0].query).toBe("iran flag");
  });

  it("derives overall featureOwns from per-query when overall omits it", () => {
    const h = parseSerpHypothesis(
      {
        queries: [
          { query: "persian flag", likely_features: ["featured_snippet"], feature_likely_owns_answer: true, confidence: "low" },
        ],
        overall: {}, // no overall flag
      },
      asked,
    );
    expect(h!.featureLikelyOwnsAnswer).toBe(true);
  });

  it("clamps confidence to low/medium (never high) and defaults unknown features to none", () => {
    const h = parseSerpHypothesis(
      {
        queries: [
          { query: "iran flag", likely_features: ["bogus_feature"], feature_likely_owns_answer: false, confidence: "high" },
        ],
        overall: {},
      },
      asked,
    );
    expect(h!.queries[0].confidence).toBe("low"); // "high" clamped
    expect(h!.queries[0].likelyFeatures).toEqual(["none"]); // bogus filtered → none
  });

  it("strips em dashes from generated copy", () => {
    const h = parseSerpHypothesis(
      {
        queries: [
          {
            query: "iran flag",
            likely_features: ["image_pack"],
            feature_likely_owns_answer: true,
            click_loss_cause: "image pack — owns the answer",
            confidence: "low",
            rationale: "flag query — image led",
            recommended_check: "check it",
          },
        ],
        overall: { summary: "Image led — verify." },
      },
      asked,
    );
    expect(h!.queries[0].clickLossCause).not.toContain("—");
    expect(h!.queries[0].rationale).not.toContain("—");
    expect(h!.summary).not.toContain("—");
  });

  it("returns null when no asked query parses", () => {
    expect(parseSerpHypothesis({ queries: [], overall: {} }, asked)).toBeNull();
    expect(parseSerpHypothesis(null, asked)).toBeNull();
    expect(parseSerpHypothesis({ queries: [{ query: "other" }], overall: {} }, asked)).toBeNull();
  });
});

describe("generateSerpHypothesis — guards", () => {
  it("returns null with no queries (no model spend)", async () => {
    const out = await generateSerpHypothesis(
      { pagePath: "/cities", queries: [] },
      { fetchImpl: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch },
    );
    expect(out).toBeNull();
  });

  it("caps at MAX_SERP_QUERIES and labels the parsed result synthetic", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  queries: [
                    { query: "q1", likely_features: ["ai_overview"], feature_likely_owns_answer: true, confidence: "low" },
                  ],
                  overall: { feature_likely_owns_answer: true, summary: "ok" },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const out = await generateSerpHypothesis(
      {
        pagePath: "/x",
        queries: Array.from({ length: 12 }, (_, i) => ({
          query: i === 0 ? "q1" : `q${i + 1}`,
          position: 4,
          impressions: 100,
          ctr: 0.01,
        })),
      },
      { fetchImpl: fakeFetch },
    );
    expect(out).not.toBeNull();
    expect(out!.source).toBe("synthetic");
    expect(out!.queries[0].query).toBe("q1");
  });
});
