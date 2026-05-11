/**
 * /prompts v2A — pure projection truth-table tests.
 *
 * Pins the legacy → customer-safe category map, the counter
 * derivation, the platform-state resolver, and the card row
 * builder. The v2 client never mutates these — it only reads —
 * so any regression that breaks the contract here would show up
 * in the rendered HTML.
 */
import { describe, expect, it } from "vitest";

import {
  categoryForKind,
  categoryForLegacy,
  computePromptsV2Counters,
  PROMPTS_V2_CATEGORY_ORDER,
  PROMPTS_V2_CATEGORY_TABLE,
  platformLabel,
  projectPlatformBadge,
  projectPromptToCardRow,
  projectPromptsToSections,
  type PromptsV2CategoryKind,
} from "@/domains/prompts/v2-projection";
import type {
  PromptOpportunity,
  PromptOpportunityCategory,
  PromptPlatformStats,
} from "@/domains/prompts/opportunity-classify";

function plat(over: Partial<PromptPlatformStats> = {}): PromptPlatformStats {
  return {
    platform: "chatgpt",
    observations: 3,
    primary: 0,
    cited: 0,
    mentioned: 0,
    absent: 0,
    avgCitationRank: null,
    ...over,
  };
}

function op(over: Partial<PromptOpportunity> = {}): PromptOpportunity {
  return {
    prompt_id: "p-1",
    category: "winning",
    tags: [],
    signalStrength: 80,
    reasoning: "Primary on Perplexity for 3 of 4 readings.",
    evidence: {
      observationCount: 4,
      primaryCount: 3,
      citedCount: 3,
      mentionedCount: 3,
      absentCount: 1,
      avgCitationRank: 1.2,
      dominantCompetitors: [],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
    ...over,
  };
}

describe("v2 category vocabulary", () => {
  it("maps every legacy enum to a customer-safe kind + label + tone", () => {
    const legacyKeys: PromptOpportunityCategory[] = [
      "winning",
      "close",
      "absent",
      "outranked",
      "early",
    ];
    for (const legacy of legacyKeys) {
      const cat = categoryForLegacy(legacy);
      expect(cat.legacyCategory).toBe(legacy);
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.lead.length).toBeGreaterThan(0);
    }
  });

  it("locked label table — customer-safe names", () => {
    const byKind: Record<PromptsV2CategoryKind, string> = Object.fromEntries(
      PROMPTS_V2_CATEGORY_TABLE.map((c) => [c.kind, c.label]),
    ) as Record<PromptsV2CategoryKind, string>;
    expect(byKind.winning).toBe("Winning");
    expect(byKind.almost_there).toBe("Almost there");
    expect(byKind.missing).toBe("Missing");
    expect(byKind.outranked).toBe("Outranked");
    expect(byKind.still_learning).toBe("Still learning");
  });

  it("display order: Winning → Almost there → Missing → Outranked → Still learning", () => {
    expect(PROMPTS_V2_CATEGORY_ORDER).toEqual([
      "winning",
      "almost_there",
      "missing",
      "outranked",
      "still_learning",
    ]);
  });

  it("never advertises internal vocabulary in labels or leads", () => {
    const banned = [
      "z-score",
      "evidence tier",
      "native observation",
      "decision matrix",
      "resolver tier",
      "primary-rate",
    ];
    for (const cat of PROMPTS_V2_CATEGORY_TABLE) {
      const lower = (cat.label + " " + cat.lead).toLowerCase();
      for (const term of banned) {
        expect(lower, `${cat.kind} leaked '${term}'`).not.toContain(term);
      }
    }
  });

  it("throws on unknown legacy/kind keys (defensive)", () => {
    expect(() => categoryForLegacy("unknown" as never)).toThrow();
    expect(() => categoryForKind("unknown" as never)).toThrow();
  });
});

