import { describe, it, expect } from "vitest";
import { analyzeProfoundAnswers, analyzeProfoundAnswersByPrompt } from "@/domains/recommendation-intelligence/profound-answer-analysis";
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
    topic: p.topic ?? "Persian culture",
    model: p.model ?? "ChatGPT",
    asset: p.asset ?? null,
    createdAt: p.createdAt ?? "2026-06-20",
  };
}

const OWNED = { ownedBrandAliases: ["Iranopedia"], ownedDomain: "iranopedia.com" };

describe("analyzeProfoundAnswers", () => {
  it("flags a topic where competitors are cited but owned is absent", () => {
    const answers = [
      ans({ topic: "Iranian names", citationHostnames: ["reddit.com", "mypersiancorner.com"] }),
      ans({ topic: "Iranian names", citationHostnames: ["mypersiancorner.com"] }),
      ans({ topic: "Iranian names", citationHostnames: ["behindthename.com"] }),
    ];
    const r = analyzeProfoundAnswers({ answers, ...OWNED, directoryDomains: ["reddit.com"] });
    expect(r.gaps.length).toBe(1);
    const g = r.gaps[0]!;
    expect(g.topic).toBe("Iranian names");
    expect(g.ownedCited).toBe(0);
    expect(g.ownedCitationShare).toBe(0);
    // reddit excluded as a directory; mypersiancorner is the top displaceable competitor
    expect(g.competitorDomains[0]!.hostname).toBe("mypersiancorner.com");
    expect(g.competitorDomains.map((c) => c.hostname)).not.toContain("reddit.com");
  });

  it("does NOT flag a topic the owned domain already wins (>=50% cited)", () => {
    const answers = [
      ans({ topic: "Cities", citationHostnames: ["iranopedia.com", "wikipedia.org"] }),
      ans({ topic: "Cities", citationHostnames: ["iranopedia.com"] }),
      ans({ topic: "Cities", citationHostnames: ["wikipedia.org"] }),
    ];
    const r = analyzeProfoundAnswers({ answers, ...OWNED });
    expect(r.gaps.find((g) => g.topic === "Cities")).toBeUndefined();
    expect(r.ownedCitationShare).toBeGreaterThan(0);
  });

  it("counts a subdomain of the owned domain as owned (suffix-aware)", () => {
    const answers = [
      ans({ topic: "Food", citationHostnames: ["blog.iranopedia.com"] }),
      ans({ topic: "Food", citationHostnames: ["www.iranopedia.com"] }),
      ans({ topic: "Food", citationHostnames: ["competitor.com"] }),
    ];
    const r = analyzeProfoundAnswers({ answers, ...OWNED });
    // 2 of 3 owned-cited → wins → not a gap
    expect(r.gaps.find((g) => g.topic === "Food")).toBeUndefined();
  });

  it("brand mention is whole-token + hyphen-aware (Ritz != Ritz-Carlton)", () => {
    const answers = [
      ans({ topic: "Builders", mentions: ["Ritz-Carlton"], citationHostnames: ["x.com"] }),
      ans({ topic: "Builders", mentions: ["Ritz Builders"], citationHostnames: ["y.com"] }),
      ans({ topic: "Builders", mentions: ["someone else"], citationHostnames: ["z.com"] }),
    ];
    const r = analyzeProfoundAnswers({
      answers,
      ownedBrandAliases: ["Ritz Builders"],
      ownedDomain: "ritzbuilders.com",
    });
    const g = r.gaps.find((x) => x.topic === "Builders")!;
    // only the exact "Ritz Builders" mention counts, not "Ritz-Carlton"
    expect(g.ownedMentioned).toBe(1);
  });

  it("respects the minAnswers demand floor", () => {
    const answers = [
      ans({ topic: "Tiny", citationHostnames: ["comp.com"] }),
      ans({ topic: "Tiny", citationHostnames: ["comp.com"] }),
    ];
    const r = analyzeProfoundAnswers({ answers, ...OWNED, minAnswers: 3 });
    expect(r.gaps.find((g) => g.topic === "Tiny")).toBeUndefined();
  });

  it("ranks gaps by gapScore (more demand + stronger competitor first)", () => {
    const big = Array.from({ length: 10 }, () =>
      ans({ topic: "Big", citationHostnames: ["bigcomp.com"] }),
    );
    const small = Array.from({ length: 4 }, () =>
      ans({ topic: "Small", citationHostnames: ["smallcomp.com"] }),
    );
    const r = analyzeProfoundAnswers({ answers: [...small, ...big], ...OWNED });
    expect(r.gaps[0]!.topic).toBe("Big");
    expect(r.gaps[0]!.gapScore).toBeGreaterThan(r.gaps[1]!.gapScore);
  });

  it("empty input → no gaps, zero shares", () => {
    const r = analyzeProfoundAnswers({ answers: [], ...OWNED });
    expect(r.gaps).toEqual([]);
    expect(r.totalAnswers).toBe(0);
    expect(r.ownedCitationShare).toBe(0);
  });
});

