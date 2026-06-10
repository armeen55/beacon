/**
 * 2026-06-09 — Competitor-intel substrate tests: citation series,
 * structural diff, and move detection (tiers, windows, dedupe, copy,
 * action mapping). All pure — no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  buildCompetitorCitationSeries,
  windowCount,
  firstCitationOnOrAfter,
  normalizeHost,
} from "@/domains/competitor-intel/citation-series";
import { diffCompetitorPageStructure } from "@/domains/competitor-intel/structural-diff";
import {
  detectCompetitorMoves,
  mapMoveToAction,
  addDaysUtc,
  daysBetweenUtc,
  formatMoveDate,
  MIN_PROVEN_POST,
} from "@/domains/competitor-intel/detect-moves";
import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type { CompetitorPageChange } from "@/domains/competitor-monitoring/types";
import type {
  CompetitorStructuralChange,
  CompetitorUrlCitationSeries,
} from "@/domains/competitor-intel/types";

const SUPPLE = { domain: "supplehomesinc.com", displayName: "Supple Homes" };

function obs(over: {
  observed_at: string;
  platform?: string;
  citation_urls?: string[] | null;
}) {
  return {
    observed_at: over.observed_at,
    platform: over.platform ?? "chatgpt",
    citation_urls: over.citation_urls ?? null,
  };
}

describe("citation-series", () => {
  it("buckets competitor URLs by canonical URL + day; ignores non-competitor + null rows", () => {
    const series = buildCompetitorCitationSeries(
      [
        obs({
          observed_at: "2026-06-01T10:00:00Z",
          citation_urls: [
            "https://www.supplehomesinc.com/adu-cost/",
            "https://ritzbuilders.com/adu", // not a tracked competitor
          ],
        }),
        obs({
          observed_at: "2026-06-01T18:00:00Z",
          platform: "perplexity",
          citation_urls: ["https://supplehomesinc.com/adu-cost"],
        }),
        obs({ observed_at: "2026-06-02T10:00:00Z", citation_urls: null }), // pre-Commit-7
        obs({
          observed_at: "2026-06-03T10:00:00Z",
          citation_urls: ["https://supplehomesinc.com/adu-cost"],
        }),
      ],
      [SUPPLE],
    );
    expect(series).toHaveLength(1);
    const s = series[0]!;
    expect(s.domain).toBe("supplehomesinc.com");
    expect(s.total).toBe(3);
    // www + trailing slash canonicalize to the same URL
    expect(s.daily).toEqual([
      { date: "2026-06-01", count: 2, platforms: ["chatgpt", "perplexity"] },
      { date: "2026-06-03", count: 1, platforms: ["chatgpt"] },
    ]);
  });

  it("matches subdomains of a tracked competitor", () => {
    const series = buildCompetitorCitationSeries(
      [obs({ observed_at: "2026-06-01T00:00:00Z", citation_urls: ["https://blog.supplehomesinc.com/post"] })],
      [SUPPLE],
    );
    expect(series).toHaveLength(1);
  });

  it("windowCount + firstCitationOnOrAfter", () => {
    const daily = [
      { date: "2026-06-01", count: 1, platforms: ["chatgpt"] },
      { date: "2026-06-08", count: 2, platforms: ["chatgpt"] },
    ];
    expect(windowCount(daily, "2026-06-01", "2026-06-08")).toBe(1);
    expect(windowCount(daily, "2026-06-01", "2026-06-09")).toBe(3);
    expect(firstCitationOnOrAfter(daily, "2026-06-02")).toBe("2026-06-08");
    expect(firstCitationOnOrAfter(daily, "2026-06-09")).toBeNull();
  });

  it("normalizeHost strips www + lowercases", () => {
    expect(normalizeHost("WWW.Supple.com")).toBe("supple.com");
  });
});

function snap(over: Partial<CompetitorPageSnapshot>): CompetitorPageSnapshot {
  return {
    id: "comp-snap-t-x",
    tenant_id: "t",
    url: "https://supplehomesinc.com/adu-cost",
    canonical_url: null,
    fetched_at: "2026-06-02T10:00:00Z",
    http_status: 200,
    title: "ADU Cost Guide",
    meta_description: null,
    h1: "ADU Cost",
    h2_list: [],
    faq_questions: [],
    extraction_certainty: "confirmed",
    ...over,
  };
}

describe("structural-diff", () => {
  const meta = { domain: "supplehomesinc.com", displayName: "Supple Homes" };

  it("detects FAQ added + new sections + meta added", () => {
    const prev = snap({ h2_list: ["Overview"], fetched_at: "2026-05-20T00:00:00Z" });
    const next = snap({
      h2_list: ["Overview", "ADU Cost Breakdown"],
      faq_questions: ["How much does an ADU cost?", "Do I need a permit?"],
      meta_description: "Real ADU costs in the Bay Area",
    });
    const changes = diffCompetitorPageStructure(prev, next, meta);
    const kinds = changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(["faq_added", "meta_added", "section_added"]);
    const faq = changes.find((c) => c.kind === "faq_added")!;
    expect(faq.detail).toBe("added an FAQ (2 questions)");
    const section = changes.find((c) => c.kind === "section_added")!;
    expect(section.detail).toContain("ADU Cost Breakdown");
    expect(section.capturedAt).toBe(next.fetched_at);
  });

  it("FAQ expansion needs ≥2 new questions; cosmetic heading edits don't fire", () => {
    const prev = snap({ faq_questions: ["Q1?"], h2_list: ["ADU Cost Breakdown"] });
    const plusOne = snap({ faq_questions: ["Q1?", "Q2?"], h2_list: ["ADU Cost Breakdown!"] });
    expect(diffCompetitorPageStructure(prev, plusOne, meta)).toEqual([]);
    const plusTwo = snap({ faq_questions: ["Q1?", "Q2?", "Q3?"], h2_list: ["ADU Cost Breakdown"] });
    const changes = diffCompetitorPageStructure(prev, plusTwo, meta);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("faq_expanded");
  });

  it("retitle fires only when both titles present and differ", () => {
    expect(
      diffCompetitorPageStructure(snap({ title: null }), snap({ title: "New" }), meta),
    ).toEqual([]);
    const changes = diffCompetitorPageStructure(
      snap({ title: "Old Title" }),
      snap({ title: "New Title" }),
      meta,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("title_changed");
  });

  it("never reports FAQ/section removals", () => {
    const prev = snap({ faq_questions: ["Q1?", "Q2?"], h2_list: ["A", "B"] });
    const next = snap({ faq_questions: [], h2_list: ["A"] });
    expect(diffCompetitorPageStructure(prev, next, meta)).toEqual([]);
  });
});

function sitemapChange(over: Partial<CompetitorPageChange>): CompetitorPageChange {
  return {
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    type: "added",
    url: "https://supplehomesinc.com/adu-cost",
    path: "/adu-cost",
    lastmod: "2026-06-02",
    previousLastmod: null,
    detectedAt: "2026-06-03T08:00:00Z",
    ...over,
  };
}

function mkSeries(daily: Array<{ date: string; count: number }>): CompetitorUrlCitationSeries {
  return {
    url: "https://supplehomesinc.com/adu-cost",
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    daily: daily.map((d) => ({ ...d, platforms: ["chatgpt"] })),
    total: daily.reduce((s, d) => s + d.count, 0),
  };
}

describe("detect-moves — tiers + copy", () => {
  it("proven: citations rose after the move; copy names both dates honestly", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({})],
      structuralChanges: [],
      series: [mkSeries([{ date: "2026-06-08", count: 2 }, { date: "2026-06-10", count: 2 }])],
      todayIso: "2026-06-20",
    });
    expect(moves).toHaveLength(1);
    const m = moves[0]!;
    expect(m.tier).toBe("proven");
    expect(m.preCount).toBe(0);
    expect(m.postCount).toBe(4);
    expect(m.daysToFirstCitation).toBe(6);
    expect(m.line).toContain("Supple Homes published a adu cost page on June 2.");
    expect(m.line).toContain("AI started citing it 6 days later");
    expect(m.line).toContain("4 citations in the 14 days after");
    expect(m.line).toContain("(none in the two weeks before)");
    // associative discipline: no causal verbs
    expect(m.line).not.toMatch(/caused|drove|because|led to/i);
  });

  it("early: pickup below the proven bar", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({})],
      structuralChanges: [],
      series: [mkSeries([{ date: "2026-06-09", count: MIN_PROVEN_POST - 1 }])],
      todayIso: "2026-06-10",
    });
    expect(moves[0]!.tier).toBe("early");
    expect(moves[0]!.line).toContain("AI has cited it 1 time since.");
  });

  it("watching: recent move, no pickup, window incomplete", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({ lastmod: "2026-06-05" })],
      structuralChanges: [],
      series: [],
      todayIso: "2026-06-09",
    });
    expect(moves[0]!.tier).toBe("watching");
    expect(moves[0]!.line).toContain("Watching for AI pickup");
  });

  it("quiet: window complete, nothing happened", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({ lastmod: "2026-04-01" })],
      structuralChanges: [],
      series: [],
      todayIso: "2026-06-01",
    });
    expect(moves[0]!.tier).toBe("quiet");
  });

  it("proven requires post > pre (steady citations ≠ a move that worked)", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({})],
      structuralChanges: [],
      series: [
        mkSeries([
          { date: "2026-05-25", count: 5 }, // pre
          { date: "2026-06-05", count: 3 }, // post < pre
        ]),
      ],
      todayIso: "2026-06-20",
    });
    expect(moves[0]!.tier).toBe("early"); // has pickup, but not proven
  });

  it("dedupes same url+day, preferring the richer structural description", () => {
    const structural: CompetitorStructuralChange = {
      url: "https://supplehomesinc.com/adu-cost",
      domain: "supplehomesinc.com",
      displayName: "Supple Homes",
      kind: "faq_added",
      detail: "added an FAQ (6 questions)",
      capturedAt: "2026-06-02T12:00:00Z",
    };
    const moves = detectCompetitorMoves({
      sitemapChanges: [sitemapChange({ type: "updated" })],
      structuralChanges: [structural],
      series: [],
      todayIso: "2026-06-09",
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.kind).toBe("faq_added");
    expect(moves[0]!.whatTheyDid).toBe("added an FAQ (6 questions)");
  });

  it("drops removed pages, stale moves, and future-dated lastmod", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [
        sitemapChange({ type: "removed" }),
        sitemapChange({ lastmod: "2025-01-01", url: "https://supplehomesinc.com/old" }),
        sitemapChange({ lastmod: "2027-01-01", url: "https://supplehomesinc.com/future" }),
      ],
      structuralChanges: [],
      series: [],
      todayIso: "2026-06-09",
    });
    expect(moves).toEqual([]);
  });

  it("sorts proven first, then by citation delta", () => {
    const moves = detectCompetitorMoves({
      sitemapChanges: [
        sitemapChange({}),
        sitemapChange({ url: "https://supplehomesinc.com/kitchen", path: "/kitchen", lastmod: "2026-06-05" }),
      ],
      structuralChanges: [],
      series: [mkSeries([{ date: "2026-06-08", count: 3 }])],
      todayIso: "2026-06-09",
    });
    expect(moves[0]!.tier).toBe("proven");
    expect(moves[1]!.tier).toBe("watching");
  });
});

describe("detect-moves — action mapping", () => {
  it("faq → add_faq; pricing path → cost guide; new page → equivalent page; update → refresh", () => {
    expect(mapMoveToAction({ kind: "faq_added", path: "/adu", whatTheyDid: "added an FAQ" }).actionType).toBe("add_faq");
    expect(mapMoveToAction({ kind: "new_page", path: "/adu-cost", whatTheyDid: "published a adu cost page" })).toEqual({
      actionType: "expand_page_coverage",
      label: "Publish your own cost guide",
    });
    expect(mapMoveToAction({ kind: "new_page", path: "/kitchen-remodel", whatTheyDid: "published a kitchen remodel page" }).label).toBe("Publish your equivalent page");
    expect(mapMoveToAction({ kind: "updated_page", path: "/adu", whatTheyDid: "updated a adu page" }).actionType).toBe("refresh_content");
    expect(mapMoveToAction({ kind: "section_added", path: "/adu", whatTheyDid: "added new section: “Timeline”" }).actionType).toBe("strengthen_structure");
  });
});

describe("date helpers", () => {
  it("addDaysUtc / daysBetweenUtc / formatMoveDate", () => {
    expect(addDaysUtc("2026-06-02", 14)).toBe("2026-06-16");
    expect(addDaysUtc("2026-06-02", -14)).toBe("2026-05-19");
    expect(daysBetweenUtc("2026-06-02", "2026-06-08")).toBe(6);
    expect(formatMoveDate("2026-06-02")).toBe("June 2");
  });
});
