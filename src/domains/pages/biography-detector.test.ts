import { describe, it, expect } from "vitest";
import {
  detectBiographyPage,
  looksLikePersonName,
} from "./biography-detector";
import type { PageSnapshot } from "./types";

// Minimal snapshot factory, only the fields the detector reads. Neutral,
// invented fixtures (no real public figures), per the slice's fixture rule.
function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    schema_types: [],
    body_paragraph_sample: [],
    ...partial,
  } as PageSnapshot;
}

describe("looksLikePersonName (title shape, no name dictionary)", () => {
  it("accepts a plain two-word Title-Case name", () => {
    expect(looksLikePersonName("Jonas Kettering")).toBe(true);
  });

  it("accepts a hyphenated / apostrophe first name and a connector particle", () => {
    expect(looksLikePersonName("Jean-Paul de Vries")).toBe(true);
    expect(looksLikePersonName("Marta O'Reilly")).toBe(true);
  });

  it("rejects a topic phrase starting with a generic leading word", () => {
    expect(looksLikePersonName("Best Persian Restaurants")).toBe(false);
    expect(looksLikePersonName("How Rugs Are Made")).toBe(false);
    expect(looksLikePersonName("Top 10 Films")).toBe(false);
    expect(looksLikePersonName("The History Of Tehran")).toBe(false);
  });

  it("rejects titles with digits, colons, or list punctuation", () => {
    expect(looksLikePersonName("Nowruz 2026 Guide")).toBe(false);
    expect(looksLikePersonName("Chaharshanbe Suri: A Guide")).toBe(false);
    expect(looksLikePersonName("Rice, Bread, and Stew")).toBe(false);
  });

  it("rejects single-word or overly long (6+) token titles", () => {
    expect(looksLikePersonName("Persepolis")).toBe(false);
    expect(
      looksLikePersonName("A Very Long Title About Many Things Indeed"),
    ).toBe(false);
  });

  it("strips a trailing site-name suffix before testing shape", () => {
    expect(looksLikePersonName("Jonas Kettering - Example Site")).toBe(true);
    expect(looksLikePersonName("Jonas Kettering | Example Site")).toBe(true);
  });
});

describe("detectBiographyPage, negative cases", () => {
  it("returns isBiography=false when there is no title/H1 at all", () => {
    const result = detectBiographyPage(snap({ title: null, h1: null }));
    expect(result.isBiography).toBe(false);
    expect(result.extracted).toBeNull();
  });

  it("returns isBiography=false for a topic page (not a person-shaped title)", () => {
    const result = detectBiographyPage(
      snap({
        title: "Best Persian Restaurants in Washington",
        h1: "Best Persian Restaurants in Washington",
        body_paragraph_sample: [
          "Washington has a thriving Persian food scene with dozens of restaurants.",
        ],
      }),
    );
    expect(result.isBiography).toBe(false);
    expect(result.confidence).toBe("none");
  });

  it("returns isBiography=false for a leading-generic-word title", () => {
    const result = detectBiographyPage(
      snap({ title: "How Persian Rugs Are Made", h1: "How Persian Rugs Are Made" }),
    );
    expect(result.isBiography).toBe(false);
  });

  // Ground-truth regressions (2026-07-02), real false positives found
  // running the detector against a live content tenant's page snapshots,
  // each now fixed in the detector itself.

  it("ground-truth: a Product-schema page never classifies as biography, even with a name-shaped title and an 'is a' sentence", () => {
    const result = detectBiographyPage(
      snap({
        title: "Iran Map Hoodie",
        h1: "Iran Map Hoodie",
        schema_types: ["Product"],
        body_paragraph_sample: [
          "The Iran Map Hoodie is a must-have piece for any Persian pride collection.",
        ],
      }),
    );
    expect(result.isBiography).toBe(false);
  });

  it("ground-truth: a wildlife/species reference page ('X is a powerful bird') is NOT a biography, occupation must be a human role", () => {
    const result = detectBiographyPage(
      snap({
        title: "Booted Eagle",
        h1: "Booted Eagle",
        body_paragraph_sample: [
          "The Persian booted eagle is a powerful bird of prey found within Iran's diverse wildlife.",
        ],
      }),
    );
    expect(result.isBiography).toBe(false);
  });

  it("ground-truth: a multi-person roundup page's repeated 'Born ...' entries never produce a fabricated single lifespan", () => {
    const result = detectBiographyPage(
      snap({
        title: "Famous Iranian Scientists",
        h1: "Famous Iranian Scientists",
        body_paragraph_sample: [
          "Field: Genetics. Age: Born December 25, 1975.",
          "Field: Astronomy. Age: Born November 9, 1920, Died March 4, 2011.",
        ],
      }),
    );
    expect(result.isBiography).toBe(false);
  });
});

