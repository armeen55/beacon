/**
 * wave-6 (2026-06-14) — TodayScoreboard first-run empty-state honesty.
 *
 * Pins the customer-trust contract surfaced by the wave-6 customer-surface
 * audit: when a tenant has genuinely NO data yet (no citations, no result
 * rows, no as-of date), the headline KPI cards must render the "—"
 * awaiting-reading placeholder — NOT a bold literal "0", which a
 * non-technical buyer misreads as a negative measurement ("AI recommended
 * us zero times") rather than a pending state. A REAL measured zero (data
 * exists, asOfDate set) must still render the number, never the placeholder.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayScoreboard, type ScoreboardData } from "./today-scoreboard";
import type { HealthStripProps } from "./health-strip";
import type { TodayProofContext } from "@/lib/today-proof-context";

function proofContext(): TodayProofContext {
  return {
    crawlRunId: null,
    crawlCompletedAt: null,
    crawlHref: null,
    visibilityRunId: null,
    visibilityCompletedAt: null,
    visibilityHref: null,
    citationIndexBuiltAt: null,
    visibilitySynthetic: false,
    visibilitySource: null,
    resultsRowCount: 0,
    resultsThrough: null,
    visibilityStaleVsCrawl: false,
    visibilityStaleNote: null,
    crawlAgeDays: null,
    crawlStale: false,
    visibilityPartialSample: false,
  };
}

function health(): HealthStripProps {
  return {
    coverageState: "critical",
    crawlAgeDays: null,
    hasScanRun: false,
    localNeedsAttention: false,
    proofContext: proofContext(),
  };
}

function scoreboard(over: Partial<ScoreboardData> = {}): ScoreboardData {
  return {
    totalCitations: 0,
    totalMentions: 0,
    trendPct: null,
    platformBreakdown: [],
    citedPageCount: 0,
    resultCount: 0,
    dateRange: null,
    mentionRate: null,
    decliningTopicCount: 0,
    risingTopicCount: 0,
    weekOverWeekCitations: null,
    weekOverWeekMentions: null,
    derivedKpiAsOfDate: null,
    derivedKpiIsFallback: false,
    derivedKpiSamplingStatus: null,
    ...over,
  };
}

/**
 * Extract the rendered text of every headline KPI VALUE span (the
 * `font-extrabold ... text-2xl` element KpiCard uses for the big number).
 * Scoped on purpose: the HealthStrip copy ("Refresh recommended — last
 * crawl is stale") legitimately contains an em-dash, so a whole-markup
 * substring check would false-match. We assert only on the KPI values.
 */
function kpiValues(html: string): string[] {
  const re = /font-extrabold tabular-nums tracking-tighter text-2xl">([^<]*)</g;
  const out: string[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1]);
  return out;
}

describe("TodayScoreboard — first-run empty-state honesty (wave-6)", () => {
  it("renders the '—' placeholder, not a bold 0, when there is genuinely no data yet", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard scoreboard={scoreboard()} health={health()} />,
    );
    // isFirstRunNoData is active -> the citations KPI value is the placeholder
    const values = kpiValues(html);
    expect(values).toContain("—");
    expect(values).not.toContain("0");
    // ...and the first-run explainer meta confirms we took that branch
    expect(html).toContain(
      "Beacon starts collecting AI answers when you refresh your connected data",
    );
  });

  it("renders a real measured zero as '0' (no placeholder) once data exists", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        scoreboard={scoreboard({
          // data exists for a real date -> isFirstRunNoData is FALSE even
          // though the measured citation count happens to be zero.
          derivedKpiAsOfDate: "2026-06-14",
          resultCount: 5,
        })}
        health={health()}
      />,
    );
    // The first-run explainer must NOT appear — this is a real reading.
    expect(html).not.toContain(
      "Beacon starts collecting AI answers when you refresh your connected data",
    );
    // ...and the KPI VALUES render the measured "0", never the placeholder.
    const values = kpiValues(html);
    expect(values).toContain("0");
    expect(values).not.toContain("—");
    // The as-of meta proves the single-day measured semantics rendered.
    expect(html).toContain("As of");
  });
});

describe("TodayScoreboard — #357 cumulative-fallback honesty", () => {
  it("shows '—' + awaiting-reading meta, NOT the all-time total, when today's snapshot is missing", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        scoreboard={scoreboard({
          // No derived snapshot today/yesterday -> loader fell back to the
          // cumulative all-time `results` total (1,234) and flagged it.
          cumulativeFallback: true,
          totalCitations: 1234,
          resultCount: 500,
          derivedKpiAsOfDate: null,
        })}
        health={health()}
      />,
    );
    const values = kpiValues(html);
    // The cumulative total must NOT appear as the headline number.
    expect(values).not.toContain("1,234");
    // Instead the awaiting-reading placeholder renders for the count tile.
    expect(values).toContain("—");
    // ...and the honest meta tells the operator why. (renderToStaticMarkup
    // HTML-escapes the apostrophe, so match around it.)
    expect(html).toContain("Awaiting today");
    expect(html).toContain("reading — refresh your connected data");
  });
});

describe("TodayScoreboard — #376 mention-rate sample-size honesty", () => {
  it("flags a thin-sample rate as volatile, with the sample size", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        scoreboard={scoreboard({
          mentionRate: 0.23,
          mentionRateSampleSize: 13,
          resultCount: 13,
        })}
        health={health()}
      />,
    );
    expect(html).toContain("23%");
    // Honest qualifier: small sample, volatility called out, count shown.
    expect(html).toContain("small sample (13 AI answers)");
    expect(html).toContain("can swing day to day");
  });

  it("anchors a healthy-sample rate with its count and does NOT cry volatility", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        scoreboard={scoreboard({
          mentionRate: 0.23,
          mentionRateSampleSize: 540,
          resultCount: 540,
        })}
        health={health()}
      />,
    );
    expect(html).toContain("23%");
    expect(html).toContain("across 540 AI answers");
    expect(html).not.toContain("can swing day to day");
  });
});

describe("TodayScoreboard — #387 non-color delta cue (a11y)", () => {
  it("renders a ▲ glyph + 'up … vs last week' aria-label for a positive week-over-week delta", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        // Real measured data (resultCount > 0) with NO as-of date, so the
        // week-over-week delta pill renders on the citations tile.
        scoreboard={scoreboard({
          totalCitations: 120,
          resultCount: 50,
          weekOverWeekCitations: 12,
          derivedKpiAsOfDate: null,
        })}
        health={health()}
      />,
    );
    // Direction is no longer color-only: a non-color glyph rides along…
    expect(html).toContain("▲");
    // …and a screen-reader label spells out direction + magnitude.
    expect(html).toContain('aria-label="up 12% vs last week"');
  });

  it("renders a ▼ glyph + 'down …' aria-label for a negative delta", () => {
    const html = renderToStaticMarkup(
      <TodayScoreboard
        scoreboard={scoreboard({
          totalCitations: 120,
          resultCount: 50,
          weekOverWeekCitations: -3,
          derivedKpiAsOfDate: null,
        })}
        health={health()}
      />,
    );
    expect(html).toContain("▼");
    expect(html).toContain('aria-label="down 3% vs last week"');
  });
});
