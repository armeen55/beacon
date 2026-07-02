/**
 * 2026-07-02 - crawl-citation-funnel loader tests (BEACON_500 item 7).
 *
 * Pins src/domains/ai-visibility/load-crawl-citation-funnel.ts:
 *   - pure aggregation mappers (imported citations, native prompt dedup,
 *     GA4 click aggregation with plain top-source labels)
 *   - end-to-end assembly: bot signals + citation tables + ga4 rows -> report
 *   - fail-soft: thrown reads and short needles collapse to empty/partial,
 *     never a crash and never a fabricated stage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const botSignalsMock = vi.fn();
vi.mock("@/domains/profound-deep/load-bot-referral-signals", () => ({
  loadBotReferralSignals: (...a: unknown[]) => botSignalsMock(...a),
}));

const gscSignalsMock = vi.fn();
vi.mock("@/domains/recommendation-intelligence/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: (...a: unknown[]) => gscSignalsMock(...a),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Per-table row fixtures the chainable supabase mock resolves with. */
const tableRows: Record<string, unknown[] | Error> = {};
function chainFor(table: string) {
  const result = () => {
    const rows = tableRows[table];
    if (rows instanceof Error) throw rows;
    return Promise.resolve({ data: rows ?? [], error: null });
  };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "gte", "ilike"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => result());
  return chain;
}
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => chainFor(table) }),
}));

import {
  aggregateAiClicks,
  aggregateImportedCitations,
  aggregateNativeCitations,
  emptyFunnelReport,
  loadCrawlCitationFunnel,
} from "./load-crawl-citation-funnel";

const EMPTY_BOT_SIGNALS = {
  hasData: false,
  botByPath: [],
  botRows: [],
};

function day(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  for (const k of Object.keys(tableRows)) delete tableRows[k];
  botSignalsMock.mockReset().mockResolvedValue(EMPTY_BOT_SIGNALS);
  gscSignalsMock.mockReset().mockResolvedValue(new Map());
});

// ── Pure mappers ─────────────────────────────────────────────────────────────

describe("aggregateImportedCitations", () => {
  it("sums per canonical path, floors count at 1, tracks latest day", () => {
    const agg = aggregateImportedCitations([
      { date: "2026-06-20", url: "https://iranopedia.com/Iran-Cheetah/", citation_count: 3 },
      { date: "2026-06-25", url: "/iran-cheetah", citation_count: 0 },
      { date: "2026-06-22", url: "/nowruz", citation_count: "2" },
      { date: "2026-06-22", url: null, citation_count: 5 },
    ]);
    expect(agg.get("/iran-cheetah")).toMatchObject({ count: 4, lastAt: "2026-06-25" });
    expect(agg.get("/nowruz")).toMatchObject({ count: 2, lastAt: "2026-06-22" });
    expect(agg.size).toBe(2);
  });
});

describe("aggregateNativeCitations", () => {
  it("counts one per observation per page and distinct questions, own host only", () => {
    const agg = aggregateNativeCitations(
      [
        {
          prompt_id: "p1",
          observed_at: "2026-06-28T02:00:00Z",
          citation_urls: [
            "https://iranopedia.com/iran-cheetah",
            "https://iranopedia.com/iran-cheetah/", // duplicate inside one answer
            "https://rival.com/cheetah", // not ours
          ],
        },
        { prompt_id: "p2", observed_at: "2026-06-29T02:00:00Z", citation_urls: ["https://www.iranopedia.com/iran-cheetah"] },
        { prompt_id: "p2", observed_at: "2026-06-30T02:00:00Z", citation_urls: ["https://iranopedia.com/iran-cheetah"] },
      ],
      "iranopedia",
    );
    const cheetah = agg.get("/iran-cheetah")!;
    expect(cheetah.count).toBe(3); // one per observation, dedup inside answers
    expect(cheetah.prompts.size).toBe(2); // p1, p2
    expect(cheetah.lastAt).toBe("2026-06-30");
    expect(agg.has("/cheetah")).toBe(false);
  });

  it("refuses needles under 3 chars (no guessed ownership)", () => {
    const agg = aggregateNativeCitations(
      [{ prompt_id: "p1", observed_at: "2026-06-28", citation_urls: ["https://ab.com/x"] }],
      "ab",
    );
    expect(agg.size).toBe(0);
  });
});

