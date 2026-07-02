import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => {
    throw new Error("should not be called - readChunks is injected in these tests");
  },
}));

vi.mock("./retrieval-budget", () => ({
  checkBudget: async () => ({ allowed: true, remaining: 2 }),
  recordSpend: async () => {},
}));

import { buildQuestionReport, buildCitationLikelihoodReport, type CitationLikelihoodDeps } from "./citation-likelihood";
import type { RetrievalCandidate } from "./retrieve";
import { whoWins } from "./retrieve";

describe("buildQuestionReport - sentence building (pure)", () => {
  const candidates: RetrievalCandidate[] = [
    { source: "competitor", pageUrl: "https://wikipedia.org/nowruz", chunkExcerpt: "Nowruz begins on the first day of spring.", embedding: [1, 0, 0] },
    { source: "competitor", pageUrl: "https://rival.com/nowruz", chunkExcerpt: "rival mid", embedding: [0.5, 0.5, 0] },
    { source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "our passage", embedding: [0.4, 0.6, 0] },
  ];

  it("reports rank 5th-of-N style sentence when the tenant is behind", () => {
    const result = whoWins([1, 0, 0], candidates);
    const report = buildQuestionReport("how do persians celebrate nowruz", "fanout", result);
    expect(report.ownBestRank).toBe(3);
    expect(report.totalCandidates).toBe(3);
    expect(report.passageToBeat?.domain).toBe("wikipedia.org");
    expect(report.sentence).toContain("how do persians celebrate nowruz");
    expect(report.sentence).toContain("3rd of 3");
    expect(report.sentence).toContain("wikipedia.org");
    expect(/[–—]/.test(report.sentence)).toBe(false); // dash guard
  });

  it("says 'you are ahead' with no passageToBeat when the tenant already holds rank 1", () => {
    const result = whoWins([1, 0, 0], [
      { source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "great match", embedding: [1, 0, 0] },
      { source: "competitor", pageUrl: "https://rival.com/nowruz", chunkExcerpt: "weak", embedding: [0, 1, 0] },
    ]);
    const report = buildQuestionReport("when is nowruz", "gsc_query", result);
    expect(report.ownBestRank).toBe(1);
    expect(report.passageToBeat).toBeNull();
    expect(report.sentence).toMatch(/ahead/i);
  });

  it("honest silence: says it cannot rank the tenant when they have nothing indexed", () => {
    const result = whoWins([1, 0, 0], [
      { source: "competitor", pageUrl: "https://wikipedia.org/nowruz", chunkExcerpt: "x", embedding: [1, 0, 0] },
    ]);
    const report = buildQuestionReport("what is nowruz", "gsc_query", result);
    expect(report.ownBestRank).toBeNull();
    expect(report.sentence).toMatch(/cannot rank you/i);
    expect(report.sentence).toContain("wikipedia.org");
  });

  it("handles zero candidates without crashing (honest 'no index yet' sentence)", () => {
    const result = whoWins([1, 0, 0], []);
    const report = buildQuestionReport("what is nowruz", "gsc_query", result);
    expect(report.totalCandidates).toBe(0);
    expect(report.passageToBeat).toBeNull();
    expect(report.sentence).toMatch(/do not have any indexed passages/i);
  });

  it("ordinal suffixes are correct for 1st/2nd/3rd/4th/11th/21st", () => {
    const mk = (n: number) => {
      const candidates2: RetrievalCandidate[] = Array.from({ length: n }, (_, i) => ({
        source: i === n - 1 ? ("owned" as const) : ("competitor" as const),
        pageUrl: `p${i}`,
        chunkExcerpt: "x",
        embedding: [n - i, 0, 0],
      }));
      return buildQuestionReport("q", "gsc_query", whoWins([1, 0, 0], candidates2));
    };
    expect(mk(4).sentence).toContain("4th of 4");
    expect(mk(11).sentence).toContain("11th of 11");
    expect(mk(21).sentence).toContain("21st of 21");
  });

  it("never contains an em or en dash regardless of rank/domain", () => {
    const result = whoWins([1, 0, 0], candidates);
    const report = buildQuestionReport("q", "fanout", result);
    expect(report.sentence).not.toMatch(/[–—]/);
  });
});

