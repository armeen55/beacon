import "server-only";

/**
 * strategy-review/build-dossier (2026-07-02, BEACON 500 item 51) - the deterministic,
 * $0 dossier the weekly strategy review reads before it proposes a lever mix. Two
 * halves, kept separate on purpose:
 *
 *   - buildStrategyDossier (PURE): folds already-loaded settled outcomes, priors,
 *     trend/seasonal/language-gap findings, and the calibration bias into one
 *     compact, bounded JSON-shaped object. No I/O, deterministic, unit-tested
 *     without touching a store.
 *   - loadStrategyDossier (I/O shell): calls the EXISTING loaders this codebase
 *     already has for every one of those inputs (load-experiment-outcomes.ts,
 *     experiment-prior.ts, the item 14/21/24 stores, the item 27/28 calibration
 *     store) and hands the pure builder plain data. Every read is fail-soft: a
 *     missing/broken source degrades to an empty slice, never a thrown error -
 *     a thin week still gets a (conservative) dossier, never a crash.
 *
 * Bounded: at most PRIOR_DIMENSIONS x N families, MAX_TRENDS trend lines, MAX_SEASONAL
 * windows, MAX_LANGUAGE_GAPS gaps - the LLM prompt built from this stays small and cheap
 * regardless of how much history a tenant accumulates.
 */

import { loadExperimentOutcomes } from "@/domains/learning/load-experiment-outcomes";
import { computeDimPriors, type DimPrior, type SettledOutcome } from "@/domains/learning/experiment-prior";
import { loadQuerySpikes } from "@/domains/trend-radar/spike-store";
import type { QuerySpike } from "@/domains/trend-radar/query-spikes";
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import type { SeasonalQuery } from "@/domains/seasonal/seasonality";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";

const MAX_TRENDS = 5;
const MAX_SEASONAL = 5;

/** One lever family's won/lost record for the week the LLM reads. Mirrors DimPrior's
 *  actionType bucket, but only the fields the review needs (no internal multiplier
 *  math leaks into the prompt - the LLM proposes weights fresh from won/lost counts). */
export type DossierLeverRecord = {
  family: string;
  won: number;
  lost: number;
  decided: number;
  winRate: number;
};

export type DossierTrend = { query: string; thisWeek: number; typicalWeek: number; ratio: number | null };
export type DossierSeasonalWindow = { query: string; peakMonths: number[]; share: number };

export type StrategyDossier = {
  tenantId: string;
  weekOf: string; // ISO date (Monday) the dossier covers
  /** Per-actionFamily won/lost record from THIS tenant's settled proof ledger
   *  (maturity/weather/weak-comparison gated - see load-experiment-outcomes.ts). */
  leverRecords: DossierLeverRecord[];
  /** Total decided (won+lost) settled outcomes behind leverRecords - the honesty
   *  floor: a near-zero number means the review should stay conservative. */
  totalDecided: number;
  /** This week's demand spikes (item 14), biggest ratio first. */
  trends: DossierTrend[];
  /** Active/upcoming seasonal windows (item 21), biggest share first. */
  seasonalWindows: DossierSeasonalWindow[];
  /** Forecast calibration bias (item 28): null when too thin to trust (matches
   *  summarizeForecastCalibration's own MIN_SETTLED_FOR_CALIBRATION floor). */
  calibration: { settledCount: number; hotColdPct: number; sentence: string | null } | null;
};

/** PURE: fold already-computed priors + trend/seasonal + calibration slices into
 *  the bounded dossier shape. No I/O. */
