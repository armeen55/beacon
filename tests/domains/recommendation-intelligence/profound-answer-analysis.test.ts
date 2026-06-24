import { describe, it, expect } from "vitest";
import { analyzeProfoundAnswers } from "@/domains/recommendation-intelligence/profound-answer-analysis";
import type { ProfoundAnswerRow } from "@/lib/connectors/profound/client";

function ans(p: Partial<ProfoundAnswerRow>): ProfoundAnswerRow {
  return {
    promptId: null,
    prompt: p.prompt ?? "q",
    response: p.response ?? "",
    mentions: p.mentions ?? [],
    citationHostnames: p.citationHostnames ?? [],
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
