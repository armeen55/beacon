import { describe, it, expect } from "vitest";
import { draftAltText } from "./draft-alt-text";

describe("draftAltText - deterministic, grounded, never invents", () => {
  it("derives a sentence-case phrase from a descriptive filename", () => {
    const alt = draftAltText({
      src: "https://x.com/img/persian-koobideh-kabob.jpg",
      h1: null,
      pageTitle: null,
    });
    expect(alt).toBe("Persian koobideh kabob");
  });

  it("handles underscores, camelCase, and query strings in the filename", () => {
    expect(
      draftAltText({
        src: "https://x.com/media/nowruz_haft_sin_table.png?w=800",
        h1: null,
        pageTitle: null,
      }),
    ).toBe("Nowruz haft sin table");
    // Sentence-case by design (first word capitalized, rest lower) so a
    // filename-derived phrase reads like a caption, not a headline.
    expect(
      draftAltText({
        src: "https://x.com/persianTeaCeremony.webp",
        h1: null,
        pageTitle: null,
      }),
    ).toBe("Persian tea ceremony");
  });

  it("falls back to the H1 when the filename is generic (IMG_1234, hero, hashes)", () => {
    expect(
      draftAltText({
        src: "https://x.com/IMG_1234.jpg",
        h1: "Persian Saffron Rice",
        pageTitle: "Recipes | Iranopedia",
      }),
    ).toBe("Persian Saffron Rice");
    expect(
      draftAltText({
        src: "https://x.com/hero-banner-2048x1024.jpg",
        h1: "Tehran Skyline",
        pageTitle: null,
      }),
    ).toBe("Tehran Skyline");
  });

  it("falls back to the page title (stripping a site-name suffix) when no H1", () => {
    expect(
      draftAltText({
        src: "https://x.com/photo.jpg",
        h1: null,
        pageTitle: "Persian Food Guide | Iranopedia",
      }),
    ).toBe("Persian Food Guide");
  });

  it("falls back to the top search query as a last grounded resort", () => {
    expect(
      draftAltText({
        src: "https://x.com/DSC00001.jpg",
        h1: null,
        pageTitle: null,
        topQuery: "chelo kabob",
      }),
    ).toBe("Chelo kabob");
  });

  it("returns null when nothing is grounded (never invents an alt)", () => {
    expect(
      draftAltText({
        src: "https://x.com/IMG_0001.jpg",
        h1: null,
        pageTitle: null,
        topQuery: null,
      }),
    ).toBeNull();
  });

  it("is deterministic: same input yields the same output", () => {
    const ctx = {
      src: "https://x.com/img/isfahan-blue-mosque.jpg",
      h1: "Isfahan",
      pageTitle: null,
    };
    expect(draftAltText(ctx)).toBe(draftAltText(ctx));
    expect(draftAltText(ctx)).toBe("Isfahan blue mosque");
  });

  it("clamps very long derived phrases to a caption length", () => {
    const alt = draftAltText({
      src: "https://x.com/one-two-three-four-five-six-seven-eight-nine-ten-eleven-twelve-thirteen-fourteen.jpg",
      h1: null,
      pageTitle: null,
    });
    expect(alt).not.toBeNull();
    expect(alt!.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(alt!.length).toBeLessThanOrEqual(100);
  });
});
