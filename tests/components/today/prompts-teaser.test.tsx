import { describe, it, expect } from "vitest";
import { buildSummarySentence } from "@/components/today/prompts-teaser";

describe("buildSummarySentence", () => {
  it("leads with winning when all prompts are winning", () => {
    const s = buildSummarySentence({
      outranked: 0,
      absent: 0,
      close: 0,
      winning: 42,
      early: 0,
      total: 42,
    });
    expect(s).toBe("Winning on 42 of 42 tracked prompts.");
  });

  it("mixes winning + weak when both exist, mentions close when present", () => {
    const s = buildSummarySentence({
      outranked: 11,
      absent: 41,
      close: 6,
      winning: 42,
      early: 0,
      total: 100,
    });
    expect(s).toBe("Winning 42, weak on 52 · 6 close to breaking through.");
  });

  it("reports only weakness when no winning", () => {
    const s = buildSummarySentence({
      outranked: 3,
      absent: 2,
      close: 1,
      winning: 0,
      early: 0,
      total: 6,
    });
    expect(s).toBe("Weak on 5 of 6 tracked prompts · 1 close to breaking through.");
  });

  it("handles too-early (all early) with a poll-explainer sentence", () => {
    const s = buildSummarySentence({
      outranked: 0,
      absent: 0,
      close: 0,
      winning: 0,
      early: 100,
      total: 100,
    });
    expect(s).toMatch(/Too early/);
    expect(s).toMatch(/10:00 UTC/);
  });

  it("handles zero total gracefully", () => {
    const s = buildSummarySentence({
      outranked: 0,
      absent: 0,
      close: 0,
      winning: 0,
      early: 0,
      total: 0,
    });
    expect(s).toBe("No prompts tracked yet.");
  });

  it("uses singular form for weak=1", () => {
    const s = buildSummarySentence({
      outranked: 1,
      absent: 0,
      close: 0,
      winning: 10,
      early: 0,
      total: 11,
    });
    expect(s).toContain("weak on 1 prompt");
  });
});
