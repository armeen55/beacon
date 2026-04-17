/**
 * Section Analyzer — config-driven portability tests.
 *
 * Verifies:
 * 1. Ritz config produces same behavior as old hardcoded logic
 * 2. Non-construction config produces non-construction behavior
 * 3. Universal themes work without any config
 */

import { describe, it, expect } from "vitest";
import { analyzeSectionGaps, type SectionAnalyzerConfig } from "./section-analyzer";
import type { PageSnapshot } from "@/domains/pages/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal snapshot — only fields section-analyzer actually reads (url, h2_list). */
function makeSnapshot(overrides: { url?: string; h2_list?: string[] }): PageSnapshot {
  return {
    url: overrides.url ?? "https://example.com/test",
    h2_list: overrides.h2_list ?? [],
  } as unknown as PageSnapshot;
}

// Ritz config matching the defaults in business-config.ts
const RITZ_CONFIG: SectionAnalyzerConfig = {
  urlPatterns: {
    city: "/locations/",
    service: "/services/",
    project: "/explore-projects/",
  },
  stripWords: [
    "atherton", "menlo", "park", "palo", "alto", "cupertino", "saratoga",
    "los", "altos", "hills", "emerald", "sunnyvale", "mountain", "view",
    "san", "jose", "francisco", "bay", "area", "silicon", "valley",
    "california", "ca",
    "ritz", "builders", "construction", "homes", "home", "builder",
  ],
  industryThemes: [
    { pattern: "\\bdesign\\b.*\\bbuild|\\barchitect", label: "design_build", display: "Design-build overview" },
    { pattern: "\\badu\\b|\\baccessory\\s+dwelling", label: "adu", display: "ADU section" },
    { pattern: "\\bremodel|\\brenovation", label: "remodel", display: "Remodel section" },
    { pattern: "\\bzoning|\\bpermit|\\bregulation", label: "zoning", display: "Zoning & permits" },
  ],
};

// Dental practice config — completely different industry
const DENTAL_CONFIG: SectionAnalyzerConfig = {
  urlPatterns: {
    city: "/offices/",
    service: "/treatments/",
    project: "/cases/",
  },
  stripWords: [
    "smile", "dental", "dentistry", "clinic", "dr", "doctor",
    "manhattan", "brooklyn", "queens", "bronx",
  ],
  industryThemes: [
    { pattern: "\\binsurance|\\bcoverage|\\bpayment\\s+plan", label: "insurance", display: "Insurance & payment" },
    { pattern: "\\bemergency|\\burgent", label: "emergency", display: "Emergency care" },
    { pattern: "\\bwhitening|\\bcosmetic", label: "cosmetic", display: "Cosmetic dentistry" },
  ],
};

// ---------------------------------------------------------------------------
// Page type inference
// ---------------------------------------------------------------------------

