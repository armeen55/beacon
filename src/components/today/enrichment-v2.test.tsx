import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnrichmentV2 } from "./enrichment-v2";
import type {
  CompetitorDropdownEntry,
  CompetitorEnrichmentRollup,
  EnrichmentV2Data,
  EnrichmentWindowRollup,
  FormatWinsRollup,
  PlatformPrimaryRateSparkline,
} from "@/domains/prompt-answer-observations/enrichment-rollup";

// ---------------------------------------------------------------------------
// Fixture helpers — deliberately minimal so each test reads as a contract
// against the v2 layout's data dependency, not as a giant scaffolding wall.
// ---------------------------------------------------------------------------

function brandRollup(
  overrides: Partial<EnrichmentWindowRollup> = {},
): EnrichmentWindowRollup {
  return {
    windowEndDate: "2026-05-01",
    windowDays: 7,
    currentWindow: {
      date: "2026-05-01",
      totalObservations: 24,
      byPlatform: [],
      topDescriptors: [
        { word: "award-winning", count: 8 },
        { word: "luxury", count: 6 },
      ],
      answerStructures: [],
      observationsWithDescriptors: 14,
    },
    currentSampledDays: 7,
    priorSampledDays: 7,
    topDescriptorsWithDelta: [
      {
        word: "award-winning",
        count: 8,
        rankThisWindow: 1,
        rankPriorWindow: 4,
        delta: 3,
      },
      {
        word: "luxury",
        count: 6,
        rankThisWindow: 2,
        rankPriorWindow: 1,
        delta: -1,
      },
      {
        word: "architect-led",
        count: 4,
        rankThisWindow: 3,
        rankPriorWindow: 3,
        delta: 0,
      },
      {
        word: "atherton",
        count: 3,
        rankThisWindow: 4,
        rankPriorWindow: null,
        delta: null,
      },
    ],
    sampleStatus: "enough",
    ...overrides,
  };
}

function competitorRollup(
  overrides: Partial<CompetitorEnrichmentRollup> = {},
): CompetitorEnrichmentRollup {
  return {
    competitorName: "De Mattei Construction",
    windowEndDate: "2026-05-01",
    windowDays: 7,
    totalObservations: 18,
    observationsMentioningCompetitor: 12,
    observationsWithDescriptors: 10,
    observationsWithFieldAvailable: 18,
    topDescriptors: [
      { word: "design-build", count: 5 },
      { word: "sustainable", count: 4 },
    ],
    topDescriptorsWithDelta: [
      {
        word: "design-build",
        count: 5,
        rankThisWindow: 1,
        rankPriorWindow: 2,
        delta: 1,
      },
      {
        word: "sustainable",
        count: 4,
        rankThisWindow: 2,
        rankPriorWindow: null,
        delta: null,
      },
    ],
    emptyStateReason: null,
    sampleStatus: "enough",
    ...overrides,
  };
}

function dropdownEntry(
  overrides: Partial<CompetitorDropdownEntry> = {},
): CompetitorDropdownEntry {
  return {
    name: "De Mattei Construction",
    comentionCount: 12,
    observationsWithDescriptors: 10,
    hasDescriptorData: true,
    isDefault: true,
    ...overrides,
  };
}

function sparkline(
  overrides: Partial<PlatformPrimaryRateSparkline> = {},
): PlatformPrimaryRateSparkline {
  return {
    platform: "chatgpt",
    points: [
      { date: "2026-04-25", observations: 4, primaryRate: 0.5 },
      { date: "2026-04-26", observations: 4, primaryRate: 0.42 },
      { date: "2026-04-27", observations: 0, primaryRate: null },
      { date: "2026-04-28", observations: 4, primaryRate: 0.55 },
    ],
    totalObservations: 12,
    sampleStatus: "enough",
    ...overrides,
  };
}

function formatWins(
  overrides: Partial<FormatWinsRollup> = {},
): FormatWinsRollup {
  return {
    platform: "chatgpt",
    windowEndDate: "2026-05-01",
    windowDays: 7,
    sampleCount: 42,
    sampleStatus: "enough",
    dominantStructure: "ranked_list",
    dominantPct: 0.62,
    structures: [
      { structure: "ranked_list", count: 26, pct: 0.62 },
      { structure: "qa_format", count: 8, pct: 0.19 },
    ],
    ...overrides,
  };
}

function fullData(overrides: Partial<EnrichmentV2Data> = {}): EnrichmentV2Data {
  return {
    brandName: "Ritz Builders",
    windowEndDate: "2026-05-01",
    windowDays: 7,
    brand: brandRollup(),
    competitorOptions: [dropdownEntry()],
    competitorRollups: { "De Mattei Construction": competitorRollup() },
    sparklines: [sparkline()],
    formatWins: [formatWins()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EnrichmentV2 — top-level shell", () => {
  it("renders nothing when data is null", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={null} />);
    expect(html).toBe("");
  });

  it("renders the section header + observation count + window length", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("How AI described you this week");
    expect(html).toContain("24 answers");
    expect(html).toContain("last 7 days");
  });

  it("uses the data-attribute hook for downstream tests", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain('data-today-section="enrichment-v2"');
  });
});

