/**
 * /prompts/[id] v2B — pure brief-projection truth-table tests.
 *
 * Pins the drilldown → 5-act prop projector:
 *
 *   • header.summary strips "Likely action:" suffix.
 *   • whyItMatters reads from topic + location, never from raw enums.
 *   • platforms sorted strongest-first; per-platform detail copy.
 *   • Sparkline only emits when ≥ 2 distinct days exist.
 *   • competitors trimmed to a cap.
 *   • recentMovement detects transitions from rawSamples.
 *   • nextActions branch on (category, hasLinkedRecommendation).
 *   • includeLegacyEscape appends "Open full record" before
 *     "Back to prompts".
 *   • Output never leaks internal vocabulary.
 */
import { describe, expect, it } from "vitest";

import { projectPromptDrilldownToBrief } from "@/domains/prompts/v2-brief-projection";
import type {
  PromptDrilldown,
  PromptCompetitorRow,
  PromptRawAnswerSample,
} from "@/domains/prompts/prompt-drilldown";
import type {
  PromptOpportunity,
  PromptOpportunityCategory,
} from "@/domains/prompts/opportunity-classify";

function classification(
  over: Partial<PromptOpportunity> & {
    category?: PromptOpportunityCategory;
  } = {},
): PromptOpportunity {
  return {
    prompt_id: "p-1",
    category: over.category ?? "winning",
    tags: [],
    signalStrength: 80,
    reasoning: over.reasoning ?? "Primary on Perplexity for 3 of 4 readings.",
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

function drilldown(
  over: Partial<PromptDrilldown> = {},
): PromptDrilldown {
  const cls = over.classification ?? classification();
  return {
    promptId: "p-1",
    promptText: "What is the best builder in Atherton?",
    topicId: null,
    locationScope: null,
    category: cls.category,
    decisionSentence: `${cls.reasoning} Likely action: ship something.`,
    classification: cls,
    competitors: [],
    descriptorsNearBrand: [],
    dominantAnswerStructure: null,
    primarySummary: {
      totalAnswers: 0,
      ritzState: "absent",
      ritzPrimaryCount: 0,
      ritzPrimaryShare: 0,
      fragmented: false,
      primaryCompetitors: [],
    } as PromptDrilldown["primarySummary"],
    rawSamples: [],
    ...over,
  };
}

function sample(
  over: Partial<PromptRawAnswerSample> = {},
): PromptRawAnswerSample {
  return {
    observationId: "obs-1",
    observedAt: "2026-05-04T00:00:00Z",
    platform: "perplexity",
    ritzState: "primary",
    citationRank: 1,
    answerTextHead: null,
    answerTextFull: null,
    ...over,
  };
}

describe("projectPromptDrilldownToBrief — header", () => {
  it("strips 'Likely action:' suffix from the summary", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        decisionSentence:
          "AI cites you on 3 of 4 readings. Likely action: replicate this pattern on 2 more cities.",
      }),
      promptRouteId: "p-1",
    });
    expect(out.header.summary).toBe("AI cites you on 3 of 4 readings.");
    expect(out.header.summary).not.toContain("Likely action");
  });

  it("strips 'Keep monitoring.' suffix for winning prompts too", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        decisionSentence: "You're primary on Perplexity. Keep monitoring.",
      }),
      promptRouteId: "p-1",
    });
    expect(out.header.summary).toBe("You're primary on Perplexity.");
  });

  it("strips 'Check back…' suffix for early prompts", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "early" }),
        decisionSentence:
          "Not enough readings yet. Check back once more AI readings accumulate.",
      }),
      promptRouteId: "p-1",
    });
    expect(out.header.summary).toBe("Not enough readings yet.");
  });

  it("maps legacy enum → customer-safe category in the header", () => {
    const cases: Array<[PromptOpportunityCategory, string, string]> = [
      ["winning", "winning", "Winning"],
      ["close", "almost_there", "Almost there"],
      ["absent", "missing", "Missing"],
      ["outranked", "outranked", "Outranked"],
      ["early", "still_learning", "Still learning"],
    ];
    for (const [legacy, kind, label] of cases) {
      const out = projectPromptDrilldownToBrief({
        drilldown: drilldown({
          classification: classification({ category: legacy }),
        }),
        promptRouteId: "p-1",
      });
      expect(out.header.category.kind).toBe(kind);
      expect(out.header.category.label).toBe(label);
    }
  });
});