describe("inferPageType via analyzeSectionGaps", () => {
  it("classifies Ritz URL patterns with Ritz config", () => {
    // Build pages so that same-type comparison works (need ≥2 same-type + ≥2 H2s)
    const cityPages = [
      makeSnapshot({ url: "https://ritzbuilders.com/locations/atherton", h2_list: ["Our Process", "FAQ", "Cost Guide"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/locations/menlo-park", h2_list: ["Our Process", "FAQ", "Testimonials"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/locations/palo-alto", h2_list: ["Our Process", "Cost Guide"] }),
    ];
    // Target is missing FAQ
    const target = cityPages[2];
    const gaps = analyzeSectionGaps(target, cityPages, RITZ_CONFIG);
    // FAQ is on 2/2 reference pages (100%), target doesn't have it
    expect(gaps.some((g) => g.sectionLabel === "faq")).toBe(true);
  });

  it("classifies dental URL patterns with dental config", () => {
    const officePages = [
      makeSnapshot({ url: "https://smiledental.com/offices/manhattan", h2_list: ["Insurance & Payment", "FAQ", "Emergency Care"] }),
      makeSnapshot({ url: "https://smiledental.com/offices/brooklyn", h2_list: ["Insurance Info", "FAQ", "Emergency Dental"] }),
      makeSnapshot({ url: "https://smiledental.com/offices/queens", h2_list: ["FAQ"] }),
    ];
    const target = officePages[2];
    const gaps = analyzeSectionGaps(target, officePages, DENTAL_CONFIG);
    // "insurance" theme should be detected (present on 2/2 reference pages)
    expect(gaps.some((g) => g.sectionLabel === "insurance")).toBe(true);
    // "emergency" theme should be detected
    expect(gaps.some((g) => g.sectionLabel === "emergency")).toBe(true);
    // "remodel" theme should NOT exist — it's not in dental config
    expect(gaps.some((g) => g.sectionLabel === "remodel")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Strip words
// ---------------------------------------------------------------------------

describe("H2 normalization with config strip words", () => {
  it("strips Ritz city/brand words with Ritz config", () => {
    // Two reference pages with "FAQ" h2 that includes city names
    const pages = [
      makeSnapshot({ url: "https://ritzbuilders.com/services/kitchen", h2_list: ["Kitchen Remodel FAQ Atherton", "Our Process"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/services/bathroom", h2_list: ["Bathroom Remodel FAQ Menlo Park", "Our Process"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/services/addition", h2_list: ["Our Process"] }),
    ];
    const target = pages[2];
    const gaps = analyzeSectionGaps(target, pages, RITZ_CONFIG);
    // After stripping city names, both should normalize to the same "faq" + "remodel" themes
    expect(gaps.some((g) => g.sectionLabel === "faq")).toBe(true);
  });

  it("does NOT strip dental words with Ritz config", () => {
    // "dental" is not in Ritz strip words, so it stays in the normalized H2
    const pages = [
      makeSnapshot({ url: "https://example.com/services/a", h2_list: ["Dental FAQ", "Cost"] }),
      makeSnapshot({ url: "https://example.com/services/b", h2_list: ["Dental FAQ", "Cost"] }),
      makeSnapshot({ url: "https://example.com/services/c", h2_list: ["Cost"] }),
    ];
    const target = pages[2];
    const gaps = analyzeSectionGaps(target, pages, RITZ_CONFIG);
    // "faq" theme should still be detected (the word "faq" is in universal themes)
    expect(gaps.some((g) => g.sectionLabel === "faq")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Industry themes
// ---------------------------------------------------------------------------

describe("industry-specific themes", () => {
  it("detects construction themes with Ritz config", () => {
    const pages = [
      makeSnapshot({ url: "https://ritzbuilders.com/services/a", h2_list: ["Design Build Process", "ADU Guide", "FAQ"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/services/b", h2_list: ["Design Build Overview", "ADU Section", "FAQ"] }),
      makeSnapshot({ url: "https://ritzbuilders.com/services/c", h2_list: ["FAQ"] }),
    ];
    const target = pages[2];
    const gaps = analyzeSectionGaps(target, pages, RITZ_CONFIG);
    expect(gaps.some((g) => g.sectionLabel === "design_build")).toBe(true);
    expect(gaps.some((g) => g.sectionLabel === "adu")).toBe(true);
  });

  it("does NOT detect construction themes with dental config", () => {
    const pages = [
      makeSnapshot({ url: "https://smiledental.com/treatments/a", h2_list: ["Design Build Process", "ADU Guide", "FAQ"] }),
      makeSnapshot({ url: "https://smiledental.com/treatments/b", h2_list: ["Design Build Overview", "ADU Section", "FAQ"] }),
      makeSnapshot({ url: "https://smiledental.com/treatments/c", h2_list: ["FAQ"] }),
    ];
    const target = pages[2];
    const gaps = analyzeSectionGaps(target, pages, DENTAL_CONFIG);
    // "design_build" and "adu" are NOT in dental config
    expect(gaps.some((g) => g.sectionLabel === "design_build")).toBe(false);
    expect(gaps.some((g) => g.sectionLabel === "adu")).toBe(false);
  });

  it("detects dental themes with dental config", () => {
    const pages = [
      makeSnapshot({ url: "https://smiledental.com/treatments/a", h2_list: ["Insurance Options", "Cosmetic Whitening", "FAQ"] }),
      makeSnapshot({ url: "https://smiledental.com/treatments/b", h2_list: ["Insurance Coverage", "Cosmetic Services", "FAQ"] }),
      makeSnapshot({ url: "https://smiledental.com/treatments/c", h2_list: ["FAQ"] }),
    ];
    const target = pages[2];
    const gaps = analyzeSectionGaps(target, pages, DENTAL_CONFIG);
    expect(gaps.some((g) => g.sectionLabel === "insurance")).toBe(true);
    expect(gaps.some((g) => g.sectionLabel === "cosmetic")).toBe(true);
  });

  it("universal themes work without any config", () => {
    const pages = [
      makeSnapshot({ url: "https://example.com/pages/a", h2_list: ["FAQ", "Cost Guide", "Our Process"] }),
      makeSnapshot({ url: "https://example.com/pages/b", h2_list: ["FAQ", "Cost Breakdown", "Process"] }),
      makeSnapshot({ url: "https://example.com/pages/c", h2_list: ["Our Process"] }),
    ];
    const target = pages[2];
    // No config at all — should still detect universal themes
    const gaps = analyzeSectionGaps(target, pages);
    expect(gaps.some((g) => g.sectionLabel === "faq")).toBe(true);
    expect(gaps.some((g) => g.sectionLabel === "cost")).toBe(true);
  });
});
