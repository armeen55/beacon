import { describe, it, expect } from "vitest";
import { buildEngineGapNotes, gapPathKey } from "./candidate-feed";
import { MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT } from "./engine-types";
import { buildDailyCandidates, type GscPageInput, type PageFacts } from "@/domains/experiments/build-daily-candidates";

const gap = (promptText: string, ownedUrl: string | null) => ({
  promptText,
  citedEngines: ["perplexity" as const],
  missingEngines: ["chatgpt" as const, "gemini" as const],
  ownedUrl,
});

describe("gapPathKey", () => {
  it("normalizes to the candidate builder's path shape", () => {
    expect(gapPathKey("https://www.iranopedia.com/persian-rugs?utm_source=x#top")).toBe("/persian-rugs");
    expect(gapPathKey("https://iranopedia.com/")).toBe("/");
    expect(gapPathKey("/iran-flags/")).toBe("/iran-flags");
  });
});

describe("buildEngineGapNotes - bounded candidate-feed mapping", () => {
  it("maps gaps with an owned page to notes keyed by normalized path, plain engine names", () => {
    const notes = buildEngineGapNotes([gap("best persian rugs", "https://iranopedia.com/persian-rugs?ref=ai")]);
    const note = notes.get("/persian-rugs")!;
    expect(note.promptText).toBe("best persian rugs");
    expect(note.citedEngines).toEqual(["Perplexity"]);
    expect(note.missingEngines).toEqual(["ChatGPT", "Gemini"]);
    expect(note.sentence).toContain("Perplexity already points people at this page");
  });

  it("skips gaps without an owned page (nothing exact to strengthen)", () => {
    expect(buildEngineGapNotes([gap("no page named", null)]).size).toBe(0);
  });

  it("is bounded to a few per night and keeps one note per page", () => {
    const notes = buildEngineGapNotes([
      gap("q1", "https://x.com/a"),
      gap("q2", "https://x.com/a"), // same page - first wins
      gap("q3", "https://x.com/b"),
      gap("q4", "https://x.com/c"),
      gap("q5", "https://x.com/d"), // over the bound
    ]);
    expect(MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT).toBe(3);
    expect(notes.size).toBe(MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT);
    expect(notes.get("/a")!.promptText).toBe("q1");
    expect([...notes.keys()]).toEqual(["/a", "/b", "/c"]);
  });
});

describe("buildDailyCandidates - engine gap attachment (additive)", () => {
  const page: GscPageInput = {
    url: "https://iranopedia.com/persian-rugs",
    pageLabel: "persian rugs",
    impressions: 1200,
    clicks: 40,
    ctr: 0.033,
    position: 6,
    topQuery: "persian rugs",
    topQueryImpressions: 900,
    topQueryPosition: 6,
    topQueryCtr: 0.02,
    ownership: 0.6,
  };
  // Title with a filler lead so the deterministic title lever fires.
  const facts = new Map<string, PageFacts>([
    [page.url, { title: "Discover the Most Popular Persian Rugs", meta: "An existing description.", h1: "Persian Rugs" }],
  ]);

  it("attaches the gap and weaves the sentence into whyNow for the matching page", () => {
    const notes = buildEngineGapNotes([gap("best persian rugs", "https://iranopedia.com/persian-rugs")]);
    const built = buildDailyCandidates({
      tenantId: "tenant-iranopedia",
      pages: [page],
      facts,
      proofLedger: [],
      engineGapsByUrl: notes,
    });
    expect(built).toHaveLength(1);
    expect(built[0]!.engineGap).toEqual({
      promptText: "best persian rugs",
      citedEngines: ["Perplexity"],
      missingEngines: ["ChatGPT", "Gemini"],
    });
    expect(built[0]!.whyNow).toContain("Perplexity already points people at this page");
    expect(built[0]!.whyNow).toContain("ChatGPT and Gemini do not yet");
  });

  it("leaves non-matching pages untouched (no gap, unchanged whyNow)", () => {
    const notes = buildEngineGapNotes([gap("some other question", "https://iranopedia.com/other-page")]);
    const built = buildDailyCandidates({
      tenantId: "tenant-iranopedia",
      pages: [page],
      facts,
      proofLedger: [],
      engineGapsByUrl: notes,
    });
    expect(built).toHaveLength(1);
    expect(built[0]!.engineGap).toBeUndefined();
    expect(built[0]!.whyNow).not.toContain("aims at that gap");
  });
});
