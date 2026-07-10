import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ask/providers/site-trend-wiring.test (W9 slice 1, 2026-07-09) - the true end-to-end
 * proof for the ONE intent wired through the fact-provider registry this slice: route ->
 * gatherFacts (registry) -> buildAskDossier -> composeAskAnswer, exactly the chain
 * ask-actions.ts runs for a site_trend question. Only the raw Supabase loader
 * (loadDailyTotalsForTenant) is mocked - fact-assembly.ts, router.ts, registry.ts, and
 * composer.ts all run for real, so this is the closest thing to a live proof that the
 * rendered answer actually carries freshness + provenance and never calls the LLM.
 */

const { loadDailyTotalsForTenant } = vi.hoisted(() => ({ loadDailyTotalsForTenant: vi.fn() }));
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({ loadDailyTotalsForTenant }));

import { routeQuestion } from "../router";
import { gatherFacts } from "./registry";
import { buildAskDossier } from "../fact-assembly";
import { composeAskAnswer } from "../composer";
import type { CompleteFn } from "@/domains/llm/structured-drafter";

function tenDaysAt(clicks: number, startingFrom = "2026-06-29"): Array<{ date: string; clicks: number; impressions: number }> {
  const start = new Date(`${startingFrom}T00:00:00Z`);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), clicks, impressions: clicks * 20 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ask - site_trend wired end to end through the registry", () => {
  it("answers 'how are things going' with real sitewide clicks, freshness, and provenance - never touching the LLM", async () => {
    loadDailyTotalsForTenant.mockResolvedValue(tenDaysAt(20));

    const routed = routeQuestion("how are things going");
    expect(routed.questionClass).toBe("site_trend");

    const facts = await gatherFacts("tenant-iranopedia", routed);
    const dossier = buildAskDossier(routed, facts);
    expect(dossier.hasData).toBe(true);

    // Every fact came through the registry's siteTrendProvider, so every one carries
    // freshness + provenance (the whole point of wiring this class through the registry).
    for (const f of dossier.facts) {
      expect(f.freshnessIso).toBe("2026-07-08");
      expect(f.providerId).toBe("gsc-daily-totals");
      expect(f.prodLive).toBe(true);
    }

    const complete = vi.fn<CompleteFn>();
    const answer = await composeAskAnswer("how are things going", dossier, { complete });

    expect(complete).not.toHaveBeenCalled();
    expect(answer.source).toBe("fallback");
    expect(answer.answer).toBe(
      "Here is what I know about the site's traffic: Sitewide clicks over the last 7 reported days: 140. " +
        "That is +133% versus the prior 7 days (60 clicks). Data through 2026-07-08, from my Search demand read.",
    );
    expect(answer.answer).not.toMatch(/[–—]/);
    expect(answer.citedFacts.length).toBeGreaterThan(0);
    expect(answer.citedFacts.every((c) => c.href === "/")).toBe(true);
  });

  it("tenant isolation holds through the full chain: tenant A's answer never carries tenant B's numbers", async () => {
    loadDailyTotalsForTenant.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a" ? tenDaysAt(20) : tenDaysAt(999),
    );

    const routed = routeQuestion("how are things going");
    const factsA = await gatherFacts("tenant-a", routed);
    const factsB = await gatherFacts("tenant-b", routed);

    expect(factsA.some((f) => f.value.includes("999"))).toBe(false);
    expect(factsB.some((f) => f.value.includes("140"))).toBe(false);

    const answerA = await composeAskAnswer("how are things going", buildAskDossier(routed, factsA));
    expect(answerA.answer).toContain("140");
    expect(answerA.answer).not.toContain("999");
  });

  it("honestly answers with no data yet when GSC has not synced (fail-soft, never a crash)", async () => {
    loadDailyTotalsForTenant.mockResolvedValue([]);

    const routed = routeQuestion("how are things going");
    const facts = await gatherFacts("tenant-cold-start", routed);
    const dossier = buildAskDossier(routed, facts);
    expect(dossier.hasData).toBe(false);

    const answer = await composeAskAnswer("how are things going", dossier);
    expect(answer.source).toBe("fallback");
    expect(answer.answer.toLowerCase()).toContain("do not have enough");
  });
});
