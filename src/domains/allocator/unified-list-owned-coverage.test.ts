/**
 * unified-list-owned-coverage - the keyword-library gap lane must never store the
 * false "I have no page targeting this yet" sentence for a keyword an owned page
 * already targets. The blind benchmark caught exactly that: a gap record for "nowruz
 * persian new year" claimed no page, while /nowruz (title "Persian New Year") already
 * targeted it, deep-ranked and invisible to the ownership registry. This pins the
 * coverage-aware reclassification (create -> edit) that replaces the false sentence.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeKeywordLibraryEntry,
  normalizeKeywordLibraryEntryWithRegistry,
  normalizeKeywordLibraryEntryWithCoverage,
} from "./unified-list";
import type { KeywordLibraryRow } from "@/domains/research/keyword-library";
import type { OwnedCoverageMatch } from "@/domains/demand-graph/owned-coverage";

const TENANT = "tenant-test";
const BANNED_DASH = /[‒–—―]/;

function kwRow(over: Partial<KeywordLibraryRow> = {}): KeywordLibraryRow {
  return {
    keyword: "nowruz persian new year",
    searchesPerMo: 14800,
    timesShownPerMo: null,
    clicks: null,
    yourPosition: null,
    difficulty: null,
    trend: null,
    ownerPage: null, // GSC never attributed this exact phrase to a page -> looks like a gap
    ownerPageHref: null,
    competitorOwners: [],
    relatedQuestions: [],
    sources: ["dataforseo_demand"],
    lastChecked: null,
    ...over,
  };
}

const NOWRUZ_MATCH: OwnedCoverageMatch = {
  ownedUrl: "https://iranopedia.com/nowruz",
  ownedPath: "/nowruz",
  basis: "content",
  position: null,
  matchedOn: "title: Nowruz - Persian New Year",
  sentence: "You already have /nowruz for this topic. I would improve that page before building a new one.",
  detail: 'The title on /nowruz already reads "Nowruz - Persian New Year".',
};

describe("normalizeKeywordLibraryEntryWithCoverage", () => {
  it("is byte-identical to the registry variant when no coverage is passed", () => {
    const row = kwRow();
    const registryOnly = normalizeKeywordLibraryEntryWithRegistry(TENANT, row, null);
    expect(normalizeKeywordLibraryEntryWithCoverage(TENANT, row, null, null)).toEqual(registryOnly);
    expect(normalizeKeywordLibraryEntryWithCoverage(TENANT, row, null, undefined)).toEqual(registryOnly);
  });

  it("without coverage, the gap still reads as a create with the (now honest only-if-true) no-page sentence", () => {
    // Sanity anchor: the false sentence is exactly what the base normalizer emits for a
    // genuine gap, so the guard below is meaningful.
    const base = normalizeKeywordLibraryEntry(TENANT, kwRow());
    expect(base.kind).toBe("create");
    expect(base.exactWhat).toContain("I have no page targeting this yet");
  });

  it("reclassifies create -> edit and drops the false no-page sentence when a page covers it", () => {
    const e = normalizeKeywordLibraryEntryWithCoverage(TENANT, kwRow(), null, NOWRUZ_MATCH);
    expect(e.kind).toBe("edit");
    expect(e.page).toBe("/nowruz");
    expect(e.exactWhat).not.toContain("I have no page targeting this yet");
    expect(e.exactWhat).toContain("Improve /nowruz");
    expect(e.exactWhat).toContain("14,800");
    expect(BANNED_DASH.test(e.exactWhat)).toBe(false);
    expect(BANNED_DASH.test(e.forecastBasis ?? "")).toBe(false);
  });

  it("leaves an already-owned (edit) row untouched by the coverage step", () => {
    const owned = kwRow({ ownerPage: "https://iranopedia.com/other", yourPosition: 14 });
    const e = normalizeKeywordLibraryEntryWithCoverage(TENANT, owned, null, NOWRUZ_MATCH);
    // Already an edit before the coverage step, so coverage does not re-point it.
    expect(e.kind).toBe("edit");
    expect(e.page).toBe("/other");
  });
});
