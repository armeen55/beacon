/**
 * page-freshness.test.ts (MASTER PLAN v2 UX1, 2026-07-02) - pins the new
 * `loadPageContentSnapshot` single-URL point read added for the page dossier's
 * content band: exact-URL match first, a www./bare-host fallback (mirrors the
 * proven variant in answer-alignment-store.ts / factual-entailment-store.ts),
 * and fail-soft -> null on a missing row, a read error, or a thrown exception.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = { title: string | null; meta_description: string | null; h1: string | null; word_count: number | null; fetched_at: string | null } | null;
const rowsByUrl = new Map<string, Row>();
const eqCalls: string[] = [];
let shouldThrow = false;
let errorMessage: string | null = null;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (shouldThrow) throw new Error("boom");
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: (_col: string, url: string) => {
              eqCalls.push(url);
              return {
                order: () => ({
                  limit: () => {
                    if (errorMessage) return Promise.resolve({ data: null, error: { message: errorMessage } });
                    const row = rowsByUrl.get(url);
                    return Promise.resolve({ data: row ? [row] : [], error: null });
                  },
                }),
              };
            },
          }),
        }),
      }),
    };
  },
}));

import { loadPageContentSnapshot } from "./page-freshness";

beforeEach(() => {
  rowsByUrl.clear();
  eqCalls.length = 0;
  shouldThrow = false;
  errorMessage = null;
});

describe("loadPageContentSnapshot", () => {
  it("returns null for an empty tenant or URL without reading anything", async () => {
    expect(await loadPageContentSnapshot("", "https://iranopedia.com/cities")).toBeNull();
    expect(await loadPageContentSnapshot("tenant-1", "")).toBeNull();
    expect(eqCalls).toHaveLength(0);
  });

  it("maps a found row's snapshot columns to the plain PageContentSnapshot shape", async () => {
    rowsByUrl.set("https://iranopedia.com/cities", {
      title: "Cities of Iran",
      meta_description: "A tour of Iran's major cities.",
      h1: "Cities of Iran",
      word_count: 1200,
      fetched_at: "2026-06-30T00:00:00Z",
    });
    const result = await loadPageContentSnapshot("tenant-1", "https://iranopedia.com/cities");
    expect(result).toEqual({
      title: "Cities of Iran",
      metaDescription: "A tour of Iran's major cities.",
      h1: "Cities of Iran",
      wordCount: 1200,
      fetchedAt: "2026-06-30T00:00:00Z",
    });
  });

  it("falls back to the www./bare-host variant when the exact URL has no row", async () => {
    rowsByUrl.set("https://www.iranopedia.com/cities", {
      title: "Cities of Iran",
      meta_description: null,
      h1: null,
      word_count: 0,
      fetched_at: null,
    });
    const result = await loadPageContentSnapshot("tenant-1", "https://iranopedia.com/cities");
    expect(eqCalls).toEqual(["https://iranopedia.com/cities", "https://www.iranopedia.com/cities"]);
    expect(result?.title).toBe("Cities of Iran");
  });

  it("returns null when neither URL variant has a row", async () => {
    const result = await loadPageContentSnapshot("tenant-1", "https://iranopedia.com/nowhere");
    expect(result).toBeNull();
  });

  it("is fail-soft on a read error (never throws, returns null)", async () => {
    errorMessage = "connection reset";
    const result = await loadPageContentSnapshot("tenant-1", "https://iranopedia.com/cities");
    expect(result).toBeNull();
  });

  it("is fail-soft when the client itself throws", async () => {
    shouldThrow = true;
    const result = await loadPageContentSnapshot("tenant-1", "https://iranopedia.com/cities");
    expect(result).toBeNull();
  });

  it("treats a malformed URL's www-toggle attempt as a no-op (still tries the exact URL only)", async () => {
    const result = await loadPageContentSnapshot("tenant-1", "not-a-url");
    expect(result).toBeNull();
    expect(eqCalls).toEqual(["not-a-url"]);
  });
});
