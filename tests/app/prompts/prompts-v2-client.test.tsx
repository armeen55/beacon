/**
 * /prompts v2A — strategic-surface render contract.
 *
 * Pins the layout marker (`data-prompts-layout="v2-strategic-
 * surface"`), the 5-counter strip, the 5 category sections with
 * customer-safe headings, card anatomy, empty-state copy, and
 * the no-leak invariant against the deepest v2 component
 * surface that touches rendered text.
 *
 * Pure SSR render via `renderToStaticMarkup` — no DOM dep, no
 * @testing-library/react.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptsV2Client } from "@/app/(shell)/prompts/prompts-v2-client";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";

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

function render(
  prompts: ReadonlyArray<PromptOpportunity>,
  textPairs: ReadonlyArray<[string, string]> = [],
): string {
  return renderToStaticMarkup(
    <PromptsV2Client
      prompts={prompts}
      promptTextById={new Map(textPairs)}
    />,
  );
}

describe("PromptsV2Client — strategic surface", () => {
  it("renders the v2 layout marker + customer-safe header", () => {
    const html = render([op()], [["p-1", "Best builder in Atherton?"]]);
    expect(html).toContain('data-prompts-layout="v2-strategic-surface"');
    expect(html).toContain("Prompts");
    expect(html).toContain(
      "See which buyer questions AI answers with or without you",
    );
  });

  it("renders the calm empty state with no internal vocabulary when prompts is empty", () => {
    const html = render([]);
    expect(html).toContain('data-prompts-v2-empty="true"');
    expect(html).toContain("No active prompts yet");
    expect(html).toContain("Beacon is still gathering readings");
    expect(html).toContain('data-prompts-v2-empty-cta="manage"');
    expect(html).toContain('href="/settings/prompts"');
  });

  it("renders ALL 5 category counters with customer-safe labels", () => {
    const html = render(
      [
        op({ prompt_id: "p-a", category: "winning" }),
        op({ prompt_id: "p-b", category: "close" }),
        op({ prompt_id: "p-c", category: "absent" }),
        op({ prompt_id: "p-d", category: "outranked" }),
        op({ prompt_id: "p-e", category: "early" }),
      ],
      [
        ["p-a", "win"],
        ["p-b", "close"],
        ["p-c", "absent"],
        ["p-d", "outranked"],
        ["p-e", "early"],
      ],
    );
    expect(html).toContain('data-prompts-v2-counters="true"');
    expect(html).toContain('data-prompts-v2-counter="winning"');
    expect(html).toContain('data-prompts-v2-counter="almost_there"');
    expect(html).toContain('data-prompts-v2-counter="missing"');
    expect(html).toContain('data-prompts-v2-counter="outranked"');
    expect(html).toContain('data-prompts-v2-counter="still_learning"');
    // Customer-safe labels in the strip.
    expect(html).toContain("Winning");
    expect(html).toContain("Almost there");
    expect(html).toContain("Missing");
    expect(html).toContain("Outranked");
    expect(html).toContain("Still learning");
  });

  it("renders 5 category sections in locked display order with section headings", () => {
    const html = render([op()], [["p-1", "test"]]);
    for (const kind of [
      "winning",
      "almost_there",
      "missing",
      "outranked",
      "still_learning",
    ]) {
      expect(html, `section ${kind}`).toContain(
        `data-prompts-v2-section="${kind}"`,
      );
      expect(html, `section heading ${kind}`).toContain(
        `data-prompts-v2-section-heading="${kind}"`,
      );
    }
  });

  it("empty sections render the customer-safe 'No prompts in this group right now.' message", () => {
    // Only one winning prompt — every other section is empty.
    const html = render([op()], [["p-1", "test"]]);
    const emptyMarkers = html.match(/data-prompts-v2-section-empty="true"/g) ?? [];
    // 4 of the 5 sections empty.
    expect(emptyMarkers.length).toBe(4);
    expect(html).toContain("No prompts in this group right now");
  });

  it("renders prompt cards with customer-safe pill + reasoning + view-details CTA", () => {
    const html = render(
      [
        op({
          prompt_id: "p-w",
          category: "winning",
          reasoning: "Primary on Perplexity for 3 of 4 readings.",
        }),
      ],
      [["p-w", "What is the best teardown builder in Atherton?"]],
    );
    expect(html).toContain('data-prompts-v2-card="strategic-prompt"');
    expect(html).toContain('data-prompts-v2-card-id="p-w"');
    expect(html).toContain('data-prompts-v2-card-category="winning"');
    expect(html).toContain('data-prompts-v2-card-pill="winning"');
    expect(html).toContain("Winning");
    expect(html).toContain("What is the best teardown builder in Atherton?");
    expect(html).toContain('data-prompts-v2-card-reasoning="true"');
    // CTA is a button-shaped affordance, not bare link text.
    expect(html).toContain('data-prompts-v2-card-cta="view-details"');
    expect(html).toContain('href="/prompts/p-w?v2=1"');
    expect(html).toContain("View details");
  });

  it("renders per-platform badges with branded labels + state microcopy", () => {
    const html = render(
      [
        op({
          prompt_id: "p-pl",
          category: "winning",
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
            byPlatform: [
              {
                platform: "chatgpt",
                observations: 4,
                primary: 0,
                cited: 0,
                mentioned: 2,
                absent: 2,
                avgCitationRank: null,
              },
              {
                platform: "perplexity",
                observations: 4,
                primary: 3,
                cited: 3,
                mentioned: 3,
                absent: 1,
                avgCitationRank: 1.2,
              },
            ],
            lookbackDays: 7,
          },
        }),
      ],
      [["p-pl", "test"]],
    );
    expect(html).toContain('data-prompts-v2-card-platforms="true"');
    expect(html).toContain('data-prompts-v2-platform="chatgpt"');
    expect(html).toContain('data-prompts-v2-platform="perplexity"');
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Perplexity");
    expect(html).toContain("Recommended first");
    expect(html).toContain("Mentioned");
    expect(html).toContain('data-prompts-v2-platform-state="primary"');
    expect(html).toContain('data-prompts-v2-platform-state="mentioned"');
  });

  it("renders competitor + cluster chips when present", () => {
    const html = render(
      [
        op({
          prompt_id: "p-c",
          category: "outranked",
          tags: ["geo_cluster:Bay Area", "topic_cluster:Whole Home"],
          evidence: {
            observationCount: 3,
            primaryCount: 0,
            citedCount: 0,
            mentionedCount: 0,
            absentCount: 3,
            avgCitationRank: null,
            dominantCompetitors: ["CRC Builders", "Homestead"],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [],
            lookbackDays: 7,
          },
        }),
      ],
      [["p-c", "Best builder in the Bay Area?"]],
    );
    expect(html).toContain('data-prompts-v2-card-competitors="true"');
    expect(html).toContain("CRC Builders");
    expect(html).toContain("Homestead");
    expect(html).toContain('data-prompts-v2-card-cluster="geo"');
    expect(html).toContain('data-prompts-v2-card-cluster="topic"');
    expect(html).toContain("Bay Area");
    expect(html).toContain("Whole Home");
  });

  it("no longer renders the 'Open legacy view' customer-facing footer CTA (removed 2026-05-12)", () => {
    // Pre-cleanup: the v2 strategic surface carried a "Need the
    // operator view? Open legacy view →" footer link. Removed as
    // part of the perf/legacy-bloat audit because v2 is the
    // production default and the visible CTA made the product
    // feel unfinished. The `?legacy=1` query param still routes
    // to the legacy decision view for rollback.
    const html = render([op()], [["p-1", "t"]]);
    expect(html).not.toContain('data-prompts-v2-cta="legacy"');
    expect(html).not.toContain("Open legacy view");
  });

  it("never leaks internal vocabulary in the rendered output", () => {
    const html = render(
      [
        op({
          prompt_id: "p-l",
          category: "outranked",
          reasoning: "Competitors dominate this prompt across 6 readings.",
          tags: ["geo_cluster:Atherton", "topic_cluster:Modern Build"],
          evidence: {
            observationCount: 6,
            primaryCount: 0,
            citedCount: 0,
            mentionedCount: 0,
            absentCount: 6,
            avgCitationRank: null,
            dominantCompetitors: ["CRC Builders"],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [
              {
                platform: "chatgpt",
                observations: 6,
                primary: 0,
                cited: 0,
                mentioned: 0,
                absent: 6,
                avgCitationRank: null,
              },
            ],
            lookbackDays: 7,
          },
        }),
      ],
      [["p-l", "Best modern builder near Atherton?"]],
    );
    const lower = html.toLowerCase();
    const banned = [
      "z-score",
      "evidence tier",
      "evidence_tier",
      "evidence_hash",
      "resolver tier",
      "resolver_tier",
      "lifecycle",
      "decision matrix",
      "decision queue",
      "pattern brain",
      "candidate cause",
      "native observation",
      "stablekey",
      "prompt_answer_observations",
    ];
    for (const term of banned) {
      expect(lower, `rendered HTML leaked '${term}'`).not.toContain(term);
    }
    // Also pin no raw prompt UUIDs slipped into the card heading.
    expect(lower).not.toMatch(/\bprompt\s+[0-9a-f]{6,}\b/);
  });
});