describe("projectPromptDrilldownToBrief — whyItMatters", () => {
  it("returns null when topic + location both absent", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({ topicId: null, locationScope: null }),
      promptRouteId: "p-1",
    });
    expect(out.whyItMatters).toBeNull();
  });

  it("renders 'Buyers in <loc> ask AI this kind of question about <topic>' when both present", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        topicId: "Whole Home Renovation",
        locationScope: "Bay Area",
      }),
      promptRouteId: "p-1",
    });
    expect(out.whyItMatters).toBe(
      "Buyers in Bay Area ask AI this kind of question about Whole Home Renovation.",
    );
  });

  it("renders topic-only sentence when location is missing", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({ topicId: "Modern Build", locationScope: null }),
      promptRouteId: "p-1",
    });
    expect(out.whyItMatters).toBe(
      "Buyers ask AI this kind of question about Modern Build.",
    );
  });
});

describe("projectPromptDrilldownToBrief — platforms", () => {
  it("sorts platforms strongest-first (primary > cited > mentioned > absent > no_data)", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({
          evidence: {
            observationCount: 6,
            primaryCount: 3,
            citedCount: 1,
            mentionedCount: 1,
            absentCount: 1,
            avgCitationRank: null,
            dominantCompetitors: [],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [
              { platform: "chatgpt", observations: 3, primary: 0, cited: 1, mentioned: 0, absent: 2, avgCitationRank: null },
              { platform: "perplexity", observations: 3, primary: 3, cited: 0, mentioned: 0, absent: 0, avgCitationRank: null },
              { platform: "google_aio", observations: 0, primary: 0, cited: 0, mentioned: 0, absent: 0, avgCitationRank: null },
            ],
            lookbackDays: 7,
          },
        }),
      }),
      promptRouteId: "p-1",
    });
    expect(out.platforms.map((p) => p.platform)).toEqual([
      "perplexity",
      "chatgpt",
      "google_aio",
    ]);
    expect(out.platforms[0].state).toBe("primary");
    expect(out.platforms[1].state).toBe("cited");
    expect(out.platforms[2].state).toBe("no_data");
    expect(out.platforms[0].label).toBe("Perplexity");
    expect(out.platforms[2].label).toBe("Google AI Overviews");
  });

  it("formats honest detail copy per state", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({
          evidence: {
            observationCount: 4,
            primaryCount: 3,
            citedCount: 3,
            mentionedCount: 3,
            absentCount: 1,
            avgCitationRank: null,
            dominantCompetitors: [],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [
              { platform: "perplexity", observations: 4, primary: 3, cited: 0, mentioned: 0, absent: 1, avgCitationRank: null },
            ],
            lookbackDays: 7,
          },
        }),
      }),
      promptRouteId: "p-1",
    });
    expect(out.platforms[0].detail).toBe(
      "Recommended first in 3 of 4 readings.",
    );
  });

  it("emits a sparkline only when 2+ distinct days exist in rawSamples for that platform", () => {
    const samples = [
      sample({ observedAt: "2026-05-01T10:00:00Z", platform: "perplexity" }),
      sample({ observedAt: "2026-05-02T10:00:00Z", platform: "perplexity" }),
      sample({ observedAt: "2026-05-03T10:00:00Z", platform: "perplexity" }),
      // ChatGPT has only 1 day worth of samples → no sparkline.
      sample({ observedAt: "2026-05-04T10:00:00Z", platform: "chatgpt" }),
    ];
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({
          evidence: {
            observationCount: 4,
            primaryCount: 0,
            citedCount: 0,
            mentionedCount: 0,
            absentCount: 4,
            avgCitationRank: null,
            dominantCompetitors: [],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [
              { platform: "perplexity", observations: 3, primary: 0, cited: 0, mentioned: 0, absent: 3, avgCitationRank: null },
              { platform: "chatgpt", observations: 1, primary: 0, cited: 0, mentioned: 0, absent: 1, avgCitationRank: null },
            ],
            lookbackDays: 7,
          },
        }),
        rawSamples: samples,
      }),
      promptRouteId: "p-1",
    });
    const perplexity = out.platforms.find((p) => p.platform === "perplexity");
    const chatgpt = out.platforms.find((p) => p.platform === "chatgpt");
    expect(perplexity?.sparkline?.length).toBe(3);
    expect(chatgpt?.sparkline).toBeNull();
  });
});

