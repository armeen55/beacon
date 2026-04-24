import { describe, it, expect } from "vitest";

import {
  summarizePromptPrimary,
  summarizeAllPromptsPrimary,
} from "@/domains/prompts/competitor-primary";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const OWNED = new Set<string>(["Ritz Builders"]);

function mkObs(overrides: Partial<PromptAnswerObservation> & {
  id: string;
  prompt_id: string;
  observed_at: string;
}): PromptAnswerObservation {
  return {
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

describe("summarizePromptPrimary", () => {
  it("Ritz primary on majority of answers → ritzState=primary", () => {
    const observations = [0, 1, 2].map((i) =>
      mkObs({
        id: `o${i}`,
        prompt_id: "p1",
        observed_at: `2026-04-23T10:0${i}:00Z`,
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
    ).concat(
      mkObs({
        id: "o3",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:03:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
    );
    const s = summarizePromptPrimary({
      prompt_id: "p1",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.totalAnswers).toBe(4);
    expect(s.ritzPrimaryCount).toBe(3);
    expect(s.ritzPrimaryShare).toBe(0.75);
    expect(s.ritzState).toBe("primary");
    expect(s.primaryCompetitors).toEqual([
      { name: "CRC Builders", primaryCount: 1, totalAnswers: 4 },
    ]);
    expect(s.fragmented).toBe(false);
  });

  it("Ritz cited but never primary, one competitor dominates → ritzState=cited, not fragmented", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        competitor_co_mentions: ["Bay Builders", "CRC Builders"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        competitor_co_mentions: ["Bay Builders"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:02:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        competitor_co_mentions: ["Bay Builders", "Homestead"],
      }),
      mkObs({
        id: "o4",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:03:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p2",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.ritzPrimaryCount).toBe(0);
    expect(s.ritzState).toBe("cited");
    expect(s.primaryCompetitors[0]).toEqual({
      name: "Bay Builders",
      primaryCount: 3,
      totalAnswers: 4,
    });
    expect(s.fragmented).toBe(false);
  });

  it("Ritz 2/5, CompA 2/5, CompB 1/5 → fragmented=true, ritzState=cited", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p3b",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
      mkObs({
        id: "o2",
        prompt_id: "p3b",
        observed_at: "2026-04-23T10:01:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3b",
        observed_at: "2026-04-23T10:02:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["CompA"],
      }),
      mkObs({
        id: "o4",
        prompt_id: "p3b",
        observed_at: "2026-04-23T10:03:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["CompA"],
      }),
      mkObs({
        id: "o5",
        prompt_id: "p3b",
        observed_at: "2026-04-23T10:04:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["CompB"],
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p3b",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.ritzPrimaryCount).toBe(2);
    expect(s.ritzPrimaryShare).toBe(0.4);
    expect(s.ritzState).toBe("cited"); // Ritz mentioned but not majority
    expect(s.primaryCompetitors).toEqual([
      { name: "CompA", primaryCount: 2, totalAnswers: 5 },
      { name: "CompB", primaryCount: 1, totalAnswers: 5 },
    ]);
    expect(s.fragmented).toBe(true);
  });

  it("Ritz absent, no competitors → ritzState=absent, no primaryCompetitors, not fragmented", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p4",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: [],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p4",
        observed_at: "2026-04-23T10:01:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p4",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.ritzState).toBe("absent");
    expect(s.primaryCompetitors).toEqual([]);
    expect(s.fragmented).toBe(false);
  });

  it("single observation with Ritz primary → primary, no fragmentation", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p5",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p5",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.totalAnswers).toBe(1);
    expect(s.ritzState).toBe("primary");
    expect(s.fragmented).toBe(false);
  });

  it("pre-pivot Profound observations filtered out by NATIVE_REGIME_START", () => {
    const observations = [
      mkObs({
        id: "o-old",
        prompt_id: "p6",
        observed_at: "2026-04-15T10:00:00Z", // before Apr-22 native regime
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
      mkObs({
        id: "o-old2",
        prompt_id: "p6",
        observed_at: "2026-04-21T23:59:59Z", // boundary — still pre-regime
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p6",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.totalAnswers).toBe(0);
    expect(s.ritzState).toBe("absent");
  });

  it("competitor_co_mentions containing owned brand name is skipped", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p7",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: false,
        // Ritz appears first, but it's owned — should be skipped for
        // "first competitor" lookup; CRC wins the primary-position proxy.
        competitor_co_mentions: ["Ritz Builders", "CRC Builders"],
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p7",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.primaryCompetitors).toEqual([
      { name: "CRC Builders", primaryCount: 1, totalAnswers: 1 },
    ]);
  });

  it("ties in competitor primaryCount break by name for stable ordering", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p8",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["Zulu Builders"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p8",
        observed_at: "2026-04-23T10:01:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["Alpha Builders"],
      }),
    ];
    const s = summarizePromptPrimary({
      prompt_id: "p8",
      observations,
      ownedEntityNames: OWNED,
    });
    expect(s.primaryCompetitors.map((c) => c.name)).toEqual([
      "Alpha Builders",
      "Zulu Builders",
    ]);
  });
});

describe("summarizeAllPromptsPrimary", () => {
  it("returns a Map keyed by prompt_id with per-prompt summaries", () => {
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p1",
        observed_at: "2026-04-23T10:00:00Z",
        tracked_brand_mentioned: true,
        primary_recommendation: true,
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        observed_at: "2026-04-23T10:01:00Z",
        tracked_brand_mentioned: false,
        primary_recommendation: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
    ];
    const m = summarizeAllPromptsPrimary({
      promptIds: ["p1", "p2", "p3"],
      observations,
      ownedEntityNames: OWNED,
    });
    expect(m.get("p1")?.ritzState).toBe("primary");
    expect(m.get("p2")?.ritzState).toBe("absent");
    expect(m.get("p2")?.primaryCompetitors).toEqual([
      { name: "CRC Builders", primaryCount: 1, totalAnswers: 1 },
    ]);
    // p3 has no obs — resolves cleanly to absent with 0 totals.
    expect(m.get("p3")?.totalAnswers).toBe(0);
    expect(m.get("p3")?.ritzState).toBe("absent");
  });
});
