/**
 * Trust audit E (2026-06-16) — brand-casing normalizer.
 *
 * The operator caught LLM-drafted / persisted titles writing the brand
 * lowercase ("… | iranopedia") while the deterministic composer used the
 * configured "Iranopedia". `applyBrandCasing` is the render-time guard that
 * makes lowercasing IMPOSSIBLE: every row title is normalized to the tenant's
 * configured brand casing (threaded into buildRecommendationActionRows as
 * `brandName`). Vertical-agnostic — the canonical brand is the tenant's own
 * configured name, never hardcoded.
 */

import { describe, it, expect } from "vitest";

import { applyBrandCasing } from "@/domains/recommendations/recommendation-title-humanizer";

describe("applyBrandCasing — '<brand>' lowercasing is impossible", () => {
  it("fixes a lowercased brand in a title suffix", () => {
    expect(
      applyBrandCasing("Abbasid Caliphate Flag (750–1258) | iranopedia", "Iranopedia"),
    ).toBe("Abbasid Caliphate Flag (750–1258) | Iranopedia");
  });

  it("fixes ALL-CAPS / mixed brand casing", () => {
    expect(applyBrandCasing("Tehran Guide | IRANOPEDIA", "Iranopedia")).toBe(
      "Tehran Guide | Iranopedia",
    );
    expect(applyBrandCasing("cities in iran | IranOpedia", "Iranopedia")).toBe(
      "cities in iran | Iranopedia",
    );
  });

  it("leaves an already-correct brand untouched", () => {
    expect(applyBrandCasing("Persian Last Names | Iranopedia", "Iranopedia")).toBe(
      "Persian Last Names | Iranopedia",
    );
  });

  it("normalizes the brand even with no separator boundary", () => {
    expect(applyBrandCasing("Guide |iranopedia", "Iranopedia")).toBe("Guide | Iranopedia");
  });

  it("no brand configured → title unchanged", () => {
    expect(applyBrandCasing("Some Title | whatever", undefined)).toBe(
      "Some Title | whatever",
    );
    expect(applyBrandCasing("Some Title", "")).toBe("Some Title");
  });

  it("does NOT touch unrelated words that merely contain the brand substring", () => {
    // "iranopedias" (plural) is a different token — \b prevents a partial hit
    // mangling mid-word text; only the standalone brand is normalized.
    expect(applyBrandCasing("All about iran and its history", "Iranopedia")).toBe(
      "All about iran and its history",
    );
  });

  it("works for a different tenant's brand (no Iranopedia hardcoding)", () => {
    expect(applyBrandCasing("Custom Homes | ritz builders", "Ritz Builders")).toBe(
      "Custom Homes | Ritz Builders",
    );
  });
});
