/**
 * teardown-library.test.ts (DREAM SITE V1, item D3, 2026-07-02).
 *
 * Pins: (1) a URL only the AI-citation audit cache knows about is tagged
 * ai_answers, (2) a URL a steal brief names is tagged google_results (or
 * upgraded to both when the audit cache also has it), (3) freshness passes
 * through from isTeardownFresh, (4) topic/keyword substring filtering works
 * case-insensitively, (5) the summary counts add up honestly, (6) the
 * commonalityBrief field stays null until D2 exists (documented contract).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/domains/demand-graph/competitor-page-audit", () => ({
  getCompetitorAuditsForTenantId: vi.fn(),
  isTeardownFresh: vi.fn((auditedAt: string, nowMs: number) => {
    const t = Date.parse(auditedAt);
    return Number.isFinite(t) && nowMs - t < 14 * 24 * 60 * 60 * 1000;
  }),
  whatWins: vi.fn(() => "FAQ, answer block"),
}));

vi.mock("@/domains/serp/serp-steal-lane", () => ({
  loadStealBriefsForTenant: vi.fn(),
}));

import { getCompetitorAuditsForTenantId } from "@/domains/demand-graph/competitor-page-audit";
import { loadStealBriefsForTenant } from "@/domains/serp/serp-steal-lane";
import { listTeardownLibrary, listTeardownLibraryFiltered, summarizeTeardownLibrary } from "./teardown-library";
import type { CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";
import type { StealBrief } from "@/domains/serp/serp-steal-lane";

function audit(over: Partial<CompetitorPageAudit> = {}): CompetitorPageAudit {
  return {
    url: "https://rival.com/a",
    domain: "rival.com",
    fetchStatus: "ok",
    httpStatus: 200,
    facts: null,
    contentHash: "abc",
    auditedAt: new Date().toISOString(),
    error: null,
    ...over,
  };
}

function brief(over: Partial<StealBrief> = {}): StealBrief {
  return {
    keyword: "persian rugs",
    ourPage: "https://iranopedia.com/rugs",
    ourPosition: 7,
    impressions: 1000,
    serpSource: "stored_history",
    competitorUrl: "https://rival.com/a",
    competitorDomain: "rival.com",
    teardownStatus: "torn_down",
    whatWins: "FAQ",
    structureGaps: ["repair"],
    editPointer: { label: "persian rugs", reason: "gap" },
    summary: "summary",
    ...over,
  };
}

const mockAudits = getCompetitorAuditsForTenantId as unknown as ReturnType<typeof vi.fn>;
const mockBriefs = loadStealBriefsForTenant as unknown as ReturnType<typeof vi.fn>;

describe("listTeardownLibrary", () => {
  it("tags a URL known only to the audit cache as ai_answers", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([]);
    const entries = await listTeardownLibrary("tenant-x");
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceLane).toBe("ai_answers");
    expect(entries[0].topics).toEqual([]);
  });

  it("upgrades a URL both lanes reached to both, with the keyword recorded as a topic", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([brief()]);
    const entries = await listTeardownLibrary("tenant-x");
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceLane).toBe("both");
    expect(entries[0].topics).toEqual(["persian rugs"]);
  });

  it("represents a google-only URL not yet in the audit cache", async () => {
    mockAudits.mockResolvedValue(new Map());
    mockBriefs.mockResolvedValue([brief({ competitorUrl: "https://onlygoogle.com/x", competitorDomain: "onlygoogle.com" })]);
    const entries = await listTeardownLibrary("tenant-x");
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceLane).toBe("google_results");
    expect(entries[0].domain).toBe("onlygoogle.com");
  });

  it("commonalityBrief stays honestly null until D2 exists", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([brief()]);
    const entries = await listTeardownLibrary("tenant-x");
    expect(entries[0].commonalityBrief).toBeNull();
  });

  it("passes through freshness from isTeardownFresh", async () => {
    const stale = audit({ auditedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", stale]]));
    mockBriefs.mockResolvedValue([]);
    const entries = await listTeardownLibrary("tenant-x");
    expect(entries[0].isFresh).toBe(false);
  });

  it("returns [] for an empty tenant id", async () => {
    expect(await listTeardownLibrary("")).toEqual([]);
  });
});

describe("listTeardownLibraryFiltered", () => {
  it("matches a topic substring case-insensitively", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([brief()]);
    const matched = await listTeardownLibraryFiltered("tenant-x", { topic: "PERSIAN" });
    expect(matched).toHaveLength(1);
    const unmatched = await listTeardownLibraryFiltered("tenant-x", { topic: "unrelated topic" });
    expect(unmatched).toHaveLength(0);
  });

  it("matches by domain when no topic is recorded", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([]);
    const matched = await listTeardownLibraryFiltered("tenant-x", { keyword: "rival" });
    expect(matched).toHaveLength(1);
  });

  it("filters by lane, including both-lane entries under either single-lane filter", async () => {
    mockAudits.mockResolvedValue(new Map([["https://rival.com/a", audit()]]));
    mockBriefs.mockResolvedValue([brief()]);
    const aiFiltered = await listTeardownLibraryFiltered("tenant-x", { lane: "ai_answers" });
    expect(aiFiltered).toHaveLength(1);
    const googleFiltered = await listTeardownLibraryFiltered("tenant-x", { lane: "google_results" });
    expect(googleFiltered).toHaveLength(1);
  });
});

describe("summarizeTeardownLibrary", () => {
  it("counts lanes honestly", async () => {
    mockAudits.mockResolvedValue(
      new Map([
        ["https://rival.com/a", audit({ url: "https://rival.com/a" })],
        ["https://rival.com/b", audit({ url: "https://rival.com/b", domain: "rival2.com" })],
      ]),
    );
    mockBriefs.mockResolvedValue([brief({ competitorUrl: "https://rival.com/a" })]);
    const summary = await summarizeTeardownLibrary("tenant-x");
    expect(summary.total).toBe(2);
    expect(summary.both).toBe(1);
    expect(summary.aiOnly).toBe(1);
    expect(summary.googleOnly).toBe(0);
  });
});