describe("computePromptsV2Counters", () => {
  it("returns one counter per category, in locked display order, all 0 for empty input", () => {
    const counters = computePromptsV2Counters([]);
    expect(counters.map((c) => c.kind)).toEqual(PROMPTS_V2_CATEGORY_ORDER);
    for (const c of counters) expect(c.count).toBe(0);
  });

  it("counts each legacy category bucket correctly", () => {
    const counters = computePromptsV2Counters([
      { category: "winning" },
      { category: "winning" },
      { category: "close" },
      { category: "absent" },
      { category: "outranked" },
      { category: "outranked" },
      { category: "outranked" },
      { category: "early" },
    ]);
    const byKind = Object.fromEntries(counters.map((c) => [c.kind, c.count]));
    expect(byKind.winning).toBe(2);
    expect(byKind.almost_there).toBe(1);
    expect(byKind.missing).toBe(1);
    expect(byKind.outranked).toBe(3);
    expect(byKind.still_learning).toBe(1);
  });

  it("labels stay customer-safe", () => {
    const counters = computePromptsV2Counters([{ category: "winning" }]);
    expect(counters.find((c) => c.kind === "winning")?.label).toBe("Winning");
    expect(counters.find((c) => c.kind === "almost_there")?.label).toBe(
      "Almost there",
    );
    expect(counters.find((c) => c.kind === "missing")?.label).toBe("Missing");
    expect(counters.find((c) => c.kind === "outranked")?.label).toBe(
      "Outranked",
    );
    expect(counters.find((c) => c.kind === "still_learning")?.label).toBe(
      "Still learning",
    );
  });
});

describe("platformLabel", () => {
  it("returns customer-friendly names for tracked platforms", () => {
    expect(platformLabel("chatgpt")).toBe("ChatGPT");
    expect(platformLabel("perplexity")).toBe("Perplexity");
    expect(platformLabel("google_aio")).toBe("Google AI Overviews");
  });

  it("falls through to the raw key only for unknown platforms", () => {
    expect(platformLabel("future_engine")).toBe("future_engine");
  });
});

describe("projectPlatformBadge", () => {
  it("returns 'primary' when at least one primary observation", () => {
    const b = projectPlatformBadge(plat({ primary: 1, observations: 4 }));
    expect(b.state).toBe("primary");
    expect(b.microcopy).toBe("Recommended first");
  });

  it("returns 'cited' when cited > 0 but no primaries", () => {
    const b = projectPlatformBadge(plat({ cited: 2, observations: 4 }));
    expect(b.state).toBe("cited");
    expect(b.microcopy).toBe("Cited");
  });

  it("returns 'mentioned' when only mentioned > 0", () => {
    const b = projectPlatformBadge(plat({ mentioned: 1, observations: 4 }));
    expect(b.state).toBe("mentioned");
  });

  it("returns 'absent' when nothing positive in the window", () => {
    const b = projectPlatformBadge(plat({ observations: 4 }));
    expect(b.state).toBe("absent");
    expect(b.microcopy).toBe("Not mentioned");
  });

  it("returns 'no_data' for zero observations", () => {
    const b = projectPlatformBadge(plat({ observations: 0 }));
    expect(b.state).toBe("no_data");
    expect(b.microcopy).toBe("No reading yet");
  });
});

