import { describe, it, expect } from "vitest";
import { buildPromptOpportunities, type FanoutRow } from "@/domains/profound-question-intelligence/prompt-opportunity";
import type { ProfoundAnswerRow } from "@/lib/connectors/profound/client";

function ans(p: Partial<ProfoundAnswerRow>): ProfoundAnswerRow {
  return {
    promptId: p.promptId ?? null,
    prompt: p.prompt ?? "q",
    response: p.response ?? "",
    mentions: p.mentions ?? [],
    citationUrls: p.citationUrls ?? [],
    citationHostnames: p.citationHostnames ?? [],
    themes: p.themes ?? [],
    topic: p.topic ?? "Iranopedia",
    model: p.model ?? "ChatGPT",
    asset: p.asset ?? null,
    createdAt: p.createdAt ?? "2026-06-20",
  };
}
const OWNED = { ownedDomain: "iranopedia.com", ownedMentionAliases: ["Iranopedia", "iranopedia.com"] };

describe("buildPromptOpportunities", () => {
  it("absent + competitor cited → answer_block gap with ranked top cited PAGES", () => {
    const answers = [
      ans({ prompt: "What is taarof?", model: "ChatGPT", citationUrls: ["https://mei.edu/taarof", "https://www.tappersia.com/taarof"] }),
      ans({ prompt: "What is taarof?", model: "Perplexity", citationUrls: ["https://mei.edu/taarof", "https://reddit.com/r/iran"] }),
    ];
    const r = buildPromptOpportunities({ answers, ...OWNED, directoryDomains: ["reddit.com"] });
    expect(r).toHaveLength(1);
    const o = r[0]!;
    expect(o.recommendedMove).toBe("answer_block");
    expect(o.ownCitationCount).toBe(0);
    expect(o.citationGap).toBe(1);
    expect(o.executions).toBe(2);
    expect(o.models).toEqual(["ChatGPT", "Perplexity"]);
    // top cited page = mei.edu/taarof (cited in both answers); reddit excluded
    expect(o.topCitedPages[0]).toMatchObject({ url: "https://mei.edu/taarof", answers: 2, isOwned: false });
    expect(o.topCitedPages.map((p) => p.hostname)).not.toContain("reddit.com");
    expect(o.topCompetitorDomains[0]!.hostname).toBe("mei.edu");
  });

  it("own domain cited → expand_page (not a gap)", () => {
    const answers = [
      ans({ prompt: "cities in Iran", citationUrls: ["https://www.iranopedia.com/cities", "https://wikipedia.org/x"], mentions: ["Iranopedia"] }),
    ];
    const r = buildPromptOpportunities({ answers, ...OWNED });
    const o = r[0]!;
    expect(o.recommendedMove).toBe("expand_page");
    expect(o.ownCitationCount).toBe(1);
    expect(o.ownMentionCount).toBe(1);
    expect(o.ownCitedUrls).toContain("https://www.iranopedia.com/cities");
    expect(o.topCitedPages.find((p) => p.isOwned)?.url).toBe("https://www.iranopedia.com/cities");
  });

  it("AI answers but cites nobody → source_gap", () => {
    const answers = [ans({ prompt: "popular Persian kebab varieties", citationUrls: [] })];
    const r = buildPromptOpportunities({ answers, ...OWNED });
    expect(r[0]!.recommendedMove).toBe("source_gap");
  });

  it("attaches fan-out queries by prompt + scores attention", () => {
    const answers = [ans({ prompt: "learn Persian phrases", citationUrls: ["https://fexingo.com/x"] })];
    const fanouts: FanoutRow[] = [
      { prompt: "learn Persian phrases", query: "basic persian greetings", model: "ChatGPT" },
      { prompt: "learn Persian phrases", query: "farsi hello phrases", model: "ChatGPT" },
    ];
    const r = buildPromptOpportunities({ answers, fanouts, ...OWNED });
    expect(r[0]!.fanoutQueries.sort()).toEqual(["basic persian greetings", "farsi hello phrases"]);
    expect(r[0]!.promptAttentionScore).toBeGreaterThan(1);
  });

  it("filters noise prompts via isNoisePrompt", () => {
    const answers = [
      ans({ prompt: "Evaluate the Frontier Models company ChatGPT on Iranopedia", citationUrls: ["https://x.com/y"] }),
      ans({ prompt: "real persian question", citationUrls: ["https://comp.com/y"] }),
    ];
    const r = buildPromptOpportunities({ answers, ...OWNED, isNoisePrompt: (p) => /^Evaluate the Frontier Models/i.test(p) });
    expect(r).toHaveLength(1);
    expect(r[0]!.prompt).toBe("real persian question");
  });

  it("empty answers → no opportunities", () => {
    expect(buildPromptOpportunities({ answers: [], ...OWNED })).toEqual([]);
  });
});