function baseDeps(overrides: Partial<CitationLikelihoodDeps> = {}): CitationLikelihoodDeps {
  return {
    loadFanoutQuestions: async () => [],
    loadGscQuestions: async () => [],
    readChunks: async () => [],
    ...overrides,
  };
}

describe("buildCitationLikelihoodReport - question source priority", () => {
  it("prefers fanout questions over GSC when both exist", async () => {
    const gscLoader = vi.fn(async () => ["gsc question"]);
    const deps = baseDeps({
      loadFanoutQuestions: async () => ["fanout question"],
      loadGscQuestions: gscLoader,
      readChunks: async () => [{ source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "x", embedding: [1, 0] }],
      embed: async (inputs: string[]) => ({ vectors: inputs.map(() => [1, 0]) }),
    });
    const report = await buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", deps);
    expect(report.questions.map((q) => q.question)).toEqual(["fanout question"]);
    expect(report.questions[0].source).toBe("fanout");
    expect(gscLoader).not.toHaveBeenCalled();
  });

  it("falls back to GSC queries when no fanout questions match", async () => {
    const deps = baseDeps({
      loadFanoutQuestions: async () => [],
      loadGscQuestions: async () => ["what is nowruz"],
      readChunks: async () => [{ source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "x", embedding: [1, 0] }],
      embed: async (inputs: string[]) => ({ vectors: inputs.map(() => [1, 0]) }),
    });
    const report = await buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", deps);
    expect(report.questions.map((q) => q.question)).toEqual(["what is nowruz"]);
    expect(report.questions[0].source).toBe("gsc_query");
  });

  it("passes the ORIGINAL (non-canonicalized) pageUrl to the GSC loader, never the www-stripped form (regression pin: GSC's own gsc_daily_rows.page stores 'www.' - canonicalizing before the lookup silently zeroed every real match against tenant-iranopedia's data)", async () => {
    const loadGscQuestions = vi.fn(async (_tenantId: string, url: string) => (url === "https://www.iranopedia.com/persian-male-names" ? ["persian male names"] : []));
    const deps = baseDeps({
      loadGscQuestions,
      readChunks: async () => [{ source: "owned", pageUrl: "https://iranopedia.com/persian-male-names", chunkExcerpt: "x", embedding: [1, 0] }],
      embed: async (inputs: string[]) => ({ vectors: inputs.map(() => [1, 0]) }),
    });
    const report = await buildCitationLikelihoodReport("tenant-iranopedia", "https://www.iranopedia.com/persian-male-names", deps);
    expect(loadGscQuestions).toHaveBeenCalledWith("tenant-iranopedia", "https://www.iranopedia.com/persian-male-names");
    expect(report.questions.map((q) => q.question)).toEqual(["persian male names"]);
  });

  it("returns an empty report when neither source has a question (honest silence)", async () => {
    const report = await buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", baseDeps());
    expect(report.questions).toEqual([]);
  });

  it("returns an empty report when there are no indexed chunks at all", async () => {
    const deps = baseDeps({ loadFanoutQuestions: async () => ["a question"], readChunks: async () => [] });
    const report = await buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", deps);
    expect(report.questions).toEqual([]);
  });

  it("drops a question whose embedding failed rather than fabricating a rank", async () => {
    const deps = baseDeps({
      loadFanoutQuestions: async () => ["question one", "question two"],
      readChunks: async () => [{ source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "x", embedding: [1, 0] }],
      // Simulate a partial failure: return an empty (malformed) vector for "question two"
      // specifically - embedChunks treats an empty vector as a skip, so only that question
      // should be dropped from the final report.
      embed: async (inputs: string[]) => ({
        vectors: inputs.map((q) => (q === "question two" ? [] : [1, 0])),
      }),
    });
    const report = await buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", deps);
    expect(report.questions).toHaveLength(1);
    expect(report.questions[0].question).toBe("question one");
  });

  it("never throws even when every dependency rejects", async () => {
    const deps = baseDeps({
      loadFanoutQuestions: async () => {
        throw new Error("boom");
      },
      loadGscQuestions: async () => {
        throw new Error("boom");
      },
    });
    await expect(buildCitationLikelihoodReport("tenant-x", "https://iranopedia.com/nowruz", deps)).resolves.toEqual({
      pageUrl: "https://iranopedia.com/nowruz",
      questions: [],
    });
  });
});
