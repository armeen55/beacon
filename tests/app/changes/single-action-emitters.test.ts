/**
 * Wave 3C - the three ambiguous "X or Y" emitters now emit exactly ONE directive.
 *
 *   today-declines-rows.ts  buildCannibalizationCaseRows / indexCannibalizationByUrl
 *                           ("(redirect or internal-link)" and "internal link, or differentiate")
 *   resolve-page-intent.ts  the merge reasoning ("Consolidate into X and redirect or update ...")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCannibalizationCaseRows, indexCannibalizationByUrl } from "@/app/(shell)/today-declines-rows";

const canon = (u: string) => u.toLowerCase().replace(/\/$/, "");
const pretty = (u: string) => u.split("/").pop() || u;
const cu = (url: string, clicks: number) => ({ url, clicks, impressions: 500, position: 4 });

// The banned two-action fork: an action verb, " or ", another action word.
const NO_FORK = /\b(redirect|edit|create|merge|link|differentiate|update|fold|consolidate|build)\s+or\s+(a|an|the|internal|redirect|update|differentiate|link|edit|create|build|merge)\b/i;
const BANNED_DASH = /[‒–—―]/;

describe("today-declines-rows - buildCannibalizationCaseRows emits ONE action", () => {
  it("live followers get 'fold with an internal link', never a redirect-or-link fork", () => {
    const rows = buildCannibalizationCaseRows(
      [{ query: "iran flag", competingUrls: [cu("https://x/iran-flag", 200), cu("https://x/pahlavi-flag", 60)] }],
      canon,
      pretty,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fix).toContain("fold");
    expect(rows[0]!.fix).toContain("internal link");
    expect(rows[0]!.decision).toBe("edit_existing");
    expect(NO_FORK.test(rows[0]!.fix)).toBe(false);
    expect(BANNED_DASH.test(rows[0]!.fix)).toBe(false);
  });

  it("dead followers get 'fold with a redirect', a single decided action", () => {
    const rows = buildCannibalizationCaseRows(
      [{ query: "iran flag", competingUrls: [cu("https://x/iran-flag", 200), cu("https://x/dead-flag", 0)] }],
      canon,
      pretty,
    );
    expect(rows[0]!.fix).toContain("redirect");
    expect(rows[0]!.decision).toBe("prune_redirect");
    expect(NO_FORK.test(rows[0]!.fix)).toBe(false);
    expect(BANNED_DASH.test(rows[0]!.fix)).toBe(false);
  });
});

describe("today-declines-rows - indexCannibalizationByUrl emits ONE action per case", () => {
  const idx = indexCannibalizationByUrl(
    [{ query: "iran flag", competingUrls: [cu("https://x/iran-flag", 200), cu("https://x/pahlavi-flag", 60)], leadUrl: "https://x/iran-flag" }] as never,
    canon,
    pretty,
  );
  it("the lead fix folds the others in with no fork", () => {
    const lead = idx.get("https://x/iran-flag")![0]!;
    expect(lead.fix).toContain("fold");
    expect(NO_FORK.test(lead.fix)).toBe(false);
    expect(BANNED_DASH.test(lead.fix)).toBe(false);
  });
  it("the follower fix points at the lead with one internal link, never 'link or differentiate'", () => {
    const follower = idx.get("https://x/pahlavi-flag")![0]!;
    expect(follower.fix).toContain("internal link");
    expect(follower.decision).toBe("edit_existing");
    expect(follower.fix).not.toContain("differentiate their intent");
    expect(NO_FORK.test(follower.fix)).toBe(false);
    expect(BANNED_DASH.test(follower.fix)).toBe(false);
  });
});

describe("resolve-page-intent - the merge reasoning is a single named sub-directive", () => {
  const SRC = readFileSync(resolve(__dirname, "../../../src/domains/recommendations/resolve-page-intent.ts"), "utf8");
  it("no longer offers 'redirect or update the others'", () => {
    expect(SRC).not.toContain("redirect or update");
  });
  it("consolidates, then names the single sub-directive (redirect the weaker pages)", () => {
    expect(SRC).toContain("then redirect the weaker pages to it");
  });
});
