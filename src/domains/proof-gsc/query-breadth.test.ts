import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeQueryBreadth, BROADER_MIN_EXTRA_QUERIES } from "./query-breadth";

/**
 * query-breadth.test.ts (P4 R10b, v1 item 151) - pins the reach-vs-depth
 * call: the broader floor (absolute AND fractional), the deeper fallback
 * (breadth flat, clicks up), the flat default, the honest-absence null when
 * neither window has query-grain presence, and both plain sentences.
 */

function read(over: Partial<Parameters<typeof computeQueryBreadth>[0]> = {}) {
  return computeQueryBreadth({
    beforeQueries: 40,
    afterQueries: 40,
    beforeClicks: 100,
    afterClicks: 100,
    windowDays: 28,
    ...over,
  });
}

describe("computeQueryBreadth - the broader (reach) call", () => {
  it("meaningfully more distinct searches reads broader with the reach sentence", () => {
    const r = read({ beforeQueries: 40, afterQueries: 58 });
    expect(r?.kind).toBe("broader");
    expect(r?.sentence).toBe(
      "This page now shows up for 18 more searches than before; the win is reach, not just rank.",
    );
  });

  it("the broader floor is the LARGER of 3 extra queries and 15 percent of before", () => {
    // before 40 -> fractional floor ceil(0.15 * 40) = 6, which beats the absolute 3.
    expect(read({ beforeQueries: 40, afterQueries: 45 })?.kind).not.toBe("broader"); // +5 < 6
    expect(read({ beforeQueries: 40, afterQueries: 46 })?.kind).toBe("broader"); // +6 = 6
    // before 10 -> fractional floor ceil(1.5) = 2, absolute 3 governs.
    expect(read({ beforeQueries: 10, afterQueries: 12 })?.kind).not.toBe("broader"); // +2 < 3
    expect(read({ beforeQueries: 10, afterQueries: 13 })?.kind).toBe("broader"); // +3 = 3
    expect(BROADER_MIN_EXTRA_QUERIES).toBe(3);
  });

  it("a brand-new page (0 before, real after) reads broader, not a crash", () => {
    const r = read({ beforeQueries: 0, afterQueries: 18, beforeClicks: 0, afterClicks: 30 });
    expect(r?.kind).toBe("broader");
    expect(r?.sentence).toContain("18 more searches");
  });

  it("a single extra search pluralizes honestly", () => {
    // before 1 -> floor max(3, ceil(0.15)) = 3; force the singular via the
    // sentence builder by growing exactly the floor from a tiny base... a +3
    // growth can never read "1 more search", so pin the plural path instead.
    const r = read({ beforeQueries: 1, afterQueries: 4, beforeClicks: 0, afterClicks: 0 });
    expect(r?.kind).toBe("broader");
    expect(r?.sentence).toContain("3 more searches");
  });
});

describe("computeQueryBreadth - the deeper (depth) call", () => {
  it("flat breadth with meaningful click growth reads deeper with the depth sentence", () => {
    const r = read({ beforeClicks: 100, afterClicks: 130 });
    expect(r?.kind).toBe("deeper");
    expect(r?.sentence).toBe(
      "This page shows up for about the same searches as before, but they are sending 30 more clicks; the win is depth, not reach.",
    );
  });

  it("the deeper floor is the LARGER of 3 clicks and 10 percent of before clicks", () => {
    // before 100 clicks -> fractional floor 10 beats the absolute 3.
    expect(read({ beforeClicks: 100, afterClicks: 109 })?.kind).toBe("flat"); // +9 < 10
    expect(read({ beforeClicks: 100, afterClicks: 110 })?.kind).toBe("deeper"); // +10 = 10
    // before 10 clicks -> absolute 3 governs.
    expect(read({ beforeClicks: 10, afterClicks: 12 })?.kind).toBe("flat"); // +2 < 3
    expect(read({ beforeClicks: 10, afterClicks: 13 })?.kind).toBe("deeper"); // +3 = 3
  });

  it("broader wins over deeper when both fire (reach is the stronger claim)", () => {
    const r = read({ beforeQueries: 10, afterQueries: 20, beforeClicks: 100, afterClicks: 150 });
    expect(r?.kind).toBe("broader");
  });
});

describe("computeQueryBreadth - flat and honest absence", () => {
  it("neither breadth nor depth moving reads flat with a null sentence but a real breadth line", () => {
    const r = read();
    expect(r?.kind).toBe("flat");
    expect(r?.sentence).toBeNull();
    expect(r?.breadthLine).toBe(
      "This page showed up for 40 different searches in the 28 days before the change and 40 in the 28 days after.",
    );
  });

  it("fewer searches after (breadth shrank) without click growth reads flat, never broader", () => {
    const r = read({ beforeQueries: 40, afterQueries: 30 });
    expect(r?.kind).toBe("flat");
  });

  it("no query-grain presence in EITHER window is an honest null, never a fabricated zero story", () => {
    expect(read({ beforeQueries: 0, afterQueries: 0, beforeClicks: 0, afterClicks: 0 })).toBeNull();
  });

  it("a non-positive window is a guard null", () => {
    expect(read({ windowDays: 0 })).toBeNull();
  });

  it("pluralizes the breadth line for a single search", () => {
    const r = read({ beforeQueries: 1, afterQueries: 2, beforeClicks: 0, afterClicks: 0 });
    expect(r?.breadthLine).toContain("1 different search in the");
  });
});

describe("copy guard - dash-clean, no em or en dashes", () => {
  it("query-breadth.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "query-breadth.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("every sentence and breadth line across the kinds is dash-clean and jargon-free", () => {
    const reads = [
      read({ beforeQueries: 40, afterQueries: 58 }),
      read({ beforeClicks: 100, afterClicks: 130 }),
      read(),
    ];
    for (const r of reads) {
      for (const text of [r?.sentence, r?.breadthLine]) {
        if (!text) continue;
        expect(text).not.toMatch(/[–—]/);
        expect(text.toLowerCase()).not.toMatch(/baseline|serp|experiment|control/);
      }
    }
  });
});
