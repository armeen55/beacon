/**
 * Section 6 C4b — Today hero primary-share UI source-swap.
 *
 * Pins runtime behavior of the customer-visible flip:
 *   • Hero renders the snapshot-derived `primaryShare` prop verbatim.
 *   • `enrichmentV2.sparklines[].primaryRate` is NO LONGER consulted
 *     for the hero pills; supplying a sparkline with different
 *     `primaryRate` values does not change what the hero renders.
 *   • Null on either side hides the corresponding pill (unchanged
 *     null-conditional rendering).
 *
 * Companion architecture invariant
 * `tests/architecture/today-primary-share-source.test.ts` pins the
 * source-text contract (no `platformPrimaryPct` closure + no
 * `sparkline.points[i].primaryRate` access for hero pct). This file
 * pins the rendered-HTML contract.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TodayV2VisibilityGroupClient,
  type TodayV2VisibilityGroupClientProps,
} from "@/app/(shell)/today-v2-visibility-group-client";
import type {
  EnrichmentV2Data,
  PlatformPrimaryRateSparkline,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { TodayPrimaryShare } from "@/domains/daily-metric-snapshots/today-primary-share";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers — minimal-but-valid VisibilityData so the hero memo
// returns a non-null heroProps object. Without a working visibilityData,
// the heroProps useMemo short-circuits to null and AIVisibilityHero
// isn't rendered at all (defeats the test's purpose).
// ─────────────────────────────────────────────────────────────────────

function baseVisibilityData(): NonNullable<
  TodayV2VisibilityGroupClientProps["visibilityData"]
> {
  // One brand series point per metric so latestVisible/earliestVisible
  // resolve to a real score. Leaderboards empty (no rank) — that's
  // fine; hero handles null rank.
  const series = [
    { date: "2026-05-14", score: 42, sampleSize: 5 },
    { date: "2026-05-15", score: 50, sampleSize: 5 },
  ];
  return {
    brandName: "Ritz Builders",
    brandSeriesByMetric: {
      composite: series,
      mention_rate: series,
      citation_rate: series,
    },
    brandSeriesByPlatform: {},
    leaderboardByMetric: {
      composite: [],
      mention_rate: [],
      citation_rate: [],
    },
    leaderboardByMetricAndWindow: undefined,
    chartEndDate: "2026-05-15",
    competitorSeriesByMetric: {
      composite: [],
      mention_rate: [],
      citation_rate: [],
    },
    chartEvents: [],
    freshness: {
      status: "fresh",
      latestSnapshotDate: "2026-05-15",
      label: "Updated today",
    },
  };
}

function makeEnrichmentWithSparklines(
  chatPrimaryRate: number | null,
  perpPrimaryRate: number | null,
): EnrichmentV2Data {
  // Construct sparklines that, if the OLD-path closure were still
  // active, would produce values DIFFERENT from primaryShare. The
  // OLD path read `Math.round(primaryRate * 100)`, so to surface a
  // false positive (hero renders sparkline-derived value), the
  // sparkline values must round to something the test can detect.
  //
  // Note: the legacy production code had a casing bug — it searched
  // for `s.platform === "ChatGPT"` against canonicalized lowercase
  // keys ("chatgpt"). The CORRECT-casing variant here would expose
  // the OLD path if it were still in use. Either way the new code
  // doesn't read these, so they should be ignored.
  const points = (rate: number | null): PlatformPrimaryRateSparkline => ({
    platform: "chatgpt",
    points: [
      { date: "2026-05-14", observations: 10, primaryRate: rate },
      { date: "2026-05-15", observations: 10, primaryRate: rate },
    ],
    totalObservations: 20,
    sampleStatus: "enough",
  });
  return {
    brandName: "Ritz Builders",
    windowEndDate: "2026-05-15",
    windowDays: 14,
    brand: null as never,
    competitorOptions: [],
    competitorRollups: {},
    sparklines: [
      { ...points(chatPrimaryRate), platform: "chatgpt" },
      { ...points(perpPrimaryRate), platform: "perplexity" },
      // Also include TitleCase variants so the OLD-path casing-bug
      // (had it been still active) would have a match too.
      { ...points(chatPrimaryRate), platform: "ChatGPT" },
      { ...points(perpPrimaryRate), platform: "Perplexity" },
    ],
    formatWins: null as never,
  } as EnrichmentV2Data;
}

function render(props: TodayV2VisibilityGroupClientProps): string {
  return renderToStaticMarkup(<TodayV2VisibilityGroupClient {...props} />);
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("TodayV2VisibilityGroupClient — primaryShare source-swap (Section 6 C4b)", () => {
  it("renders both pills from primaryShare prop when enrichmentV2 is null", () => {
    const primaryShare: TodayPrimaryShare = {
      chatgptPrimaryPct: 42,
      perplexityPrimaryPct: 17,
    };
    const html = render({
      visibilityData: baseVisibilityData(),
      enrichmentV2: null,
      primaryShare,
    });
    expect(html).toContain("42% primary");
    expect(html).toContain("17% primary");
  });

  it("renders primaryShare values even when enrichmentV2 sparklines carry different primaryRate values (proves source swap)", () => {
    // primaryShare says 42 / 17. Sparkline says 88 / 99 (would round
    // to 88% / 99% if the OLD-path closure were still active). The
    // hero MUST render 42 / 17 — not 88 / 99 — confirming the source
    // is the prop, not the sparkline.
    const primaryShare: TodayPrimaryShare = {
      chatgptPrimaryPct: 42,
      perplexityPrimaryPct: 17,
    };
    const enrichmentV2 = makeEnrichmentWithSparklines(0.88, 0.99);
    const html = render({
      visibilityData: baseVisibilityData(),
      enrichmentV2,
      primaryShare,
    });
    expect(html).toContain("42% primary");
    expect(html).toContain("17% primary");
    expect(html).not.toContain("88% primary");
    expect(html).not.toContain("99% primary");
  });

  it("hides both pills when primaryShare values are null", () => {
    const primaryShare: TodayPrimaryShare = {
      chatgptPrimaryPct: null,
      perplexityPrimaryPct: null,
    };
    const html = render({
      visibilityData: baseVisibilityData(),
      enrichmentV2: null,
      primaryShare,
    });
    // The pill's per-platform data-attribute renders only inside the
    // `{pct !== null && ...}` ternary. With both null, neither
    // attribute appears in the HTML.
    expect(html).not.toContain('data-today-hero-platform="chatgpt"');
    expect(html).not.toContain('data-today-hero-platform="perplexity"');
  });

  it("renders only the populated platform pill when the other is null", () => {
    const primaryShare: TodayPrimaryShare = {
      chatgptPrimaryPct: null,
      perplexityPrimaryPct: 42,
    };
    const html = render({
      visibilityData: baseVisibilityData(),
      enrichmentV2: null,
      primaryShare,
    });
    expect(html).not.toContain('data-today-hero-platform="chatgpt"');
    expect(html).toContain('data-today-hero-platform="perplexity"');
    expect(html).toContain("42% primary");
  });
});
