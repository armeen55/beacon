/**
 * URL-level change outcome store — the memory the pattern brain eats.
 *
 * One record per (changelog entry × URL) once a URL-level verdict lands in a
 * terminal state (`helping` / `hurting` / `nothing_yet`). The recorder is
 * idempotent: re-running on the same (change, URL) pair updates the existing
 * record in place instead of duplicating. Verdict transitions (e.g., a change
 * that was `too_early` → now `helping`) mutate the record, stamping
 * `updated_at` while preserving `recorded_at`.
 *
 * This is intentionally SEPARATE from `change-outcome.ts` (the legacy
 * semantic-type-based `ChangeOutcome` store that feeds the rec engine). The
 * legacy store sees one record per change (aggregated across URLs / topics).
 * This store sees one per (change, URL) and is keyed for the new pattern brain
 * that groups by `edit_type_tokens × asset_type`.
 *
 * Phase 3 migrates the rec engine to consume this store; the legacy
 * `change-outcome.ts` gets deprecated then, not now.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { syncUrlChangeOutcomes } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { AssetType } from "@/lib/constants";
import { extractEditTokens, type EditToken } from "@/domains/changelog/dedupe";
import {
  computeUrlVerdict,
  type UrlVerdict,
  type VerdictLabel,
  type VerdictThresholds,
  DEFAULT_THRESHOLDS,
  type DailyPoint,
} from "./url-verdict";
import {
  denseSeries,
  getSeriesForUrl,
  normalizeUrl,
  type UrlCitationHistory,
  type UrlCitationSeries,
} from "@/domains/product/url-citation-history";

/** Verdicts that represent a settled outcome worth remembering in the brain. */
const TERMINAL_VERDICTS: ReadonlySet<VerdictLabel> = new Set([
  "helping",
  "hurting",
  "nothing_yet",
]);

export function isTerminalVerdict(v: VerdictLabel): boolean {
  return TERMINAL_VERDICTS.has(v);
}

/** One brain-readable outcome per (change, URL). */
export type UrlChangeOutcome = {
  change_id: string;
  url: string; // normalized path-only key
  edit_type_tokens: EditToken[];
  asset_type: AssetType;
  verdict: VerdictLabel;
  /** First day since change when |z| first crossed zBar; null for `nothing_yet`. */
  landing_day_n: number | null;
  /** z at landing (null for `nothing_yet`). */
  landing_z: number | null;
  delta_pct: number | null;
  delta_abs: number | null;
  baseline_days_used: number;
  post_days_used: number;
  sustain_up: number;
  sustain_down: number;
  confidence: "high" | "medium" | "low";
  /** ISO of the original record write. */
  recorded_at: string;
  /** ISO of the latest transition (may equal recorded_at). */
  updated_at: string;
  /**
   * Number of times the recorder has mutated this record (verdict flips,
   * stronger z, sustain changes). Helps auditors distinguish "observed once"
   * from "watched across multiple checkpoints."
   */
  transitions: number;
  /** Per-tenant isolation — Phase 6 ready. */
  tenant_id: string;
};

// In-memory cache, loaded at module init, persisted after writes.
export const urlChangeOutcomes: UrlChangeOutcome[] = readStore<UrlChangeOutcome>(
  "url-change-outcomes",
);

/**
 * Verdicts that count as "currently being watched" for UI surfaces (sidebar
 * badge, /changes strip, etc.). `helping` is a settled win \u2014 excluded from
 * watch counts. `not_enough_data` means we literally can't call it \u2014
 * excluded. Everything else represents live attention-worthy state.
 */
const WATCHING_VERDICTS: ReadonlySet<VerdictLabel> = new Set([
  "hurting",
  "nothing_yet",
  "too_early",
]);

/**
 * Return one row per distinct URL currently worth watching. If a URL has
 * multiple outcomes (multiple changes over time), keep the most recent one.
 * Replaces the old `getActiveExperiments()` in UI surfaces after Phase 2
 * of the experiments\u2192verdicts convergence (2026-04-19).
 */
export function getWatchingUrlOutcomes(): UrlChangeOutcome[] {
  const latestByUrl = new Map<string, UrlChangeOutcome>();
  for (const o of urlChangeOutcomes) {
    if (!WATCHING_VERDICTS.has(o.verdict)) continue;
    const existing = latestByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updated_at) {
      latestByUrl.set(o.url, o);
    }
  }
  return Array.from(latestByUrl.values());
}

