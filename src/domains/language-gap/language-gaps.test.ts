/**
 * language-gaps tests (2026-07-02, master plan item 24) - the matrix join:
 * per-page query demand (classified by script/language) vs page content
 * language, and the two gap kinds it can emit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findContentLanguageGap,
  findVariantSpellingGap,
  buildLanguageGaps,
  MIN_IMPRESSIONS_FOR_CONTENT_GAP,
  MIN_IMPRESSIONS_FOR_VARIANT_GAP,
} from "./language-gaps";
import type { PageLanguageProfile } from "./page-language";

const englishProfile: PageLanguageProfile = { page: "/x", hasFarsiContent: false, farsiRatio: 0, lettersSampled: 500 };
const farsiProfile: PageLanguageProfile = { page: "/x", hasFarsiContent: true, farsiRatio: 0.6, lettersSampled: 500 };

describe("findContentLanguageGap", () => {
  it("finds a gap when Farsi-script demand lands on an English-only page", () => {
    const gap = findContentLanguageGap(
      "/chaharshanbe-soori",
      [
        { query: "چهارشنبه سوری", impressions: 600, clicks: 10 },
        { query: "chaharshanbe soori", impressions: 300, clicks: 5 },
      ],
      englishProfile,
      { knownLatinRoots: ["chaharshanbe"] },
    );
    expect(gap).not.toBeNull();
    expect(gap!.gapKind).toBe("farsi_demand_no_farsi_content");
    expect(gap!.impressions).toBe(900);
    expect(gap!.sentence).toContain("900");
    expect(gap!.sentence).toContain("typed in another script");
  });

  it("still finds a gap on Farsi-script impressions alone, without a known-roots hint", () => {
    const gap = findContentLanguageGap(
      "/x",
      [{ query: "چهارشنبه سوری", impressions: 600, clicks: 10 }],
      englishProfile,
    );
    expect(gap).not.toBeNull();
    expect(gap!.impressions).toBe(600);
  });

  it("returns null when the page already has Farsi content", () => {
    const gap = findContentLanguageGap("/x", [{ query: "چهارشنبه سوری", impressions: 900, clicks: 10 }], farsiProfile);
    expect(gap).toBeNull();
  });

  it("returns null when Farsi-script impressions do not clear the floor", () => {
    const gap = findContentLanguageGap(
      "/x",
      [{ query: "چهارشنبه سوری", impressions: MIN_IMPRESSIONS_FOR_CONTENT_GAP - 1, clicks: 0 }],
      englishProfile,
    );
    expect(gap).toBeNull();
  });

  it("returns null when no page profile is known (never fabricate a gap on unknown content)", () => {
    const gap = findContentLanguageGap("/x", [{ query: "چهارشنبه سوری", impressions: 900, clicks: 0 }], undefined);
    expect(gap).toBeNull();
  });

  it("ignores plain-English queries when summing the gap's impressions", () => {
    const gap = findContentLanguageGap(
      "/x",
      [
        { query: "best restaurants near me", impressions: 5000, clicks: 200 },
        { query: "چهارشنبه سوری", impressions: 200, clicks: 5 },
      ],
      englishProfile,
    );
    expect(gap).not.toBeNull();
    expect(gap!.impressions).toBe(200);
  });

  it("counts confident Finglish impressions toward the gap too", () => {
    const gap = findContentLanguageGap(
      "/x",
      [{ query: "4shanbe soori", impressions: 200, clicks: 5 }],
      englishProfile,
    );
    expect(gap).not.toBeNull();
    expect(gap!.gapKind).toBe("farsi_demand_no_farsi_content");
  });

  it("names up to 3 example spellings, biggest first", () => {
    const gap = findContentLanguageGap(
      "/x",
      [
        { query: "چهارشنبه سوری", impressions: 100, clicks: 0 },
        { query: "چهارشنبه‌سوری", impressions: 500, clicks: 0 },
        { query: "جشن آتش", impressions: 50, clicks: 0 },
      ],
      englishProfile,
    );
    expect(gap!.topVariants[0]).toBe("چهارشنبه‌سوری");
    expect(gap!.topVariants.length).toBeLessThanOrEqual(3);
  });
});

describe("findVariantSpellingGap", () => {
  const mentionsOnlyMainSpelling = (v: string) => v === "chaharshanbe soori";

  it("finds a gap when a Farsi-content page is missing high-impression spellings", () => {
    const gap = findVariantSpellingGap(
      "/chaharshanbe-soori",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 20 },
        { query: "chaharshanbeh suri", impressions: 300, clicks: 12 },
        { query: "4shanbe soori", impressions: 150, clicks: 5 },
      ],
      farsiProfile,
      mentionsOnlyMainSpelling,
    );
    expect(gap).not.toBeNull();
    expect(gap!.gapKind).toBe("missing_variant_spellings");
    expect(gap!.impressions).toBe(300 + 150);
    expect(gap!.topVariants).toContain("chaharshanbeh suri");
  });

  it("returns null when the page has no Farsi content at all (gap 1 owns that case)", () => {
    const gap = findVariantSpellingGap(
      "/x",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
        { query: "chaharshanbeh suri", impressions: 300, clicks: 0 },
      ],
      englishProfile,
      mentionsOnlyMainSpelling,
    );
    expect(gap).toBeNull();
  });

  it("returns null when every spelling is already mentioned", () => {
    const gap = findVariantSpellingGap(
      "/x",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
        { query: "chaharshanbeh suri", impressions: 300, clicks: 0 },
      ],
      farsiProfile,
      () => true,
    );
    expect(gap).toBeNull();
  });

  it("returns null when there is no real variant family (single spelling only)", () => {
    const gap = findVariantSpellingGap("/x", [{ query: "chaharshanbe soori", impressions: 900, clicks: 0 }], farsiProfile, () => false);
    expect(gap).toBeNull();
  });

  it("returns null when missed impressions do not clear the floor", () => {
    const gap = findVariantSpellingGap(
      "/x",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
        { query: "chaharshanbeh suri", impressions: MIN_IMPRESSIONS_FOR_VARIANT_GAP - 1, clicks: 0 },
      ],
      farsiProfile,
      mentionsOnlyMainSpelling,
    );
    expect(gap).toBeNull();
  });

  it("picks the biggest missed family when multiple clusters exist on one page", () => {
    const gap = findVariantSpellingGap(
      "/x",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
        { query: "chaharshanbeh suri", impressions: 300, clicks: 0 }, // missed, 300
        { query: "norooz", impressions: 40, clicks: 0 },
        { query: "norouz", impressions: 35, clicks: 0 }, // missed, 35 (smaller family)
      ],
      farsiProfile,
      (v) => v === "chaharshanbe soori" || v === "norooz",
    );
    expect(gap).not.toBeNull();
    expect(gap!.topVariants).toContain("chaharshanbeh suri");
    expect(gap!.impressions).toBe(300);
  });
});

describe("buildLanguageGaps (full matrix)", () => {
  it("joins multiple pages, one finding per page, ranked biggest first", () => {
    const gaps = buildLanguageGaps({
      queriesByPage: new Map([
        ["/no-content", [{ query: "چهارشنبه سوری", impressions: 900, clicks: 0 }]],
        ["/has-content-missing-spellings", [
          { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
          { query: "chaharshanbeh suri", impressions: 300, clicks: 0 },
        ]],
        ["/fully-covered", [{ query: "chaharshanbe soori", impressions: 900, clicks: 0 }]],
      ]),
      pageProfiles: new Map([
        ["/no-content", englishProfile],
        ["/has-content-missing-spellings", farsiProfile],
        ["/fully-covered", farsiProfile],
      ]),
      pageMentionsVariant: (page, variant) => {
        if (page === "/fully-covered") return true;
        return variant === "chaharshanbe soori";
      },
    });
    expect(gaps.length).toBe(2);
    expect(gaps[0]!.page).toBe("/no-content"); // 900 > 300
    expect(gaps[0]!.gapKind).toBe("farsi_demand_no_farsi_content");
    expect(gaps[1]!.page).toBe("/has-content-missing-spellings");
    expect(gaps[1]!.gapKind).toBe("missing_variant_spellings");
  });

  it("returns an empty array when nothing qualifies", () => {
    const gaps = buildLanguageGaps({
      queriesByPage: new Map([["/x", [{ query: "best restaurants", impressions: 100, clicks: 0 }]]]),
      pageProfiles: new Map([["/x", englishProfile]]),
      pageMentionsVariant: () => true,
    });
    expect(gaps).toEqual([]);
  });

  it("never mutates the input maps", () => {
    const queriesByPage = new Map([["/x", [{ query: "چهارشنبه سوری", impressions: 900, clicks: 0 }]]]);
    const pageProfiles = new Map([["/x", englishProfile]]);
    const before = JSON.stringify([...queriesByPage.entries()]);
    buildLanguageGaps({ queriesByPage, pageProfiles, pageMentionsVariant: () => false });
    expect(JSON.stringify([...queriesByPage.entries()])).toBe(before);
  });
});

describe("language-gaps dash guard", () => {
  it("emits no em or en dashes in any generated sentence", () => {
    const gap1 = findContentLanguageGap("/x", [{ query: "چهارشنبه سوری", impressions: 900, clicks: 0 }], englishProfile);
    const gap2 = findVariantSpellingGap(
      "/x",
      [
        { query: "chaharshanbe soori", impressions: 400, clicks: 0 },
        { query: "chaharshanbeh suri", impressions: 300, clicks: 0 },
      ],
      farsiProfile,
      (v) => v === "chaharshanbe soori",
    );
    for (const g of [gap1, gap2]) {
      expect(g!.sentence).not.toMatch(/[–—]/);
    }
  });

  it("keeps the source file free of em and en dashes (hard rule)", () => {
    const src = readFileSync(resolve(__dirname, "language-gaps.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
