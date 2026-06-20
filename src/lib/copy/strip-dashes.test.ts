import { describe, expect, it } from "vitest";
import { hasBannedDash, stripBannedDashes } from "./strip-dashes";

describe("stripBannedDashes — the hard no-em-dash rule", () => {
  it("turns a spaced em dash (clause separator) into a comma", () => {
    expect(stripBannedDashes("ranked by population — Tehran, Mashhad and more")).toBe(
      "ranked by population, Tehran, Mashhad and more",
    );
  });

  it("turns a spaced en dash into a comma too", () => {
    expect(stripBannedDashes("A – B")).toBe("A, B");
  });

  it("turns an UNSPACED dash (range/compound) into a hyphen", () => {
    expect(stripBannedDashes("10–20")).toBe("10-20");
    expect(stripBannedDashes("pre—post")).toBe("pre-post");
  });

  it("handles multiple dashes in one string", () => {
    expect(
      stripBannedDashes("biggest cities in Iran — ranked by population — with a map"),
    ).toBe("biggest cities in Iran, ranked by population, with a map");
  });

  it("leaves clean copy untouched", () => {
    const clean = "Biggest Cities in Iran: Top 15 by Population, Ranked + Map";
    expect(stripBannedDashes(clean)).toBe(clean);
  });

  it("never returns a string that still contains a banned dash", () => {
    const inputs = [
      "a — b – c ― d ‒ e",
      "ranked by population — Tehran",
      "10–20 items",
      "trailing —",
      "— leading",
    ];
    for (const s of inputs) {
      expect(hasBannedDash(stripBannedDashes(s))).toBe(false);
    }
  });

  it("handles null/undefined/empty", () => {
    expect(stripBannedDashes(null)).toBe("");
    expect(stripBannedDashes(undefined)).toBe("");
    expect(stripBannedDashes("")).toBe("");
  });

  it("hasBannedDash detects all four banned glyphs and nothing else", () => {
    expect(hasBannedDash("em —")).toBe(true);
    expect(hasBannedDash("en –")).toBe(true);
    expect(hasBannedDash("figure ‒")).toBe(true);
    expect(hasBannedDash("bar ―")).toBe(true);
    expect(hasBannedDash("plain - hyphen")).toBe(false);
    expect(hasBannedDash("no dashes here")).toBe(false);
  });
});