// ---------------------------------------------------------------------------
// Landing-day computation
// ---------------------------------------------------------------------------

/**
 * Walk forward through the post-change window finding the smallest N where
 * the URL's Z-score-based verdict crosses into the target terminal state.
 * Returns null if never crossed within the available post-window.
 *
 * Bounded: at most `postWindowMaxDays` calls to `computeUrlVerdict` per
 * outcome record. With 30d cap and 300 changes × 16 URLs ≈ 144K max calls
 * per watcher run worst-case — verdict compute is ~50µs so ~7s max. Fine.
 */
export function findLandingDay(
  series: DailyPoint[],
  changeDate: string,
  targetVerdict: VerdictLabel,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): { day: number; z: number } | null {
  if (!TERMINAL_VERDICTS.has(targetVerdict)) return null;
  // `nothing_yet` doesn't have a discrete landing — it's "N days passed
  // without crossing." We return null; consumers treat landing_day_n=null
  // + verdict=nothing_yet as "settled via timeout, not crossing."
  if (targetVerdict === "nothing_yet") return null;

  // Walk N=1..postWindowMaxDays; first N where verdict matches is the landing.
  const maxN = thresholds.postWindowMaxDays;
  const changeMs = new Date(changeDate + "T00:00:00Z").getTime();

  for (let n = 1; n <= maxN; n++) {
    const asOfMs = changeMs + n * 86_400_000;
    const asOfISO = new Date(asOfMs).toISOString().slice(0, 10);

    const v = computeUrlVerdict({
      series,
      changeDate,
      asOfDate: asOfISO,
      thresholds,
    });

    if (v.verdict === targetVerdict && v.z !== null) {
      return { day: n, z: v.z };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recorder (idempotent upsert)
// ---------------------------------------------------------------------------

/**
 * Record or update a URL-level outcome for a (change, URL) pair.
 *
 * Idempotent: re-calling on the same pair either:
 *   - returns the existing record unchanged if nothing material moved, or
 *   - updates it in place with new verdict/z/sustain and bumps `transitions`.
 *
 * Only writes when the current verdict is terminal. Too-early / not-enough-data
 * return { status: "skipped" } — the brain doesn't need pre-landing state.
 *
 * Returns null when skipped; otherwise the up-to-date record (new or updated).
 */
export function recordUrlOutcome(input: {
  change: ChangelogEntry;
  normalizedUrl: string;
  verdict: UrlVerdict;
  series: DailyPoint[];
  thresholds?: VerdictThresholds;
}): UrlChangeOutcome | null {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const v = input.verdict;

  if (!isTerminalVerdict(v.verdict)) return null;

  const landing =
    v.verdict === "helping" || v.verdict === "hurting"
      ? findLandingDay(input.series, input.change.timestamp.slice(0, 10), v.verdict, thresholds)
      : null;

  const nowISO = new Date().toISOString();
  const editTypeTokens = [...extractEditTokens(input.change.change_description)];

  const existingIdx = urlChangeOutcomes.findIndex(
    (o) =>
      o.change_id === input.change.id && o.url === input.normalizedUrl,
  );

  const nextRecord: UrlChangeOutcome = {
    change_id: input.change.id,
    url: input.normalizedUrl,
    edit_type_tokens: editTypeTokens,
    asset_type: input.change.asset_type,
    verdict: v.verdict,
    landing_day_n: landing?.day ?? null,
    landing_z: landing?.z ?? null,
    delta_pct: v.delta_pct,
    delta_abs: v.delta_abs,
    baseline_days_used: v.explanation.math.baseline_days_used,
    post_days_used: v.post_days,
    sustain_up: v.sustain.up,
    sustain_down: v.sustain.down,
    confidence: v.confidence,
    recorded_at: nowISO,
    updated_at: nowISO,
    transitions: 0,
    tenant_id: input.change.tenant_id ?? "",
  };

  if (existingIdx === -1) {
    urlChangeOutcomes.push(nextRecord);
    return nextRecord;
  }

  // Upsert — only mutate when something material changed.
  const existing = urlChangeOutcomes[existingIdx];
  const materialChange =
    existing.verdict !== nextRecord.verdict ||
    existing.landing_day_n !== nextRecord.landing_day_n ||
    Math.abs((existing.landing_z ?? 0) - (nextRecord.landing_z ?? 0)) > 0.1 ||
    existing.sustain_up !== nextRecord.sustain_up ||
    existing.sustain_down !== nextRecord.sustain_down ||
    existing.confidence !== nextRecord.confidence;

  if (!materialChange) return existing;

  const updated: UrlChangeOutcome = {
    ...nextRecord,
    recorded_at: existing.recorded_at, // preserve original timestamp
    transitions: existing.transitions + 1,
  };
  urlChangeOutcomes[existingIdx] = updated;
  return updated;
}

// ---------------------------------------------------------------------------
// Batch compute + persistence
// ---------------------------------------------------------------------------

/**
 * Compute the URL verdict for a single changelog entry, if the entry's URL is
 * present in the citation history. Returns null if the entry is site-wide or
 * its URL has no series yet. Pure — does not record.
 *
 * Shared helper used by both the watcher (to record) and `/changes/page.tsx`
 * (to enrich rows for display). Single source of truth for "how do we turn a
 * changelog entry + URL history into a verdict."
 */
export function computeChangeVerdict(
  change: ChangelogEntry,
  history: UrlCitationHistory,
  asOfDate?: string,
  thresholds?: VerdictThresholds,
): {
  normalizedUrl: string;
  series: DailyPoint[];
  verdict: UrlVerdict;
} | null {
  const rawUrl = change.url?.trim() ?? "";
  const looksLikeUrl =
    rawUrl.startsWith("/") || /^https?:\/\//i.test(rawUrl);
  if (!looksLikeUrl) return null;

  const normUrl = normalizeUrl(rawUrl);
  if (!normUrl) return null;

  const seriesEntry: UrlCitationSeries | null = getSeriesForUrl(history, normUrl);
  if (!seriesEntry) return null;

  const range = {
    first: history.date_range.first ?? change.timestamp.slice(0, 10),
    last: history.date_range.last ?? new Date().toISOString().slice(0, 10),
  };
  const dense = denseSeries(seriesEntry, range);

  const verdict = computeUrlVerdict({
    series: dense,
    changeDate: change.timestamp.slice(0, 10),
    asOfDate: asOfDate ?? range.last,
    thresholds,
  });

  return { normalizedUrl: normUrl, series: dense, verdict };
}

/**
 * For every changelog entry: compute URL verdict, record if terminal.
 * Returns counts for watcher stats.
 *
 * Non-idempotent side effects are limited to the shared in-memory store +
 * a single persist call at the end (atomic write via `writeStore`).
 */
export async function materializeUrlOutcomes(input: {
  changes: ChangelogEntry[];
  history: UrlCitationHistory;
  asOfDate?: string;
  thresholds?: VerdictThresholds;
}): Promise<{ processed: number; recorded: number; transitions: number }> {
  const t0 = Date.now();
  let processed = 0;
  let newlyRecorded = 0;
  let transitionsAdded = 0;
  let transitionsBefore = urlChangeOutcomes.reduce(
    (acc, o) => acc + o.transitions,
    0,
  );
  const existingIds = new Set(
    urlChangeOutcomes.map((o) => `${o.change_id}::${o.url}`),
  );

  for (const change of input.changes) {
    if (change.archived) continue;
    const computed = computeChangeVerdict(
      change,
      input.history,
      input.asOfDate,
      input.thresholds,
    );
    if (!computed) continue;
    processed += 1;

    const recorded = recordUrlOutcome({
      change,
      normalizedUrl: computed.normalizedUrl,
      verdict: computed.verdict,
      series: computed.series,
      thresholds: input.thresholds,
    });
    if (!recorded) continue;

    const key = `${recorded.change_id}::${recorded.url}`;
    if (!existingIds.has(key)) {
      newlyRecorded += 1;
      existingIds.add(key);
    }
  }

  const transitionsAfter = urlChangeOutcomes.reduce(
    (acc, o) => acc + o.transitions,
    0,
  );
  transitionsAdded = transitionsAfter - transitionsBefore;

  await writeStore("url-change-outcomes", urlChangeOutcomes);
  await syncUrlChangeOutcomes(urlChangeOutcomes);

  log.info("URL outcomes materialized", {
    processed,
    newlyRecorded,
    transitionsAdded,
    total: urlChangeOutcomes.length,
    durationMs: Date.now() - t0,
  });

  return {
    processed,
    recorded: newlyRecorded,
    transitions: transitionsAdded,
  };
}
