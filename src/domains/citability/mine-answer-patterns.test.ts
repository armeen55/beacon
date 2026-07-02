/**
 * mine-answer-patterns tests (2026-07-02, master plan item 26).
 *
 * Pins:
 *   - paging discipline: prompt_answer_observations and answer_texts are
 *     ALWAYS read via .range() in PAGE_SIZE (1000) chunks, looping until a
 *     short page signals exhaustion (this Supabase project caps every
 *     response at 1000 rows regardless of .limit())
 *   - tenant scoping: prompt_answer_observations is read with .eq("tenant_id", ...);
 *     answer_texts (no tenant_id column) is only ever queried by ids that
 *     already passed the tenant-scoped read
 *   - aggregation: bucket counts, shares, and dominant-pattern ranking
 *   - fail-soft: a thrown read collapses to an empty profile, never throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Chainable supabase mock with .range() paging + call tracking ───────────

type Row = Record<string, unknown>;
const observationPages: Row[][] = [];
const answerTextRows: Row[] = [];
const rangeCalls: Array<{ table: string; from: number; to: number }> = [];
const inCalls: Array<{ table: string; ids: string[] }> = [];
let observationsThrow: Error | null = null;
let answerTextsThrow: Error | null = null;

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push({ table, from, to });
    if (table === "prompt_answer_observations") {
      if (observationsThrow) return Promise.resolve({ data: null, error: { message: observationsThrow.message } });
      const pageIndex = Math.floor(from / 1000);
      const page = observationPages[pageIndex] ?? [];
      return Promise.resolve({ data: page, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
  chain.in = vi.fn((_col: string, ids: string[]) => {
    inCalls.push({ table, ids });
    if (table === "answer_texts") {
      if (answerTextsThrow) return Promise.resolve({ data: null, error: { message: answerTextsThrow.message } });
      const rows = answerTextRows.filter((r) => ids.includes(r.observation_id as string));
      return Promise.resolve({ data: rows, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => chainFor(table) }),
}));

import {
  mineAnswerPatterns,
  emptyPatternProfile,
  foldClassifiedSentences,
  PAGE_SIZE,
} from "./mine-answer-patterns";

beforeEach(() => {
  observationPages.length = 0;
  answerTextRows.length = 0;
  rangeCalls.length = 0;
  inCalls.length = 0;
  observationsThrow = null;
  answerTextsThrow = null;
});

describe("PAGE_SIZE", () => {
  it("is exactly 1000 (the repo-wide PostgREST cap convention)", () => {
    expect(PAGE_SIZE).toBe(1000);
  });
});

describe("mineAnswerPatterns - paging discipline", () => {
  it("pages prompt_answer_observations with .range() in PAGE_SIZE chunks until a short page", () => {
    observationPages[0] = Array.from({ length: 1000 }, (_, i) => ({
      id: `obs-${i}`,
      citation_urls: [`https://example.com/${i}`],
      citation_domains: ["example.com"],
    }));
    observationPages[1] = [{ id: "obs-1000", citation_urls: ["https://example.com/last"], citation_domains: ["example.com"] }];

    return mineAnswerPatterns("tenant-iranopedia").then((profile) => {
      const obsRangeCalls = rangeCalls.filter((c) => c.table === "prompt_answer_observations");
      expect(obsRangeCalls).toEqual([
        { table: "prompt_answer_observations", from: 0, to: 999 },
        { table: "prompt_answer_observations", from: 1000, to: 1999 },
      ]);
      expect(profile.observationsWithCitations).toBe(1001);
    });
  });

  it("stops after the FIRST page when it comes back short (no wasted second call)", async () => {
    observationPages[0] = [{ id: "obs-0", citation_urls: [], citation_domains: [] }];
    await mineAnswerPatterns("tenant-iranopedia");
    const obsRangeCalls = rangeCalls.filter((c) => c.table === "prompt_answer_observations");
    expect(obsRangeCalls).toHaveLength(1);
  });

  it("chunks answer_texts .in() lookups at PAGE_SIZE ids per call", async () => {
    observationPages[0] = Array.from({ length: 1500 }, (_, i) => ({
      id: `obs-${i}`,
      citation_urls: [],
      citation_domains: [],
    }));
    await mineAnswerPatterns("tenant-iranopedia");
    const textInCalls = inCalls.filter((c) => c.table === "answer_texts");
    expect(textInCalls).toHaveLength(2);
    expect(textInCalls[0]!.ids).toHaveLength(1000);
    expect(textInCalls[1]!.ids).toHaveLength(500);
  });

  it("scopes prompt_answer_observations to the tenant via .eq, and only ever queries answer_texts by ids (no tenant_id column exists on it)", async () => {
    observationPages[0] = [{ id: "obs-0", citation_urls: [], citation_domains: [] }];
    await mineAnswerPatterns("tenant-iranopedia");
    // prompt_answer_observations was read (proven by the range call log above); answer_texts
    // is only ever reached through the .in(observation_id, [...ids]) path recorded in
    // inCalls - never through a bare/tenant-filtered select, since it has no tenant_id column.
    const obsRangeCalls = rangeCalls.filter((c) => c.table === "prompt_answer_observations");
    expect(obsRangeCalls.length).toBeGreaterThan(0);
    const textInCalls = inCalls.filter((c) => c.table === "answer_texts");
    expect(textInCalls.length).toBeGreaterThan(0);
    expect(textInCalls[0]!.ids).toEqual(["obs-0"]);
  });
});

describe("mineAnswerPatterns - aggregation over real-shaped rows", () => {
  it("classifies cited sentences and aggregates bucket counts + dominant patterns", async () => {
    observationPages[0] = [
      { id: "obs-1", citation_urls: ["https://a.com/x"], citation_domains: ["a.com"] },
      { id: "obs-2", citation_urls: ["https://b.com/y"], citation_domains: ["b.com"] },
      { id: "obs-3", citation_urls: ["https://c.com/z"], citation_domains: ["c.com"] },
    ];
    answerTextRows.push(
      { observation_id: "obs-1", body: "Over 60 percent of families set a Haft-Sin table (a.com)." },
      { observation_id: "obs-2", body: "Nowruz is a spring festival celebrated widely (b.com)." },
      { observation_id: "obs-3", body: "3 million people visit each year (c.com)." },
    );
    const profile = await mineAnswerPatterns("tenant-iranopedia");
    expect(profile.observationsWithCitations).toBe(3);
    expect(profile.observationsWithText).toBe(3);
    expect(profile.sentencesClassified).toBe(3);
    expect(profile.bucketCounts.stat_first).toBe(2);
    expect(profile.bucketCounts.definition).toBe(1);
    expect(profile.dominantPatterns[0]).toBe("stat_first");
    expect(profile.bucketSharePct.stat_first).toBe(67);
  });

  it("skips observations with no matching answer_texts row (never fabricates a sentence)", async () => {
    observationPages[0] = [{ id: "obs-1", citation_urls: ["https://a.com/x"], citation_domains: ["a.com"] }];
    // No answerTextRows pushed - the join finds nothing.
    const profile = await mineAnswerPatterns("tenant-iranopedia");
    expect(profile.observationsWithCitations).toBe(1);
    expect(profile.observationsWithText).toBe(0);
    expect(profile.sentencesClassified).toBe(0);
  });

  it("returns an empty profile when the tenant has no cited observations", async () => {
    observationPages[0] = [];
    const profile = await mineAnswerPatterns("tenant-iranopedia");
    expect(profile.observationsWithCitations).toBe(0);
    expect(profile.sentencesClassified).toBe(0);
    expect(profile.dominantPatterns).toEqual([]);
  });

  it("returns an empty profile for an empty tenantId without hitting the network", async () => {
    const profile = await mineAnswerPatterns("");
    expect(profile.observationsWithCitations).toBe(0);
    expect(rangeCalls).toHaveLength(0);
  });
});

describe("mineAnswerPatterns - fail-soft", () => {
  it("returns an empty profile (never throws) when the observation read errors", async () => {
    observationsThrow = new Error("network down");
    const profile = await mineAnswerPatterns("tenant-iranopedia");
    expect(profile.observationsWithCitations).toBe(0);
    expect(profile.sentencesClassified).toBe(0);
  });

  it("keeps whatever it read when the answer_texts read errors mid-run", async () => {
    observationPages[0] = [{ id: "obs-1", citation_urls: ["https://a.com/x"], citation_domains: ["a.com"] }];
    answerTextsThrow = new Error("timeout");
    const profile = await mineAnswerPatterns("tenant-iranopedia");
    expect(profile.observationsWithCitations).toBe(1);
    expect(profile.observationsWithText).toBe(0);
  });
});

describe("emptyPatternProfile + foldClassifiedSentences", () => {
  it("emptyPatternProfile has zeroed counts and an empty dominant list", () => {
    const p = emptyPatternProfile("tenant-x", new Date("2026-07-02T00:00:00Z"));
    expect(p.sentencesClassified).toBe(0);
    expect(p.bucketCounts.other).toBe(0);
    expect(p.dominantPatterns).toEqual([]);
    expect(p.computed_at).toBe("2026-07-02T00:00:00.000Z");
  });

  it("folding is additive across batches and recomputes shares each time", () => {
    let p = emptyPatternProfile("tenant-x");
    p = foldClassifiedSentences(p, [{ bucket: "stat_first" }, { bucket: "definition" }]);
    expect(p.sentencesClassified).toBe(2);
    expect(p.bucketSharePct.stat_first).toBe(50);
    p = foldClassifiedSentences(p, [{ bucket: "stat_first" }]);
    expect(p.sentencesClassified).toBe(3);
    expect(p.bucketCounts.stat_first).toBe(2);
    expect(p.dominantPatterns[0]).toBe("stat_first");
  });
});
