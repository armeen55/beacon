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
