/**
 * shadow-portfolio-measure (2026-07-02, master plan item 65) - the I/O edge that turns the
 * captured shadow batches (shadow-portfolio-store.ts) + the proof ledger into the two row
 * arrays src/domains/proof-gsc/shadow-portfolio-drift.ts compares:
 *   - SELECTED cohort: every mature, clean, settled ledger record's own already-computed basis
 *     window (treatedDelta/controlDelta/scaledBaseline), reused AS-IS - no new GSC read needed,
 *     mirrors scoreboard-section.tsx's buildCounterfactualRows (item 41) exactly.
 *   - SHADOW cohort: for each captured-but-never-shipped candidate, a fresh pre/post click read
 *     anchored at its OWN capture date, using the SAME bounded readWindowForPages the proof
 *     engine already relies on (gsc-window.ts) - one page at a time never happened; this fans
 *     the shadow batch's pages into a single pair of cumulative reads per matched window length.
 *
 * Fail-soft throughout: any read error yields fewer usable rows (never a throw), so a bad night
 * degrades to "the comparison stayed silent" rather than crashing the /results render.
 */
import "server-only";

import { loadShippedChanges, type ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  deriveMeasurementMaturity, detectMeasurementOverlaps, measurementWindowOf, isMatureOutcome,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { buildShockWindows, overlappingShock, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { PROOF_BASELINE_WINDOW_DAYS, addDays, type ProofWindowResult } from "@/domains/proof-gsc/measure";
import { readWindowForPages } from "@/domains/proof-gsc/gsc-window";
import {
  buildShadowCalibrationFeed,
  type SelectedPickDriftRow, type ShadowDriftRow, type ShadowForecastDriftRow, type ShadowCalibrationFeed,
} from "@/domains/proof-gsc/shadow-portfolio-drift";
import { readShadowPortfolioCandidates, type ShadowCandidateRecord } from "./shadow-portfolio-store";

async function loadShockWindowsForGate(tenantId: string): Promise<ShockWindow[]> {
  try {
    const changepoints = await loadDetectedChangepoints(tenantId);
    return buildShockWindows({ dailySeries: [], priorChangepoints: changepoints });
  } catch {
    return [];
  }
}

function basisWindowOf(record: ShippedChangeRecord): ProofWindowResult | null {
  const ran = (record.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day);
  return ran[0] ?? null;
}

function isMatureAndClean(
  record: ShippedChangeRecord,
  overlap: OverlapContext | null,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): boolean {
  const basis = basisWindowOf(record);
  const maturity = deriveMeasurementMaturity({
    shippedAt: record.shippedAt,
    now,
    latestGscDate: null,
    windows: (record.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
    verdict: record.verdict,
    controlsUsed: basis?.controlsUsed ?? 0,
    baselineImpressions: record.baseline?.impressions ?? 0,
    overlap,
    live: true,
  });
  if (!isMatureOutcome(maturity)) return false;
  const window = measurementWindowOf(record.shippedAt, record.windows ?? []);
  if (window && shockWindows.length > 0 && overlappingShock(window.start, window.end, shockWindows)) return false;
  if (record.controlMatchWeak === true) return false;
  return true;
}

/**
 * The SELECTED cohort's drift rows: every mature, clean, settled ledger record's basis window,
 * expressed as an already diff-in-diff adjusted percent of its own pre-ship baseline. Mirrors
 * scoreboard-section.tsx's item-41 buildCounterfactualRows gate exactly (same eligibility), but
 * returns the PERCENT form shadow-portfolio-drift.ts's SelectedPickDriftRow needs directly,
 * rather than the raw {treatedDelta, controlDelta, scaledBaseline} portfolio-counterfactual.ts
 * consumes - two different pure aggregators reading the same ledger for two different sentences.
 */
export function buildSelectedDriftRows(ledger: ShippedChangeRecord[], now: Date, shockWindows: ShockWindow[]): SelectedPickDriftRow[] {
  const overlaps = detectMeasurementOverlaps(ledger.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const rows: SelectedPickDriftRow[] = [];
  for (const r of ledger) {
    if (!isMatureAndClean(r, overlaps.get(r.id) ?? null, now, shockWindows)) continue;
    const basis = basisWindowOf(r);
    if (!basis || basis.controlsUsed <= 0) continue;
    const baselineClicks = r.baseline?.clicks ?? 0;
    const scaledBaseline = baselineClicks * (basis.day / PROOF_BASELINE_WINDOW_DAYS);
    if (!Number.isFinite(scaledBaseline) || scaledBaseline <= 0) continue;
    rows.push({
      id: r.id,
      adjustedPct: (basis.treatedDelta - basis.controlDelta) / scaledBaseline,
      windowDays: basis.day,
    });
  }
  return rows;
}

const SHADOW_WINDOW_DAYS = 28; // matches PROOF_BASELINE_WINDOW_DAYS / the ledger's own 28-day basis

/**
 * The SHADOW cohort's drift rows: for each captured-but-skipped candidate old enough to have a
 * full post-capture window, a raw pre/post click read anchored at its own capture date. Bounded:
 * one pair of cumulative reads PER DISTINCT capture date (readWindowForPages already batches all
 * of that date's pages into a single RPC call each), never one call per page.
 */
export async function buildShadowDriftRows(
  tenantId: string,
  candidates: ReadonlyArray<ShadowCandidateRecord>,
  now: Date,
  windowDays: number = SHADOW_WINDOW_DAYS,
): Promise<ShadowDriftRow[]> {
  const byCaptureDate = new Map<string, ShadowCandidateRecord[]>();
  for (const c of candidates) {
    const capturedDate = c.capturedAt.slice(0, 10);
    // Only a candidate whose post window has fully elapsed contributes - a batch captured last
    // night has no "same weeks" to report yet, honest silence beats a truncated read.
    const postEnd = addDays(capturedDate, windowDays);
    if (postEnd > now.toISOString().slice(0, 10)) continue;
    const list = byCaptureDate.get(capturedDate) ?? [];
    list.push(c);
    byCaptureDate.set(capturedDate, list);
  }

  const rows: ShadowDriftRow[] = [];
  for (const [capturedDate, group] of byCaptureDate) {
    const preStart = addDays(capturedDate, -windowDays);
    const postEnd = addDays(capturedDate, windowDays);
    const pages = group.map((c) => c.page);
    try {
      const [pre, post] = await Promise.all([
        readWindowForPages({ tenantId, pages, start: preStart, end: capturedDate }),
        readWindowForPages({ tenantId, pages, start: capturedDate, end: postEnd }),
      ]);
      for (const c of group) {
        const preM = pre.get(c.page);
        const postM = post.get(c.page);
        if (!preM || !postM) continue; // fail-soft: no GSC presence for this page, skip the row
        rows.push({
          id: `${c.planId}::${c.pagePath}`,
          rawDelta: postM.clicks - preM.clicks,
          scaledBaseline: preM.clicks,
          windowDays,
        });
      }
    } catch {
      /* fail-soft: this capture date's group contributes nothing, others still can */
    }
  }
  return rows;
}

/**
 * Item 65 part 4 - the same shadow drift rows, paired with the numeric forecast each candidate
 * would have carried had it been selected (item 27/28), for the calibration feed. Candidates
 * with no numeric forecast (the opportunity was too small to forecast honestly) are excluded -
 * there is nothing to compare their drift against.
 */
export async function buildShadowForecastDriftRows(
  tenantId: string,
  candidates: ReadonlyArray<ShadowCandidateRecord>,
  now: Date,
  windowDays: number = SHADOW_WINDOW_DAYS,
): Promise<ShadowForecastDriftRow[]> {
  const withForecast = candidates.filter((c) => c.forecastLow != null && c.forecastHigh != null);
  const driftRows = await buildShadowDriftRows(tenantId, withForecast, now, windowDays);
  const forecastById = new Map(withForecast.map((c) => [`${c.planId}::${c.pagePath}`, c]));
  const out: ShadowForecastDriftRow[] = [];
  for (const d of driftRows) {
    const c = forecastById.get(d.id);
    if (!c || c.forecastLow == null || c.forecastHigh == null) continue;
    out.push({ id: d.id, rawDelta: d.rawDelta, windowDays: d.windowDays, forecastLow: c.forecastLow, forecastHigh: c.forecastHigh });
  }
  return out;
}

export type ShadowPortfolioMeasurement = {
  selected: SelectedPickDriftRow[];
  shadow: ShadowDriftRow[];
  forecastFeed: ShadowForecastDriftRow[];
};

/** Fail-soft top-level loader: everything a caller (the /results or Today surface) needs to render
 *  the picked-vs-skipped line and the drift calibration feed, in one bounded call. Any partial
 *  failure degrades to fewer rows, never a throw - the surface's own honest-minimum gate decides
 *  whether to speak. */
export async function loadShadowPortfolioMeasurement(tenantId: string, now: Date = new Date()): Promise<ShadowPortfolioMeasurement> {
  try {
    const [ledger, shadowCandidates, shockWindows] = await Promise.all([
      loadShippedChanges().catch(() => [] as ShippedChangeRecord[]),
      readShadowPortfolioCandidates(tenantId, now).catch(() => [] as ShadowCandidateRecord[]),
      loadShockWindowsForGate(tenantId),
    ]);
    const selected = buildSelectedDriftRows(ledger, now, shockWindows);
    const [shadow, forecastFeed] = await Promise.all([
      buildShadowDriftRows(tenantId, shadowCandidates, now).catch(() => [] as ShadowDriftRow[]),
      buildShadowForecastDriftRows(tenantId, shadowCandidates, now).catch(() => [] as ShadowForecastDriftRow[]),
    ]);
    return { selected, shadow, forecastFeed };
  } catch {
    return { selected: [], shadow: [], forecastFeed: [] };
  }
}

/**
 * Item 65 part 4 - the drift-vs-forecast calibration feed, ready for a consumer to fold into a
 * bias correction. NOT wired into pick-expectations.ts here by design (that file may be under
 * concurrent edit from item 64 this cycle); a future one-line follow-up is:
 *   const shadowFeed = await loadShadowCalibrationFeed(tenantId);
 *   // fold shadowFeed.driftToForecastRatio into whatever correction pick-expectations.ts applies
 * Fail-soft -> null (identical to "no calibration feed yet").
 */
export async function loadShadowCalibrationFeed(tenantId: string, now: Date = new Date()): Promise<ShadowCalibrationFeed | null> {
  try {
    const { forecastFeed } = await loadShadowPortfolioMeasurement(tenantId, now);
    return buildShadowCalibrationFeed(forecastFeed);
  } catch {
    return null;
  }
}