describe("detectBiographyPage, positive cases, confidence tiers", () => {
  it("high confidence: name-shaped title + birth/death parenthetical + occupation phrasing", () => {
    const result = detectBiographyPage(
      snap({
        title: "Jonas Kettering",
        h1: "Jonas Kettering",
        meta_description:
          "Jonas Kettering (1904-1978) was a Finglish-era poet known for his court odes.",
        body_paragraph_sample: [
          "Jonas Kettering (1904-1978) was a poet who wrote extensively about the changing seasons.",
        ],
      }),
    );
    expect(result.isBiography).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.extracted).toEqual({
      name: "Jonas Kettering",
      birthDate: "1904",
      deathDate: "1978",
      occupation: "poet",
    });
    expect(result.signals).toContain("title_shape=person_name");
    expect(result.signals).toContain("body_signal=birth_or_death_date");
    expect(result.signals).toContain("body_signal=occupation_phrasing");
  });

  it("high confidence: 'born <year>' phrasing without a full lifespan parenthetical", () => {
    const result = detectBiographyPage(
      snap({
        title: "Amara Vosgerchian",
        h1: "Amara Vosgerchian",
        body_paragraph_sample: [
          "Amara Vosgerchian was born in 1932. She was a celebrated ceramicist known for her glazed vases.",
        ],
      }),
    );
    expect(result.isBiography).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.extracted?.birthDate).toBe("1932");
    // Occupation extraction only recognizes the subject's OWN name (or its
    // first token) as the sentence subject, not a later pronoun reference.
    // This is deliberately conservative, so this field stays null even though
    // a human reader can tell "She" refers to Amara. The birth-date signal
    // alone already earns "high" confidence.
    expect(result.extracted?.occupation).toBeNull();
  });

  it("high confidence from occupation phrasing alone (no date found)", () => {
    const result = detectBiographyPage(
      snap({
        title: "Farid Alamdari",
        h1: "Farid Alamdari",
        body_paragraph_sample: [
          "Farid Alamdari is a filmmaker whose documentaries focus on rural life.",
        ],
      }),
    );
    expect(result.isBiography).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.extracted?.occupation).toBe("filmmaker");
    expect(result.extracted?.birthDate).toBeNull();
  });

  it("name-shaped title with NO corroborating body signal is NOT classified as biography", () => {
    // Ground-truth finding (2026-07-02): a real content tenant's snapshots
    // showed plenty of Title-Case 2-4 word product/place/wildlife names
    // that pass a naive name-shape test with nothing in the title alone to
    // rule them out. Requiring corroboration is the fix: title shape by
    // itself is deliberately NOT enough to call a page a biography.
    const result = detectBiographyPage(
      snap({
        title: "Reza Tabatabaei",
        h1: "Reza Tabatabaei",
        body_paragraph_sample: [
          "This page has not been filled in with any further detail yet.",
        ],
      }),
    );
    expect(result.isBiography).toBe(false);
    expect(result.confidence).toBe("none");
    expect(result.extracted).toBeNull();
  });

  it("a bare name-shaped title with NO body text at all is NOT classified as biography (never guesses)", () => {
    const result = detectBiographyPage(
      snap({ title: "Leila Farahani", h1: "Leila Farahani" }),
    );
    expect(result.isBiography).toBe(false);
    expect(result.extracted).toBeNull();
  });

  it("notes existing Person schema in signals without changing detection", () => {
    const result = detectBiographyPage(
      snap({
        title: "Jonas Kettering",
        h1: "Jonas Kettering",
        schema_types: ["Person", "Article"],
        body_paragraph_sample: ["Jonas Kettering was a poet."],
      }),
    );
    expect(result.isBiography).toBe(true);
    expect(result.signals).toContain("existing_schema=Person");
  });
});
