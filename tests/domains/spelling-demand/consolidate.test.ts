/**
 * consolidate-spelling-demand tests (P20, v1 129).
 *
 * Pins the consolidation math across variant groups, the NO-OP / byte-identical
 * behavior when config is absent, empty-safety, and script-agnosticism.
 */

import { describe, expect, it } from "vitest";

import {
  consolidateSpellingDemand,
  normalizeSpelling,
} from "@/domains/spelling-demand/consolidate";
import type { SpellingVariantGroup } from "@/domains/spelling-demand/types";

const SAFFRON: SpellingVariantGroup = {
  canonical: "saffron",
  variants: ["safron", "zafran", "saffran"],
};

describe("normalizeSpelling", () => {
  it("lower-cases, trims, and collapses whitespace", () => {
    expect(normalizeSpelling("  Saffron   Threads ")).toBe("saffron threads");
  });

  it("preserves non-Latin scripts exactly (script-agnostic)", () => {
    // A Cyrillic + an Arabic-script term are only lower-cased/trimmed, never
    // transliterated or stripped.
    expect(normalizeSpelling("  Шафран ")).toBe("шафран");
    expect(normalizeSpelling("زعفران")).toBe("زعفران");
  });
});

describe("consolidateSpellingDemand — no-op guards", () => {
  it("returns empty when no groups configured (the byte-identical no-op)", () => {
    const res = consolidateSpellingDemand({
      groups: [],
      demand: [
        { term: "saffron", demand: 500 },
        { term: "safron", demand: 300 },
      ],
    });
    expect(res).toEqual({ groups: [] });
  });

  it("returns empty when no demand at all", () => {
    const res = consolidateSpellingDemand({ groups: [SAFFRON], demand: [] });
    expect(res).toEqual({ groups: [] });
  });

  it("returns empty when only ONE spelling of a group carries demand", () => {
    // A lone spelling already shows its own size; nothing to consolidate.
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [{ term: "saffron", demand: 900 }],
    });
    expect(res.groups).toEqual([]);
  });

  it("skips a group whose demand never matches any declared spelling", () => {
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [
        { term: "turmeric", demand: 500 },
        { term: "cumin", demand: 400 },
      ],
    });
    expect(res.groups).toEqual([]);
  });

  it("skips a malformed group with no alternate spelling", () => {
    const res = consolidateSpellingDemand({
      groups: [{ canonical: "saffron", variants: [] }],
      demand: [{ term: "saffron", demand: 900 }],
    });
    expect(res.groups).toEqual([]);
  });
});

describe("consolidateSpellingDemand — consolidation math", () => {
  it("sums demand across spellings onto the canonical group", () => {
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [
        { term: "saffron", demand: 620 },
        { term: "safron", demand: 480 },
        { term: "zafran", demand: 300 },
        { term: "saffran", demand: 0 }, // zero demand does not count
        { term: "unrelated", demand: 9999 },
      ],
    });
    expect(res.groups).toHaveLength(1);
    const g = res.groups[0]!;
    expect(g.canonical).toBe("saffron");
    expect(g.combinedDemand).toBe(620 + 480 + 300);
    expect(g.topSpellingDemand).toBe(620);
    expect(g.spellingsWithDemand).toBe(3);
    expect(g.members.map((m) => m.term)).toEqual(["saffron", "safron", "zafran"]);
    expect(g.members.find((m) => m.term === "saffron")!.isCanonical).toBe(true);
    expect(g.members.find((m) => m.term === "safron")!.isCanonical).toBe(false);
  });

  it("matches case- and whitespace-insensitively but keeps display text", () => {
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [
        { term: "Saffron", demand: 100 },
        { term: "  SAFRON ", demand: 200 },
      ],
    });
    expect(res.groups).toHaveLength(1);
    const g = res.groups[0]!;
    expect(g.combinedDemand).toBe(300);
    // The higher-demand display term leads; original casing is preserved.
    expect(g.members[0]!.term).toBe("SAFRON");
  });

  it("collapses a duplicated demand row before summing into a group", () => {
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [
        { term: "saffron", demand: 100 },
        { term: "saffron", demand: 50 }, // same normalized term listed twice
        { term: "safron", demand: 200 },
      ],
    });
    const g = res.groups[0]!;
    // saffron 150 + safron 200 = 350; still 2 distinct spellings.
    expect(g.combinedDemand).toBe(350);
    expect(g.spellingsWithDemand).toBe(2);
  });

  it("orders multiple groups by combined demand, biggest first", () => {
    const groups: SpellingVariantGroup[] = [
      { canonical: "kebab", variants: ["kabob", "kabab"] },
      SAFFRON,
    ];
    const res = consolidateSpellingDemand({
      groups,
      demand: [
        { term: "saffron", demand: 200 },
        { term: "safron", demand: 100 }, // saffron group = 300
        { term: "kebab", demand: 5000 },
        { term: "kabob", demand: 4000 }, // kebab group = 9000
      ],
    });
    expect(res.groups.map((g) => g.canonical)).toEqual(["kebab", "saffron"]);
  });

  it("consolidates across scripts when the tenant declares them together", () => {
    // Latin canonical + a native-script variant, purely tenant-declared.
    const res = consolidateSpellingDemand({
      groups: [{ canonical: "saffron", variants: ["زعفران"] }],
      demand: [
        { term: "saffron", demand: 400 },
        { term: "زعفران", demand: 350 },
      ],
    });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.combinedDemand).toBe(750);
    expect(res.groups[0]!.spellingsWithDemand).toBe(2);
  });

  it("counts the canonical spelling itself as one of the demand-bearing spellings", () => {
    const res = consolidateSpellingDemand({
      groups: [SAFFRON],
      demand: [
        { term: "saffron", demand: 100 },
        { term: "zafran", demand: 100 },
      ],
    });
    expect(res.groups[0]!.spellingsWithDemand).toBe(2);
  });
});