describe("projectPromptDrilldownToBrief — competitors", () => {
  it("caps competitors at 5 by default", () => {
    const many: PromptCompetitorRow[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Competitor ${i + 1}`,
      appearances: 6 - (i % 4),
      totalObservations: 6,
    }));
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({ competitors: many }),
      promptRouteId: "p-1",
    });
    expect(out.competitors.length).toBe(5);
    expect(out.competitors[0].name).toBe("Competitor 1");
  });

  it("formats the summary as 'Cited in N of M readings.'", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        competitors: [
          { name: "CRC Builders", appearances: 3, totalObservations: 4 },
        ],
      }),
      promptRouteId: "p-1",
    });
    expect(out.competitors[0].summary).toBe("Cited in 3 of 4 readings.");
  });

  it("returns an empty list when no competitors", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({ competitors: [] }),
      promptRouteId: "p-1",
    });
    expect(out.competitors).toEqual([]);
  });
});

describe("projectPromptDrilldownToBrief — recentMovement", () => {
  it("returns [] when rawSamples is empty", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({ rawSamples: [] }),
      promptRouteId: "p-1",
    });
    expect(out.recentMovement).toEqual([]);
  });

  it("detects 'first_cited' when the very first sample is a hit", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        rawSamples: [
          sample({
            observedAt: "2026-05-04T00:00:00Z",
            platform: "perplexity",
            ritzState: "cited",
          }),
        ],
      }),
      promptRouteId: "p-1",
    });
    expect(out.recentMovement[0].kind).toBe("first_cited");
    expect(out.recentMovement[0].tone).toBe("success");
    expect(out.recentMovement[0].summary).toContain("Perplexity");
  });

  it("detects 'came_back' when state transitions absent → primary/cited", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        rawSamples: [
          sample({
            observedAt: "2026-05-01T00:00:00Z",
            platform: "perplexity",
            ritzState: "absent",
          }),
          sample({
            observedAt: "2026-05-04T00:00:00Z",
            platform: "perplexity",
            ritzState: "cited",
          }),
        ],
      }),
      promptRouteId: "p-1",
    });
    expect(out.recentMovement.some((m) => m.kind === "came_back")).toBe(true);
  });

  it("detects 'dropped' when state transitions cited → absent", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        rawSamples: [
          sample({
            observedAt: "2026-05-01T00:00:00Z",
            platform: "chatgpt",
            ritzState: "primary",
          }),
          sample({
            observedAt: "2026-05-04T00:00:00Z",
            platform: "chatgpt",
            ritzState: "absent",
          }),
        ],
      }),
      promptRouteId: "p-1",
    });
    const dropped = out.recentMovement.find((m) => m.kind === "dropped");
    expect(dropped).toBeDefined();
    expect(dropped?.tone).toBe("danger");
    expect(dropped?.summary).toContain("ChatGPT");
  });

  it("caps recentMovement at 3 newest-first", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        rawSamples: [
          // 4 first-cited events across 4 platforms — should cap at 3.
          sample({ observedAt: "2026-05-01T00:00:00Z", platform: "perplexity", ritzState: "cited" }),
          sample({ observedAt: "2026-05-02T00:00:00Z", platform: "chatgpt", ritzState: "cited" }),
          sample({ observedAt: "2026-05-03T00:00:00Z", platform: "google_aio", ritzState: "cited" }),
          sample({ observedAt: "2026-05-04T00:00:00Z", platform: "future_engine", ritzState: "cited" }),
        ],
      }),
      promptRouteId: "p-1",
    });
    expect(out.recentMovement.length).toBe(3);
    // Newest date first.
    expect(out.recentMovement[0].date).toBe("2026-05-04");
  });
});

describe("projectPromptDrilldownToBrief — nextActions", () => {
  it("missing/outranked/almost_there + no linked rec → primary 'See related recommendations'", () => {
    for (const cat of ["absent", "outranked", "close"] as PromptOpportunityCategory[]) {
      const out = projectPromptDrilldownToBrief({
        drilldown: drilldown({
          classification: classification({ category: cat }),
        }),
        promptRouteId: "p-1",
      });
      expect(out.nextActions[0].kind).toBe("open_recommendations_queue");
      expect(out.nextActions[0].emphasis).toBe("primary");
      expect(out.nextActions[0].href).toBe("/recommendations?v2=1");
    }
  });

  it("winning → primary 'Keep monitoring'", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "winning" }),
      }),
      promptRouteId: "p-1",
    });
    expect(out.nextActions[0].kind).toBe("keep_monitoring");
    expect(out.nextActions[0].emphasis).toBe("primary");
  });

  it("still_learning → primary 'Back to prompts' (calm default)", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "early" }),
      }),
      promptRouteId: "p-1",
    });
    expect(out.nextActions[0].kind).toBe("back_to_prompts");
    expect(out.nextActions[0].emphasis).toBe("primary");
  });

  it("hasLinkedRecommendation=true overrides → primary 'Open recommendation'", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "absent" }),
      }),
      promptRouteId: "p-1",
      hasLinkedRecommendation: true,
    });
    expect(out.nextActions[0].kind).toBe("open_recommendation");
    expect(out.nextActions[0].emphasis).toBe("primary");
  });

  it("includeLegacyEscape appends 'Open full record' → ?legacy=1 with encoded promptRouteId", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "winning" }),
      }),
      promptRouteId: "ns%3Aslug%5Bnew%5D",
      includeLegacyEscape: true,
    });
    const legacy = out.nextActions.find((c) => c.kind === "open_legacy_detail");
    expect(legacy).toBeDefined();
    expect(legacy?.emphasis).toBe("secondary");
    expect(legacy?.href).toBe("/prompts/ns%3Aslug%5Bnew%5D?legacy=1");
  });

  it("always closes with 'Back to prompts' as the last CTA (unless promoted to primary)", () => {
    const out = projectPromptDrilldownToBrief({
      drilldown: drilldown({
        classification: classification({ category: "winning" }),
      }),
      promptRouteId: "p-1",
      includeLegacyEscape: true,
    });
    expect(out.nextActions[out.nextActions.length - 1].kind).toBe(
      "back_to_prompts",
    );
  });

  it("returns exactly ONE primary CTA per projection", () => {
    for (const cat of [
      "winning",
      "close",
      "absent",
      "outranked",
      "early",
    ] as PromptOpportunityCategory[]) {
      for (const hasRec of [false, true]) {
        const out = projectPromptDrilldownToBrief({
          drilldown: drilldown({
            classification: classification({ category: cat }),
          }),
          promptRouteId: "p-1",
          hasLinkedRecommendation: hasRec,
          includeLegacyEscape: true,
        });
        const primaries = out.nextActions.filter(
          (c) => c.emphasis === "primary",
        );
        expect(primaries.length, `${cat}/${hasRec}`).toBe(1);
      }
    }
  });

  it("never leaks internal vocabulary in CTA labels or hrefs", () => {
    const banned = [
      "z-score",
      "evidence tier",
      "decision matrix",
      "decision queue",
      "pattern brain",
      "resolver tier",
      "native observation",
    ];
    for (const cat of [
      "winning",
      "close",
      "absent",
      "outranked",
      "early",
    ] as PromptOpportunityCategory[]) {
      const out = projectPromptDrilldownToBrief({
        drilldown: drilldown({
          classification: classification({ category: cat }),
        }),
        promptRouteId: "p-1",
        hasLinkedRecommendation: true,
        includeLegacyEscape: true,
      });
      for (const cta of out.nextActions) {
        const lower = `${cta.label} ${cta.href}`.toLowerCase();
        for (const term of banned) {
          expect(lower, `${cat}: '${term}'`).not.toContain(term);
        }
      }
    }
  });
});