describe("projectPromptToCardRow", () => {
  it("emits prompt text + category + reasoning + sorted badges", () => {
    const row = projectPromptToCardRow(
      op({
        prompt_id: "p-1",
        category: "winning",
        reasoning: "Primary on Perplexity for 3 of 4 readings.",
        evidence: {
          observationCount: 4,
          primaryCount: 3,
          citedCount: 3,
          mentionedCount: 3,
          absentCount: 1,
          avgCitationRank: 1.2,
          dominantCompetitors: ["CRC Builders", "Homestead", "Modern Co", "Extra"],
          answerStructureDistribution: {},
          topDescriptors: [],
          byPlatform: [
            plat({ platform: "chatgpt", primary: 0, mentioned: 2, observations: 4 }),
            plat({ platform: "perplexity", primary: 3, observations: 4 }),
          ],
          lookbackDays: 7,
        },
      }),
      "What is the best builder in Atherton?",
    );
    expect(row.promptId).toBe("p-1");
    expect(row.text).toBe("What is the best builder in Atherton?");
    expect(row.category.kind).toBe("winning");
    expect(row.reasoning).toBe("Primary on Perplexity for 3 of 4 readings.");
    // Strongest signal first: perplexity (primary) before chatgpt (mentioned).
    expect(row.platformBadges[0].platform).toBe("perplexity");
    expect(row.platformBadges[0].state).toBe("primary");
    expect(row.platformBadges[1].platform).toBe("chatgpt");
    // Competitors capped at 3.
    expect(row.competitors).toEqual([
      "CRC Builders",
      "Homestead",
      "Modern Co",
    ]);
  });

  it("extracts geo + topic cluster chips from tags", () => {
    const row = projectPromptToCardRow(
      op({
        tags: [
          "geo_cluster:Atherton",
          "topic_cluster:Whole Home Renovation",
          "ranked_list_miss",
        ],
      }),
      "text",
    );
    expect(row.clusterChips).toEqual([
      { kind: "geo", label: "Atherton" },
      { kind: "topic", label: "Whole Home Renovation" },
    ]);
  });

  it("never carries raw enum keys into the customer-facing row", () => {
    const row = projectPromptToCardRow(
      op({
        category: "absent",
        reasoning: "AI never cited you in the last 7 readings.",
      }),
      "test",
    );
    expect(row.category.label).toBe("Missing");
    // Legacy key stays accessible for data-attrs but isn't surfaced as
    // a label.
    expect(row.category.legacyCategory).toBe("absent");
  });
});

describe("projectPromptsToSections", () => {
  it("groups by customer-safe category in locked display order", () => {
    const sections = projectPromptsToSections(
      [
        op({ prompt_id: "p-w", category: "winning" }),
        op({ prompt_id: "p-o", category: "outranked" }),
        op({ prompt_id: "p-a", category: "absent" }),
        op({ prompt_id: "p-c", category: "close" }),
        op({ prompt_id: "p-e", category: "early" }),
      ],
      new Map([
        ["p-w", "Winning prompt"],
        ["p-o", "Outranked prompt"],
        ["p-a", "Missing prompt"],
        ["p-c", "Close prompt"],
        ["p-e", "Early prompt"],
      ]),
    );
    expect(sections.map((s) => s.category.kind)).toEqual([
      "winning",
      "almost_there",
      "missing",
      "outranked",
      "still_learning",
    ]);
    for (const s of sections) {
      expect(s.rows.length, `section=${s.category.kind}`).toBe(1);
    }
  });

  it("sorts each section's rows by signalStrength desc", () => {
    const sections = projectPromptsToSections(
      [
        op({ prompt_id: "weak", category: "winning", signalStrength: 30 }),
        op({ prompt_id: "strong", category: "winning", signalStrength: 95 }),
        op({ prompt_id: "mid", category: "winning", signalStrength: 60 }),
      ],
      new Map([
        ["weak", "weak"],
        ["strong", "strong"],
        ["mid", "mid"],
      ]),
    );
    const winning = sections.find((s) => s.category.kind === "winning")!;
    expect(winning.rows.map((r) => r.promptId)).toEqual([
      "strong",
      "mid",
      "weak",
    ]);
  });

  it("keeps empty sections so the v2 client can render honest 'No prompts in this group right now.' states", () => {
    const sections = projectPromptsToSections([], new Map());
    expect(sections.length).toBe(5);
    for (const s of sections) expect(s.rows.length).toBe(0);
  });

  it("falls back to empty string when textById lacks the prompt id (defensive)", () => {
    const sections = projectPromptsToSections(
      [op({ prompt_id: "missing-text", category: "winning" })],
      new Map(),
    );
    const win = sections.find((s) => s.category.kind === "winning")!;
    expect(win.rows[0].text).toBe("");
  });
});