describe("analyzeProfoundAnswersByPrompt", () => {
  it("groups answers by prompt id and ranks the cited pages for that prompt", () => {
    const answers = [
      ans({ promptId: "p1", prompt: "best persian cookbooks", model: "ChatGPT", citationHostnames: ["seriouseats.com", "iranopedia.com"], mentions: ["Iranopedia"] }),
      ans({ promptId: "p1", prompt: "best persian cookbooks", model: "Perplexity", citationHostnames: ["seriouseats.com", "reddit.com"] }),
    ];
    const r = analyzeProfoundAnswersByPrompt({ answers, ...OWNED, directoryDomains: ["reddit.com"] });
    expect(r.totalPrompts).toBe(1);
    const p = r.prompts[0]!;
    expect(p.promptId).toBe("p1");
    expect(p.totalAnswers).toBe(2);
    expect(p.models).toEqual(["ChatGPT", "Perplexity"]);
    // present: mentioned once AND cited once
    expect(p.ownPresent).toBe(true);
    expect(p.ownMentioned).toBe(1);
    expect(p.ownCited).toBe(1);
    expect(p.isGap).toBe(false);
    // seriouseats cited in BOTH answers → top; iranopedia flagged as owned; reddit excluded
    expect(p.topCitedPages[0]).toEqual({ hostname: "seriouseats.com", answers: 2, isOwned: false });
    expect(p.topCitedPages.find((c) => c.hostname === "iranopedia.com")?.isOwned).toBe(true);
    expect(p.topCitedPages.map((c) => c.hostname)).not.toContain("reddit.com");
  });

  it("flags a prompt as a GAP when you're absent but a competitor is cited; gaps sort first", () => {
    const answers = [
      // gap prompt: you're never cited/mentioned, competitor is
      ans({ promptId: "gap", prompt: "persian wedding traditions", citationHostnames: ["theknot.com"] }),
      ans({ promptId: "gap", prompt: "persian wedding traditions", model: "Perplexity", citationHostnames: ["theknot.com"] }),
      // present prompt: you're cited
      ans({ promptId: "win", prompt: "what is nowruz", citationHostnames: ["iranopedia.com"] }),
    ];
    const r = analyzeProfoundAnswersByPrompt({ answers, ...OWNED });
    expect(r.totalPrompts).toBe(2);
    expect(r.gapPromptCount).toBe(1);
    expect(r.ownPresentPromptCount).toBe(1);
    // gap (2 answers) sorts before the present prompt
    expect(r.prompts[0]!.promptId).toBe("gap");
    expect(r.prompts[0]!.isGap).toBe(true);
    expect(r.prompts[0]!.topCitedPages[0]!.hostname).toBe("theknot.com");
  });

  it("falls back to grouping by prompt text when promptId is absent", () => {
    const answers = [
      ans({ promptId: null, prompt: "Cities in Iran", citationHostnames: ["wikipedia.org"] }),
      ans({ promptId: null, prompt: "cities in iran", citationHostnames: ["wikipedia.org"] }),
    ];
    const r = analyzeProfoundAnswersByPrompt({ answers, ...OWNED });
    expect(r.totalPrompts).toBe(1); // case-insensitive text grouping
    expect(r.prompts[0]!.totalAnswers).toBe(2);
  });

  it("empty input → no prompts", () => {
    const r = analyzeProfoundAnswersByPrompt({ answers: [], ...OWNED });
    expect(r.prompts).toEqual([]);
    expect(r.totalPrompts).toBe(0);
    expect(r.gapPromptCount).toBe(0);
  });
});
