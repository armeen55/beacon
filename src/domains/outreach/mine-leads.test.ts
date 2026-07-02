import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { readWikiGapResultsMock } = vi.hoisted(() => ({ readWikiGapResultsMock: vi.fn() }));
vi.mock("@/domains/wiki-gap/wiki-gap-store", () => ({ readWikiGapResults: readWikiGapResultsMock }));

const { readKeywordGapResultsMock } = vi.hoisted(() => ({ readKeywordGapResultsMock: vi.fn() }));
vi.mock("@/domains/serp/keyword-gap-store", () => ({ readKeywordGapResults: readKeywordGapResultsMock }));

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => {
    throw new Error("should not be called when unconfigured");
  },
}));

vi.mock("@/domains/serp/serp-history", () => ({
  aiOverviewHistoryRows: vi.fn(async () => []),
}));

import { mineOutreachLeads } from "./mine-leads";

beforeEach(() => {
  vi.clearAllMocks();
  readWikiGapResultsMock.mockResolvedValue(null);
  readKeywordGapResultsMock.mockResolvedValue(null);
});

describe("mineOutreachLeads - bounded, $0, honest empty", () => {
  it("returns an empty lead list with all sources unchecked when nothing has been mined yet", async () => {
    const r = await mineOutreachLeads("tenant-x", "iranopedia.com");
    expect(r.leads).toEqual([]);
    expect(r.sourcesChecked).toEqual({ wikiGap: false, keywordGap: false, profound: false });
  });

  it("surfaces keyword-gap competitor leads when a prior gap run exists", async () => {
    readKeywordGapResultsMock.mockResolvedValue({
      tenant_id: "tenant-x",
      computed_at: "2026-07-01T00:00:00.000Z",
      own_domain: "iranopedia.com",
      competitors: ["rival.example"],
      spent_usd: 0.5,
      gaps: [
        {
          keyword: "persian new year",
          volume: 800,
          cpcUsd: null,
          competitorDomain: "rival.example",
          competitorRank: 3,
          ownRank: null,
          alsoWonBy: [],
          score: 680,
          evidence: "rival.example ranks 3 on Google for persian new year.",
        },
      ],
    });
    const r = await mineOutreachLeads("tenant-x", "iranopedia.com");
    expect(r.sourcesChecked.keywordGap).toBe(true);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]!.targetDomain).toBe("rival.example");
    expect(r.leads[0]!.leadSource).toBe("keyword_gap_competitor");
  });

  it("never throws when a source read rejects - degrades to fewer leads", async () => {
    readKeywordGapResultsMock.mockRejectedValue(new Error("db down"));
    const r = await mineOutreachLeads("tenant-x", "iranopedia.com");
    expect(r.leads).toEqual([]);
  });
});
