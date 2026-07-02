import { describe, expect, it } from "vitest";
import { buildStrategyDossier, renderDossierForPrompt } from "./build-dossier";
import type { SettledOutcome } from "@/domains/learning/experiment-prior";
import type { QuerySpike } from "@/domains/trend-radar/query-spikes";
import type { SeasonalQuery } from "@/domains/seasonal/seasonality";
import type { LanguageGap } from "@/domains/language-gap/language-gaps";
import { summarizeForecastCalibration } from "@/domains/experiments/forecast-calibration";
import type { CalibrationRecord } from "@/domains/experiments/forecast-calibration-store";

function outcome(over: Partial<SettledOutcome> = {}): SettledOutcome {
  return { verdict: "won", dims: { actionType: "answer_block" }, ...over };
}

function spike(over: Partial<QuerySpike> = {}): QuerySpike {
  return { query: "q", thisWeek: 100, typicalWeek: 20, ratio: 5, thisWeekClicks: 10, topPage: null, ...over } as QuerySpike;
}

function seasonal(over: Partial<SeasonalQuery> = {}): SeasonalQuery {
  return { query: "nowruz", peakMonths: [3], share: 0.6, annualImpressions: 1000, topPage: null, ...over } as SeasonalQuery;
}

function gap(over: Partial<LanguageGap> = {}): LanguageGap {
  return {
    page: "/persian-food",
    gapKind: "farsi_demand_no_farsi_content",
    impressions: 500,
    topVariants: [],
    sentence: "",
    ...over,
  } as LanguageGap;
}

function calRecord(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    pickId: "p1",
    tenantId: "t",
    proofId: "p1::x",
    page: "u",
    lever: "meta",
    forecastLow: 10,
    forecastHigh: 30,
    actual: 20,
    outcome: "inside",
    at: "2026-06-29T00:00:00Z",
    ...over,
  };
}

describe("buildStrategyDossier - shape", () => {
  it("folds settled outcomes into per-actionType won/lost records", () => {
    const outcomes: SettledOutcome[] = [
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
      outcome({ verdict: "lost", dims: { actionType: "answer_block" } }),
    ];
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes,
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: null,
    });
    expect(d.leverRecords).toHaveLength(1);
    expect(d.leverRecords[0]).toMatchObject({ family: "answer_block", won: 3, lost: 1, decided: 4 });
    expect(d.leverRecords[0]!.winRate).toBe(0.75);
    expect(d.totalDecided).toBe(4);
  });

  it("omits a family below MIN_DECIDED (thin sample stays invisible, not misleading)", () => {
    const outcomes: SettledOutcome[] = [outcome({ verdict: "won", dims: { actionType: "title" } })];
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes,
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: null,
    });
    expect(d.leverRecords).toHaveLength(0);
    expect(d.totalDecided).toBe(0);
  });

  it("bounds trends/seasonal/language-gaps to their max and sorts by strength", () => {
    const trends = Array.from({ length: 8 }, (_, i) => spike({ query: `q${i}`, ratio: i }));
    const seasonalWindows = Array.from({ length: 8 }, (_, i) => seasonal({ query: `s${i}`, share: i / 10 }));
    const languageGaps = Array.from({ length: 8 }, (_, i) => gap({ page: `/p${i}`, impressions: i * 100 }));
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes: [],
      trends,
      seasonalWindows,
      languageGaps,
      calibration: null,
    });
    expect(d.trends.length).toBeLessThanOrEqual(5);
    expect(d.seasonalWindows.length).toBeLessThanOrEqual(5);
    expect(d.languageGaps.length).toBeLessThanOrEqual(5);
    // Highest ratio/share/impressions first.
    expect(d.trends[0]!.query).toBe("q7");
    expect(d.seasonalWindows[0]!.query).toBe("s7");
    expect(d.languageGaps[0]!.page).toBe("/p7");
  });

  it("calibration is null when too thin (below MIN_SETTLED_FOR_CALIBRATION)", () => {
    const summary = summarizeForecastCalibration([calRecord(), calRecord({ pickId: "p2" })]);
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes: [],
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: summary,
    });
    expect(d.calibration).toBeNull();
  });

  it("calibration is present once the settled floor is reached", () => {
    const summary = summarizeForecastCalibration([calRecord({ pickId: "p1" }), calRecord({ pickId: "p2" }), calRecord({ pickId: "p3" })]);
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes: [],
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: summary,
    });
    expect(d.calibration).not.toBeNull();
    expect(d.calibration!.settledCount).toBe(3);
  });

  it("an entirely empty week still produces a valid, empty dossier", () => {
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes: [],
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: null,
    });
    expect(d.leverRecords).toEqual([]);
    expect(d.totalDecided).toBe(0);
    expect(d.trends).toEqual([]);
    expect(d.seasonalWindows).toEqual([]);
    expect(d.languageGaps).toEqual([]);
    expect(d.calibration).toBeNull();
  });
});

describe("renderDossierForPrompt", () => {
  it("renders a compact, deterministic string with honest placeholders for empty sections", () => {
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes: [],
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: null,
    });
    const text = renderDossierForPrompt(d);
    expect(text).toContain("Week of: 2026-07-06");
    expect(text).toContain("(no settled results yet this week)");
    expect(text).toContain("(none)");
    expect(text).toContain("not enough settled picks yet");
  });

  it("includes lever win/loss lines when present", () => {
    const outcomes: SettledOutcome[] = [
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
      outcome({ verdict: "won", dims: { actionType: "answer_block" } }),
    ];
    const d = buildStrategyDossier({
      tenantId: "t",
      weekOf: "2026-07-06",
      outcomes,
      trends: [],
      seasonalWindows: [],
      languageGaps: [],
      calibration: null,
    });
    const text = renderDossierForPrompt(d);
    expect(text).toContain("answer_block: won 3 of 3");
  });
});
