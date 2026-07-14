import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { CompetitorRivals } from "@/domains/competitors/load-competitor-intel";

/**
 * competitor-rivals-section (FP10b, 2026-07-02) - render contract for the
 * section that folds /competitors' real intelligence into /prompts: "Who AI
 * recommends instead of you". Covers the populated case (real domain rows +
 * a steal-this move link), the self-hiding zero-rows case (no empty chrome
 * when the loader has nothing), the self-hiding failure case, and the
 * deadline guard (a hung loader can never stall /prompts).
 */

const EMPTY_RIVALS: CompetitorRivals = { domains: [], actionPacks: [] };

function rivalsWithDomains(): CompetitorRivals {
  return {
    domains: [
      {
        domain: "supplehomes.com",
        citationCount: 12,
        promptCount: 4,
        actionPackCount: 1,
        topPrompts: ["Who builds custom homes in Atherton?", "Best whole-home renovation builder?"],
        topPages: ["https://supplehomes.com/atherton-custom-homes"],
      },
      {
        domain: "rivalbuilder.com",
        citationCount: 3,
        promptCount: 1,
        actionPackCount: 0,
        topPrompts: ["Who renovates luxury homes end-to-end?"],
        topPages: [],
      },
    ],
    actionPacks: [
      {
        actionPackId: "ap-1",
        title: "Create page: Atherton Custom Homes",
        targetUrl: null,
        action: "create_hub",
        competitorPagesToBeat: ["https://supplehomes.com/atherton-custom-homes"],
        evidenceSources: ["profound"],
      },
    ],
  };
}

const { loadCompetitorRivalsMock } = vi.hoisted(() => ({ loadCompetitorRivalsMock: vi.fn() }));
vi.mock("@/domains/competitors/load-competitor-intel", () => ({
  loadCompetitorRivals: loadCompetitorRivalsMock,
}));

describe("CompetitorRivalsSection", () => {
  it("self-hides (renders nothing) when there are no cited rival domains", async () => {
    loadCompetitorRivalsMock.mockResolvedValueOnce(EMPTY_RIVALS);
    const { CompetitorRivalsSection } = await import("./competitor-rivals-section");
    const el = await CompetitorRivalsSection();
    expect(el).toBeNull();
  });

  it("self-hides when the loader throws", async () => {
    loadCompetitorRivalsMock.mockRejectedValueOnce(new Error("boom"));
    const { CompetitorRivalsSection } = await import("./competitor-rivals-section");
    const el = await CompetitorRivalsSection();
    expect(el).toBeNull();
  });

  it("self-hides when the loader misses the render deadline (never stalls /prompts)", async () => {
    // A loader that never resolves: the deadline race must return null, not hang.
    vi.useFakeTimers();
    try {
      loadCompetitorRivalsMock.mockImplementationOnce(() => new Promise(() => {}));
      const { CompetitorRivalsSection } = await import("./competitor-rivals-section");
      const pending = CompetitorRivalsSection();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders real domain rows, citation counts, and a steal-this move link", async () => {
    loadCompetitorRivalsMock.mockResolvedValueOnce(rivalsWithDomains());
    const { CompetitorRivalsSection } = await import("./competitor-rivals-section");
    const el = await CompetitorRivalsSection();
    const html = renderToStaticMarkup(el as ReactElement);

    expect(html).toContain("Who AI recommends instead of you");
    expect(html).toContain("supplehomes.com");
    expect(html).toContain("rivalbuilder.com");
    // Real citation counts, not placeholders.
    expect(html).toContain("12 times AI pointed here");
    expect(html).toContain("3 times AI pointed here");
    // The top prompt is surfaced for context.
    expect(html).toContain("Who builds custom homes in Atherton?");
    // Steal-this link only appears for the domain with a related move.
    expect(html).toContain("Steal this: Create page: Atherton Custom Homes");
    expect(html).toContain('href="/changes"');
  });

  it("does not render a steal-this link for a domain with no related move", async () => {
    loadCompetitorRivalsMock.mockResolvedValueOnce(rivalsWithDomains());
    const { CompetitorRivalsSection } = await import("./competitor-rivals-section");
    const el = await CompetitorRivalsSection();
    const html = renderToStaticMarkup(el as ReactElement);
    // rivalbuilder.com has no topPages, so no ActionPack can join to it.
    const rivalIdx = html.indexOf("rivalbuilder.com");
    const nextStealIdx = html.indexOf("Steal this", rivalIdx);
    expect(nextStealIdx === -1 || nextStealIdx < rivalIdx).toBe(true);
  });
});
