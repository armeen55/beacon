/**
 * classify-query tests (2026-07-02, master plan item 24) - the script/language
 * classifier matrix, against real Iranopedia-shaped queries: Farsi-script,
 * Finglish, and plain English. Also the no-dash hard rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyQuery, classifyScript } from "./classify-query";
import { PERSIAN_FOLDING_TABLE } from "./variant-folding";

describe("classifyScript", () => {
  it("detects pure Farsi/Arabic script", () => {
    expect(classifyScript("چهارشنبه سوری")).toBe("arabic_fa");
    expect(classifyScript("نوروز")).toBe("arabic_fa");
  });

  it("detects pure Latin script", () => {
    expect(classifyScript("chaharshanbe soori")).toBe("latin");
    expect(classifyScript("persian new year")).toBe("latin");
  });

  it("detects mixed script (Farsi + Latin letters in one query)", () => {
    expect(classifyScript("چهارشنبه soori")).toBe("mixed");
    expect(classifyScript("نوروز TV")).toBe("mixed");
  });

  it("does not call digits alongside Farsi script mixed (digits carry no script)", () => {
    expect(classifyScript("نوروز 2026")).toBe("arabic_fa");
  });

  it("returns other for digits/punctuation only", () => {
    expect(classifyScript("2026")).toBe("other");
    expect(classifyScript("")).toBe("other");
  });
});

describe("classifyQuery - Farsi script", () => {
  it("classifies pure Farsi-script queries as fa with high confidence", () => {
    const r = classifyQuery("چهارشنبه سوری");
    expect(r.script).toBe("arabic_fa");
    expect(r.language).toBe("fa");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("classifies mixed-script queries as fa (Farsi dominates the language call)", () => {
    const r = classifyQuery("نوروز TV");
    expect(r.script).toBe("mixed");
    expect(r.language).toBe("fa");
    expect(r.confidence).toBeGreaterThan(0.7);
  });
});

describe("classifyQuery - Finglish (real transliteration examples)", () => {
  it("classifies chaharshanbe soori as finglish when matched against the known-roots list", () => {
    // "chaharshanbe soori" alone carries exactly one word-initial onset tell
    // ("ch-"), which ordinary English words share too ("cheetah", "teacher") -
    // too weak to call finglish on its own (the heuristic bar is deliberately
    // strict to avoid false-positiving on English loanwords like "khan" and
    // "ghost"). A known-roots hint (the folding table's own shipped data) is
    // what pushes a real, previously-seen romanization over the line.
    const r = classifyQuery("chaharshanbe soori", { knownLatinRoots: ["chaharshanbe"] });
    expect(r.script).toBe("latin");
    expect(r.language).toBe("finglish");
  });

  it("classifies chaharshanbeh suri as finglish when matched against the known-roots list", () => {
    const r = classifyQuery("chaharshanbeh suri", { knownLatinRoots: ["chaharshanbe"] });
    expect(r.language).toBe("finglish");
  });

  it("classifies the digit-for-word spelling 4shanbe soori as finglish on its own (near-certain tell)", () => {
    // The digit-prefix pattern (4shanbe = chahar+shanbe) is rare enough in
    // ordinary English that it counts as a near-certain tell by itself, no
    // known-roots hint required.
    const r = classifyQuery("4shanbe soori");
    expect(r.language).toBe("finglish");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("classifies khoresht gheimeh as finglish on its own (two word-initial onset tells)", () => {
    // Two independent word-initial onset tells ("kh-" + "gh-") corroborate
    // each other without needing a known-roots hint.
    const r = classifyQuery("khoresht gheimeh");
    expect(r.language).toBe("finglish");
  });

  it("classifies norooz as finglish when matched against the known-roots list", () => {
    // "norooz" alone carries exactly one soft mid-word vowel signal
    // (double-o), which common English words ("book", "moon") share too -
    // too weak to call finglish on its own. A known-roots hint (from the
    // folding table's variant family) is what pushes a short, otherwise-
    // ambiguous word over the line.
    const r = classifyQuery("norooz", { knownLatinRoots: ["norooz", "norouz", "nowruz"] });
    expect(r.language).toBe("finglish");
  });

  it("classifies nowruz as finglish when matched against the known-roots list", () => {
    // "nowruz" alone has no onset or vowel signal at all, so without a
    // known-roots hint it reads as plain English - this is exactly why
    // classifyQuery accepts an optional knownLatinRoots list from the folding
    // table's variant families.
    const r = classifyQuery("nowruz", { knownLatinRoots: ["nowruz", "norooz", "norouz"] });
    expect(r.language).toBe("finglish");
  });

  it("classifies norouz as finglish when matched against the known-roots list", () => {
    // "norouz" alone carries one soft digraph signal (the "ou" vowel pair) -
    // real, but the same conservative one-signal-is-not-enough rule applies.
    const r = classifyQuery("norouz", { knownLatinRoots: ["norouz", "norooz", "nowruz"] });
    expect(r.language).toBe("finglish");
  });

  it("classifies tahdig as finglish (double-vowel-adjacent romanization pattern via known roots)", () => {
    const r = classifyQuery("tahdig recipe", { knownLatinRoots: ["tahdig"] });
    expect(r.language).toBe("finglish");
  });
});

describe("classifyQuery - plain English", () => {
  it("classifies ordinary English queries as en", () => {
    expect(classifyQuery("best restaurants near me").language).toBe("en");
    expect(classifyQuery("how to plant tomatoes").language).toBe("en");
  });

  it("does not falsely tag every English word with a soft digraph as finglish", () => {
    // "teacher" and "school" both contain "ch" but are plainly English; one soft
    // signal alone must not tip the call to finglish.
    const r = classifyQuery("teacher salary");
    expect(r.language).toBe("en");
  });
});

describe("classifyQuery - edge cases", () => {
  it("returns unknown for empty input", () => {
    const r = classifyQuery("");
    expect(r.language).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("returns unknown for whitespace-only input", () => {
    expect(classifyQuery("   ").language).toBe("unknown");
  });

  it("never throws on garbage input", () => {
    expect(() => classifyQuery(null as unknown as string)).not.toThrow();
    expect(() => classifyQuery(undefined as unknown as string)).not.toThrow();
  });
});

describe("classify-query dash guard (hard rule)", () => {
  it("keeps the classifier and folding-table modules free of em and en dashes", () => {
    const files = ["classify-query.ts", "variant-folding.ts", "page-language.ts", "language-gaps.ts", "language-gap-hints.ts", "language-gap-store.ts", "run-language-gap-pass.ts"];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src, `${f} must not contain em or en dashes`).not.toMatch(/[–—]/);
    }
  });

  it("the folding table itself carries no dashes in its labels", () => {
    for (const rule of PERSIAN_FOLDING_TABLE) {
      expect(rule.label).not.toMatch(/[–—]/);
    }
  });
});