export function buildStrategyDossier(input: {
  tenantId: string;
  weekOf: string;
  outcomes: readonly SettledOutcome[];
  trends: readonly QuerySpike[];
  seasonalWindows: readonly SeasonalQuery[];
  calibration: ReturnType<typeof summarizeForecastCalibration> | null;
}): StrategyDossier {
  const priors = computeDimPriors(input.outcomes);
  const actionTypePriors: DimPrior[] = [...priors.values()].filter((p) => p.dimension === "actionType");
  // Sort by decided sample size (the most-evidenced families first) so a bounded
  // prompt keeps the highest-confidence records if it ever needs to trim.
  actionTypePriors.sort((a, b) => b.decided - a.decided);

  const leverRecords: DossierLeverRecord[] = actionTypePriors.map((p) => ({
    family: p.value,
    won: p.won,
    lost: p.lost,
    decided: p.decided,
    winRate: Math.round(p.winRate * 100) / 100,
  }));
  const totalDecided = leverRecords.reduce((s, r) => s + r.decided, 0);

  const trends: DossierTrend[] = [...input.trends]
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, MAX_TRENDS)
    .map((t) => ({ query: t.query, thisWeek: t.thisWeek, typicalWeek: t.typicalWeek, ratio: t.ratio }));

  const seasonalWindows: DossierSeasonalWindow[] = [...input.seasonalWindows]
    .sort((a, b) => b.share - a.share)
    .slice(0, MAX_SEASONAL)
    .map((s) => ({ query: s.query, peakMonths: s.peakMonths, share: Math.round(s.share * 100) / 100 }));

  const calibration =
    input.calibration && input.calibration.settledCount >= MIN_SETTLED_FOR_CALIBRATION
      ? {
          settledCount: input.calibration.settledCount,
          hotColdPct: input.calibration.hotColdPct,
          sentence: input.calibration.sentence,
        }
      : null;

  return {
    tenantId: input.tenantId,
    weekOf: input.weekOf,
    leverRecords,
    totalDecided,
    trends,
    seasonalWindows,
    calibration,
  };
}

/** I/O shell: read every existing source (fail-soft, each degrades to an empty
 *  slice on its own) and hand plain data to the pure builder above. */
export async function loadStrategyDossier(tenantId: string, weekOf: string): Promise<StrategyDossier> {
  const [outcomes, trends, seasonalWindows, calibrationRecords] = await Promise.all([
    loadExperimentOutcomes(tenantId).catch(() => []),
    loadQuerySpikes(tenantId).catch(() => []),
    loadSeasonalQueries(tenantId).catch(() => []),
    loadCalibrationRecords(tenantId).catch(() => []),
  ]);
  const calibration = calibrationRecords.length > 0 ? summarizeForecastCalibration(calibrationRecords) : null;
  return buildStrategyDossier({ tenantId, weekOf, outcomes, trends, seasonalWindows, calibration });
}

/** Compact single-string rendering of the dossier for the LLM user prompt +
 *  the numeric-fidelity firewall's grounding text. Deterministic, bounded. */
export function renderDossierForPrompt(d: StrategyDossier): string {
  const leverLines =
    d.leverRecords.length > 0
      ? d.leverRecords.map((r) => `- ${r.family}: won ${r.won} of ${r.decided} (${Math.round(r.winRate * 100)}%)`).join("\n")
      : "(no settled results yet this week)";
  const trendLines =
    d.trends.length > 0
      ? d.trends
          .map((t) => `- "${t.query}": ${t.thisWeek} this week vs ${t.typicalWeek} typical${t.ratio != null ? ` (${t.ratio}x)` : ""}`)
          .join("\n")
      : "(none)";
  const seasonalLines =
    d.seasonalWindows.length > 0
      ? d.seasonalWindows.map((s) => `- "${s.query}": peaks month(s) ${s.peakMonths.join(",")}, ${Math.round(s.share * 100)}% of annual demand`).join("\n")
      : "(none)";
  const calibrationLine = d.calibration
    ? `Forecast calibration: ${d.calibration.settledCount} settled, running ${d.calibration.hotColdPct > 0 ? `${d.calibration.hotColdPct}% hot` : d.calibration.hotColdPct < 0 ? `${Math.abs(d.calibration.hotColdPct)}% cold` : "on target"}.`
    : "Forecast calibration: not enough settled picks yet.";

  return [
    `Week of: ${d.weekOf}`,
    `Total decided settled outcomes this week: ${d.totalDecided}`,
    "",
    "Lever win/loss record:",
    leverLines,
    "",
    "This week's demand spikes:",
    trendLines,
    "",
    "Active/upcoming seasonal windows:",
    seasonalLines,
    "",
    calibrationLine,
  ].join("\n");
}
