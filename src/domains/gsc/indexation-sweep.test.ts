import { describe, it, expect } from "vitest";

import {
  buildIndexationLine,
  buildIndexationSweep,
  selectIndexationBatch,
  type IndexationCandidate,
  type IndexationVerdict,
} from "./indexation-sweep";

const BANNED_DASH = /[‒–—―]/;

const cand = (page: string, impressions90d: number): IndexationCandidate => ({ page, impressions90d });

describe("selectIndexationBatch (highest demand first, capped at the budget)", () => {
  it("takes the top-demand pages up to the budget", () => {
    const batch = selectIndexationBatch(
      [cand("/a", 100), cand("/b", 500), cand("/c", 300), cand("/d", 50)],
      2,
    );
    expect(batch.map((b) => b.page)).toEqual(["/b", "/c"]);
  });

  it("never exceeds the render budget (the budget rule)", () => {
    const many = Array.from({ length: 20 }, (_, i) => cand(`/p${i}`, 1000 - i));
    expect(selectIndexationBatch(many, 5)).toHaveLength(5);
  });

  it("dedupes pages, keeping the largest impressions seen", () => {
    const batch = selectIndexationBatch([cand("/a", 100), cand("/a", 400), cand("/b", 200)], 5);
    expect(batch).toEqual([
      { page: "/a", impressions90d: 400 },
      { page: "/b", impressions90d: 200 },
    ]);
  });

  it("drops pages with no impressions and blank URLs (nothing proven to lose)", () => {
    const batch = selectIndexationBatch([cand("/a", 0), cand("", 500), cand("/b", 300)], 5);
    expect(batch.map((b) => b.page)).toEqual(["/b"]);
  });

  it("is empty-safe: no candidates or a zero budget yields an empty batch", () => {
    expect(selectIndexationBatch([], 5)).toEqual([]);
    expect(selectIndexationBatch([cand("/a", 100)], 0)).toEqual([]);
  });
});

describe("buildIndexationSweep (only Google's explicit 'no' counts as not-indexed)", () => {
  const v = (page: string, indexed: boolean | null): IndexationVerdict => ({ page, indexed });

  it("counts confirmed not-indexed pages and lists them", () => {
    const sweep = buildIndexationSweep([
      v("/a", true),
      v("/b", false),
      v("/c", false),
      v("/d", null),
    ]);
    expect(sweep.checked).toBe(4);
    expect(sweep.notIndexed).toBe(2);
    expect(sweep.notIndexedPages).toEqual(["/b", "/c"]);
    expect(sweep.line).toContain("2 of your top 4 pages are not indexed by Google yet");
  });

  it("treats an inconclusive verdict (null) as checked but never as not-indexed", () => {
    const sweep = buildIndexationSweep([v("/a", true), v("/b", null)]);
    expect(sweep.checked).toBe(2);
    expect(sweep.notIndexed).toBe(0);
    expect(sweep.line).toBeNull();
  });

  it("self-hides (null line) when every checked page is indexed (never a bare zero)", () => {
    const sweep = buildIndexationSweep([v("/a", true), v("/b", true)]);
    expect(sweep.notIndexed).toBe(0);
    expect(sweep.line).toBeNull();
  });

  it("is empty-safe: nothing inspected yields a null line", () => {
    const sweep = buildIndexationSweep([]);
    expect(sweep.checked).toBe(0);
    expect(sweep.line).toBeNull();
  });
});

describe("buildIndexationLine (the honest, plain-words headline)", () => {
  it("uses singular grammar for one missing page", () => {
    const line = buildIndexationLine(3, 1)!;
    expect(line).toContain("1 of your top 3 pages is not indexed by Google yet");
    expect(line).toContain("it earns no Google traffic");
    expect(line).toContain("getting it indexed as the first move");
  });

  it("uses plural grammar for several missing pages", () => {
    const line = buildIndexationLine(5, 3)!;
    expect(line).toContain("3 of your top 5 pages are not indexed by Google yet");
    expect(line).toContain("they earn no Google traffic");
    expect(line).toContain("getting them indexed as the first move");
  });

  it("names a single checked page correctly", () => {
    expect(buildIndexationLine(1, 1)).toContain("1 of your top 1 page is not indexed");
  });

  it("returns null when nothing was checked or nothing is missing", () => {
    expect(buildIndexationLine(0, 0)).toBeNull();
    expect(buildIndexationLine(5, 0)).toBeNull();
  });

  it("never uses a raw Google enum or a lab word, and is dash-clean", () => {
    for (const [c, n] of [[3, 1], [5, 3]] as const) {
      const line = buildIndexationLine(c, n)!;
      expect(line).not.toMatch(/coverage_state|indexing_state|INDEXING|SERP|dataState/i);
      expect(BANNED_DASH.test(line)).toBe(false);
    }
  });
});
