/**
 * Author / reviewer byline detector tests (BEACON 500 P10, 2026-07-03).
 *
 * Covers: fires on a guide-shaped page with no author; EMPTY when Person schema
 * is present; EMPTY when a visible byline is present; no fire on a non-guide
 * page; EMPTY when extraction uncertain; byline-shape detection (positive +
 * negative); cap.
 */

import { describe, expect, it } from "vitest";

import {
  classifyAuthorGaps,
  hasVisibleByline,
  schemaHasPerson,
  MAX_AUTHOR_PAGES,
} from "@/domains/entity/eeat-author";
import type { AuthorPageInput } from "@/domains/entity/eeat-types";

function page(over: Partial<AuthorPageInput> = {}): AuthorPageInput {
  return {
    url: "https://iranopedia.com/nowruz-guide",
    schemaTypes: ["Article"],
    extractionCertain: true,
    hasAuthorSignal: false,
    isGuideShaped: true,
    fetchedAt: "2026-07-03T00:00:00Z",
    ...over,
  };
}

describe("classifyAuthorGaps", () => {
  it("fires on a guide-shaped content page with no named author", () => {
    const gaps = classifyAuthorGaps([page()]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.url).toBe("https://iranopedia.com/nowruz-guide");
  });

  it("EMPTY when the page already has an author signal (Person schema or byline)", () => {
    expect(classifyAuthorGaps([page({ hasAuthorSignal: true })])).toEqual([]);
  });

  it("EMPTY when the page is not guide-shaped (a store item / bare list)", () => {
    expect(classifyAuthorGaps([page({ isGuideShaped: false })])).toEqual([]);
  });

  it("EMPTY when extraction was uncertain", () => {
    expect(classifyAuthorGaps([page({ extractionCertain: false })])).toEqual([]);
  });

  it("EMPTY input -> EMPTY output", () => {
    expect(classifyAuthorGaps([])).toEqual([]);
  });

  it("caps the number of author-byline cards", () => {
    const pages: AuthorPageInput[] = [];
    for (let i = 0; i < MAX_AUTHOR_PAGES + 4; i++) {
      pages.push(page({ url: `https://iranopedia.com/g${i}` }));
    }
    expect(classifyAuthorGaps(pages)).toHaveLength(MAX_AUTHOR_PAGES);
  });
});

describe("hasVisibleByline", () => {
  it("detects a plain 'By <Name>' byline", () => {
    expect(hasVisibleByline("By Jane Smith. Nowruz is the Persian new year.")).toBe(true);
  });

  it("detects 'Written by' / 'Reviewed by' / 'Author:' phrasings", () => {
    expect(hasVisibleByline("Written by Dr. Reza Ahmadi")).toBe(true);
    expect(hasVisibleByline("Reviewed by Sara Karimi, historian")).toBe(true);
    expect(hasVisibleByline("Author: Ali Hosseini")).toBe(true);
  });

  it("does NOT match a generic preposition or step phrasing", () => {
    expect(hasVisibleByline("Made by hand in Isfahan over many months.")).toBe(false);
    expect(hasVisibleByline("Follow the recipe step by step for best results.")).toBe(false);
    expect(hasVisibleByline("")).toBe(false);
    expect(hasVisibleByline(null)).toBe(false);
  });
});

describe("schemaHasPerson", () => {
  it("is true when a Person type is present (case-insensitive)", () => {
    expect(schemaHasPerson(["Article", "person"])).toBe(true);
    expect(schemaHasPerson(["Article", "Person"])).toBe(true);
  });
  it("is false when no Person type is present", () => {
    expect(schemaHasPerson(["Article", "BreadcrumbList"])).toBe(false);
    expect(schemaHasPerson([])).toBe(false);
  });
});
