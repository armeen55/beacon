import { describe, expect, it } from "vitest";

import {
  isPageRankSnapshotValid,
  isPageRankStale,
  PAGERANK_SCHEMA_VERSION,
  PAGERANK_FRESH_MS,
  type PageRankSnapshotRow,
} from "./internal-pagerank-store";
import type { InternalPageRankResult } from "./internal-pagerank";

const result: InternalPageRankResult = {
  pages: [{ url: "https://x.com/a", authorityScore: 0.5, clickDepth: 1, orphaned: false, inboundCount: 2 }],
  homepage: "https://x.com/",
  totalEdges: 3,
  builtAt: "2026-07-03T00:00:00Z",
};

function row(over: Partial<PageRankSnapshotRow> = {}): PageRankSnapshotRow {
  return { schemaVersion: PAGERANK_SCHEMA_VERSION, computedAt: "2026-07-03T00:00:00Z", data: result, ...over };
}

describe("isPageRankSnapshotValid", () => {
  it("accepts a current-version snapshot with a pages array", () => {
    expect(isPageRankSnapshotValid(row())).toBe(true);
  });

  it("rejects null / wrong version / missing pages", () => {
    expect(isPageRankSnapshotValid(null)).toBe(false);
    expect(isPageRankSnapshotValid(row({ schemaVersion: PAGERANK_SCHEMA_VERSION + 1 }))).toBe(false);
    expect(
      isPageRankSnapshotValid(row({ data: { ...result, pages: undefined as unknown as [] } })),
    ).toBe(false);
  });
});

describe("isPageRankStale", () => {
  it("fresh within the window, stale past it, stale on an unparseable timestamp", () => {
    const base = Date.parse("2026-07-03T00:00:00Z");
    expect(isPageRankStale("2026-07-03T00:00:00Z", base + PAGERANK_FRESH_MS - 1)).toBe(false);
    expect(isPageRankStale("2026-07-03T00:00:00Z", base + PAGERANK_FRESH_MS + 1)).toBe(true);
    expect(isPageRankStale("not-a-date", base)).toBe(true);
  });
});