describe("aggregateAiClicks", () => {
  it("aggregates sessions per page with a plain top-source label", () => {
    const pages = aggregateAiClicks([
      { pagePath: "/iran-cheetah", sourceDomain: "chatgpt.com", sessions: 5, engagedSessions: 4, keyEvents: 1 },
      { pagePath: "/iran-cheetah/", sourceDomain: "perplexity.ai", sessions: 2, engagedSessions: 1, keyEvents: 0 },
      { pagePath: "/nowruz", sourceDomain: "perplexity.ai", sessions: 1, engagedSessions: 1, keyEvents: 0 },
    ]);
    const cheetah = pages.find((p) => p.path === "/iran-cheetah")!;
    expect(cheetah.sessions).toBe(7);
    expect(cheetah.keyEvents).toBe(1);
    expect(cheetah.topSource).toBe("ChatGPT");
    expect(pages.find((p) => p.path === "/nowruz")?.topSource).toBe("Perplexity");
  });
});

// ── Loader assembly ──────────────────────────────────────────────────────────

describe("loadCrawlCitationFunnel", () => {
  it("assembles all four feeds into a staged report", async () => {
    botSignalsMock.mockResolvedValue({
      hasData: true,
      botByPath: [
        { path: "/iran-cheetah", totalHits: 6, totalCitations: 0, bots: [{ bot: "GPTBot", hits: 6 }] },
        { path: "/quiet-page", totalHits: 2, totalCitations: 0, bots: [{ bot: "ClaudeBot", hits: 2 }] },
      ],
      botRows: [
        { date: "2026-06-20", path: "/iran-cheetah", botName: "GPTBot", botType: "crawler", hitCount: 4, citations: 0 },
        { date: "2026-06-26", path: "/iran-cheetah", botName: "GPTBot", botType: "crawler", hitCount: 2, citations: 0 },
        { date: "2026-06-21", path: "/quiet-page", botName: "ClaudeBot", botType: "crawler", hitCount: 2, citations: 0 },
      ],
    });
    tableRows["profound_citation_rows"] = [
      { date: day(3), url: "https://iranopedia.com/iran-cheetah", citation_count: 5 },
    ];
    tableRows["prompt_answer_observations"] = [
      { prompt_id: "p9", observed_at: `${day(2)}T03:00:00Z`, citation_urls: ["https://iranopedia.com/iran-cheetah"] },
    ];
    tableRows["ga4_ai_referral_daily"] = [
      { page_path: "/iran-cheetah", day: day(1), source_domain: "chatgpt.com", sessions: 3, engaged_sessions: 2, key_events: 1 },
    ];
    gscSignalsMock.mockResolvedValue(
      new Map([
        ["https://iranopedia.com/orphan", { page: "https://iranopedia.com/orphan", impressions90d: 7000, clicks90d: 10, ctr90d: 0, position90d: 8, topQueries: [] }],
      ]),
    );

    const report = await loadCrawlCitationFunnel("tenant-iranopedia", "iranopedia");
    expect(report.hasData).toBe(true);
    expect(report.feeds).toMatchObject({ crawl: true, cited: true, clicks: true, crawledPageCount: 2 });

    const cheetah = report.pages.find((p) => p.pagePath === "/iran-cheetah")!;
    expect(cheetah.stage).toBe("converting");
    expect(cheetah.crawled).toMatchObject({ count: 6, lastAt: "2026-06-26" });
    expect(cheetah.cited).toMatchObject({ count: 6, prompts: 1 }); // 5 imported + 1 native
    expect(cheetah.aiClicks).toMatchObject({ sessions: 3, keyEvents: 1, topSource: "ChatGPT" });

    expect(report.pages.find((p) => p.pagePath === "/quiet-page")?.stage).toBe("crawled_not_cited");
    // Crawler feed live -> the high-demand never-crawled page joins with evidence.
    const orphan = report.pages.find((p) => p.pagePath === "/orphan")!;
    expect(orphan.stage).toBe("not_crawled");
    expect(orphan.demand).toBe(7000);
  });

  it("short needle keeps citation stages dark instead of guessing ownership", async () => {
    tableRows["profound_citation_rows"] = [{ date: day(2), url: "https://x.com/a", citation_count: 9 }];
    const report = await loadCrawlCitationFunnel("tenant-iranopedia", "ab");
    expect(report.feeds.cited).toBe(false);
  });

  it("fail-soft: every read throwing still returns an empty report", async () => {
    botSignalsMock.mockRejectedValue(new Error("bot down"));
    gscSignalsMock.mockRejectedValue(new Error("gsc down"));
    tableRows["profound_citation_rows"] = new Error("db down");
    tableRows["prompt_answer_observations"] = new Error("db down");
    tableRows["ga4_ai_referral_daily"] = new Error("db down");
    // Distinct args from the assembly test: react cache() may memoize per-arg.
    const report = await loadCrawlCitationFunnel("tenant-broken", "iranopedia");
    expect(report.hasData).toBe(false);
    expect(report.pages).toEqual([]);
    expect(report).toMatchObject(emptyFunnelReport());
  });
});
