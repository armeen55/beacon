/**
 * plainRankedBy (2026-07-20) - the ranking-transparency sanitizer that turns the demand graph's
 * raw "Ranked by rank_revenue + profound + gsc + clarity + competitor_teardown." string into a
 * plain sentence with no vendor names and no snake_case slugs. Pins the exact slug ban so a raw
 * evidence-source key can never reach a rendered surface.
 */
import { describe, expect, it } from "vitest";
import { plainRankedBy, EVIDENCE_SOURCE_PLAIN } from "./plain-language";
import { hasBannedDash } from "./copy/strip-dashes";

const RAW = "Ranked by rank_revenue + profound + gsc + clarity + competitor_teardown.";

describe("plainRankedBy", () => {
  it("rewrites the full canonical string with no vendor name or slug", () => {
    const out = plainRankedBy(RAW)!;
    expect(out).not.toMatch(/rank_revenue|profound|dataforseo|competitor_teardown|clarity|gsc/i);
    expect(out).toBe(
      "Ranked by revenue impact plus AI citations, your Google search data, visitor behavior, and competitor research.",
    );
    expect(hasBannedDash(out)).toBe(false);
  });

  it("handles a single source with no vendor name", () => {
    expect(plainRankedBy("Ranked by gsc.")).toBe("Ranked by your Google search data.");
  });

  it("de-slugs an unknown source rather than leaking the raw key", () => {
    const out = plainRankedBy("Ranked by gsc + some_new_source.")!;
    expect(out).toContain("your Google search data");
    expect(out).toContain("some new source");
    expect(out).not.toContain("some_new_source");
  });

  it("returns null on empty input so callers fall back to their own copy", () => {
    expect(plainRankedBy(null)).toBeNull();
    expect(plainRankedBy("")).toBeNull();
    expect(plainRankedBy("   ")).toBeNull();
  });

  it("passes a non-'Ranked by' human sentence through unchanged", () => {
    expect(plainRankedBy("This page is fading fast.")).toBe("This page is fading fast.");
  });

  it("every mapped evidence name is plain (no vendor name, no underscore)", () => {
    for (const plain of Object.values(EVIDENCE_SOURCE_PLAIN)) {
      expect(plain).not.toMatch(/_|profound|dataforseo/i);
    }
  });
});