describe("Section 1 — Who AI thinks YOU are", () => {
  it("renders the operator brand name and section title", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("Who AI thinks you are");
    expect(html).toContain("Ritz Builders");
  });

  it("renders descriptors with rank delta indicators (↑3 / ↓1 / — / new)", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("award-winning");
    expect(html).toContain("↑3");
    expect(html).toContain("luxury");
    expect(html).toContain("↓1");
    // architect-led has delta=0 → em-dash dash mark
    expect(html).toContain("architect-led");
    // atherton has rankPriorWindow=null + delta=null → "new" badge
    expect(html).toContain("atherton");
    expect(html).toContain("new");
  });

  it("falls to thin-sample softer copy when sampleStatus='thin'", () => {
    const data = fullData({
      brand: brandRollup({ sampleStatus: "thin" }),
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Early signal — based on a few answers so far.");
  });

  it("renders empty-state copy when brand has no descriptors AND sampleStatus='empty'", () => {
    const data = fullData({
      brand: brandRollup({
        topDescriptorsWithDelta: [],
        sampleStatus: "empty",
      }),
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    // Apostrophe gets HTML-encoded to &#x27; in renderToStaticMarkup —
    // browsers display it correctly. Match either form.
    expect(html).toMatch(
      /AI hasn(?:'|&#x27;)t described you on this prompt set yet\./,
    );
  });
});

describe("Section 2 — Who AI thinks THEY are (competitor)", () => {
  it("renders the dropdown with the default competitor selected", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("Who AI thinks they are");
    // The default competitor name appears as a <select> option.
    expect(html).toContain("De Mattei Construction");
  });

  it("renders competitor descriptors when competitor data is present", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("design-build");
    expect(html).toContain("sustainable");
    expect(html).toContain("↑1");
    expect(html).toContain("new");
  });

  it("renders 'no_descriptor_field_yet' empty-state copy when regime requires it", () => {
    const data = fullData({
      competitorRollups: {
        "De Mattei Construction": competitorRollup({
          topDescriptors: [],
          topDescriptorsWithDelta: [],
          observationsWithDescriptors: 0,
          observationsWithFieldAvailable: 0,
          emptyStateReason: "no_descriptor_field_yet",
          sampleStatus: "empty",
        }),
      },
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Competitor descriptor data is still warming up.");
  });

  it("renders 'competitor_not_mentioned' empty-state copy when regime requires it", () => {
    const data = fullData({
      competitorRollups: {
        "De Mattei Construction": competitorRollup({
          topDescriptors: [],
          topDescriptorsWithDelta: [],
          observationsWithDescriptors: 0,
          emptyStateReason: "competitor_not_mentioned",
          sampleStatus: "empty",
        }),
      },
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain(
      "AI did not mention this competitor in this window.",
    );
  });

  it("renders 'no_observations_in_window' empty-state copy when regime requires it", () => {
    const data = fullData({
      competitorRollups: {
        "De Mattei Construction": competitorRollup({
          topDescriptors: [],
          topDescriptorsWithDelta: [],
          observationsWithDescriptors: 0,
          totalObservations: 0,
          emptyStateReason: "no_observations_in_window",
          sampleStatus: "empty",
        }),
      },
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Not enough AI answers in this window yet.");
  });

  it("renders 'no competitors tracked yet' fallback when dropdown is empty", () => {
    const data = fullData({
      competitorOptions: [],
      competitorRollups: {},
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("No competitors tracked yet");
  });

  it("does NOT include directories in the dropdown (regression — Step 1.4 + 2.2b filter)", () => {
    // Directories should be filtered out upstream by buildCompetitorDropdown
    // (verified in Step 2.2b tests). UI must NEVER render an option that
    // wasn't passed in via competitorOptions.
    const data = fullData();
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).not.toContain("Houzz");
    expect(html).not.toContain("Yelp");
    expect(html).not.toContain("Angi");
    expect(html).not.toContain("BuildZoom");
  });

  it("does NOT leak brand descriptors into the competitor section (regression — anti-fabrication contract)", () => {
    // Brand descriptors include "architect-led" / "atherton" — must not
    // appear inside the competitor's section when the competitor's own
    // descriptors are absent.
    const data = fullData({
      competitorRollups: {
        "De Mattei Construction": competitorRollup({
          topDescriptors: [],
          topDescriptorsWithDelta: [],
          observationsWithDescriptors: 0,
          emptyStateReason: "competitor_not_mentioned",
          sampleStatus: "empty",
        }),
      },
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    // Find the section header and look only after it.
    const idx = html.indexOf("Who AI thinks they are");
    const competitorSlice = html.slice(idx);
    expect(competitorSlice).not.toContain("architect-led");
    // "atherton" might appear in brand descriptors — check that the
    // emptyStateReason copy is rendered instead.
    expect(competitorSlice).toContain(
      "AI did not mention this competitor in this window.",
    );
  });
});

describe("Section 3 — Where AI ranks you (per-platform sparklines)", () => {
  it("renders one row per platform with platformLabel + primary %", () => {
    const data = fullData({
      sparklines: [
        sparkline({ platform: "chatgpt" }),
        sparkline({
          platform: "perplexity",
          points: [
            { date: "2026-04-30", observations: 4, primaryRate: 0.18 },
          ],
          totalObservations: 4,
          sampleStatus: "thin",
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Where AI ranks you");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Perplexity");
    expect(html).toContain("Primary 55%"); // latest sampled value (chatgpt)
    expect(html).toContain("Primary 18%"); // perplexity latest
  });

  it("includes an SVG sparkline per platform (real path when data present)", () => {
    const data = fullData();
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });

  it("renders 'No data yet' for an entirely-empty platform sparkline", () => {
    const data = fullData({
      sparklines: [
        sparkline({
          platform: "claude",
          points: [{ date: "2026-04-30", observations: 0, primaryRate: null }],
          totalObservations: 0,
          sampleStatus: "empty",
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Claude");
    expect(html).toContain("No data yet");
  });

  it("renders 'early data' tag when sparkline sampleStatus='thin'", () => {
    const data = fullData({
      sparklines: [
        sparkline({
          platform: "perplexity",
          totalObservations: 5,
          sampleStatus: "thin",
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("(early data)");
  });

  it("renders empty-state when sparklines array is empty", () => {
    const data = fullData({ sparklines: [] });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Ranking data is still warming up.");
  });
});

describe("Section 4 — What format wins (per-platform sentence)", () => {
  it("renders 'ChatGPT prefers Ranked list (62%)' style sentence per platform", () => {
    const html = renderToStaticMarkup(<EnrichmentV2 data={fullData()} />);
    expect(html).toContain("What format wins");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Ranked list");
    expect(html).toContain("62%");
  });

  it("uses STRUCTURE_LABEL — never leaks raw enum keys like 'qa_format' or 'ranked_list'", () => {
    const data = fullData({
      formatWins: [
        formatWins({ platform: "chatgpt", dominantStructure: "qa_format", dominantPct: 0.51 }),
        formatWins({
          platform: "perplexity",
          dominantStructure: "narrative",
          dominantPct: 0.48,
          structures: [{ structure: "narrative", count: 12, pct: 0.48 }],
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    // "Q&A" gets HTML-escaped to "Q&amp;A" in renderToStaticMarkup output
    // (browsers render it correctly as Q&A) — match the encoded form.
    expect(html).toContain("Q&amp;A");
    expect(html).toContain("Story");
    expect(html).not.toContain("qa_format");
    expect(html).not.toContain("ranked_list");
    expect(html).not.toContain("bullet_list");
  });

  it("renders softer 'mostly using X so far (early data)' copy when sampleStatus='thin'", () => {
    const data = fullData({
      formatWins: [
        formatWins({
          platform: "perplexity",
          dominantStructure: "narrative",
          dominantPct: 0.6,
          sampleCount: 5,
          sampleStatus: "thin",
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("mostly using");
    expect(html).toContain("(early data)");
  });

  it("hides empty platforms but shows 'not enough format data yet' when ALL platforms empty", () => {
    const data = fullData({
      formatWins: [
        formatWins({
          platform: "chatgpt",
          sampleCount: 0,
          sampleStatus: "empty",
          dominantStructure: null,
          dominantPct: null,
          structures: [],
        }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    expect(html).toContain("Not enough format data yet.");
  });
});

describe("Architecture invariants — no enum leaks", () => {
  it("never renders any AnswerStructure enum value as a raw token in the rendered HTML", () => {
    const data = fullData({
      formatWins: [
        formatWins({ platform: "chatgpt", dominantStructure: "ranked_list", dominantPct: 0.62 }),
        formatWins({ platform: "perplexity", dominantStructure: "bullet_list", dominantPct: 0.4 }),
        formatWins({ platform: "google_aio", dominantStructure: "qa_format", dominantPct: 0.55 }),
      ],
    });
    const html = renderToStaticMarkup(<EnrichmentV2 data={data} />);
    // None of the raw enum keys should ever appear in operator-visible HTML.
    expect(html).not.toMatch(/\branked_list\b/);
    expect(html).not.toMatch(/\bbullet_list\b/);
    expect(html).not.toMatch(/\bqa_format\b/);
  });
});
