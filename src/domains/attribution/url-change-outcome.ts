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

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { syncUrlChangeOutcomes } from "@/lib/persistence/dual-write";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { isLifecycleVerdictEnabled } from "@/lib/flags";
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
  type DailyPointSamplingStatus,
} from "./url-verdict";
import {
  denseSeries,
  getSeriesForUrl,
  normalizeUrl,
  type UrlCitationHistory,
  type UrlCitationSeries,
} from "@/domains/product/url-citation-history";
import {
  classifySampling,
  type SamplingStatus,
} from "@/domains/observations/poll-health";
import { getPromptAnswerObservations } from "@/storage/canonical-store";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

// ---------------------------------------------------------------------------
// S4 (operator audit, 2026-05-05) — sampling-status attribution wire-up
// ---------------------------------------------------------------------------

/**
 * Per-date sampling-status index. Built from `prompt_answer_observations`
 * once per materialize pass and stamped onto each `DailyPoint` in the
 * dense series so the verdict engine's M3 sampling-status guard can
 * actually fire (the guard is a no-op when no point carries the tag).
 *
 * Operator-locked rule (M3 + S4): "Proof / partial days should not
 * create or upgrade measured-win cards." A 5-prompt manual-proof
 * recovery run on day N must not turn a `nothing_yet` URL into
 * `helping` just because day N's two-cite count is +∞ over the
 * baseline.
 *
 * Pure. Deterministic. Empty input → empty map. Date keys are ISO
 * `YYYY-MM-DD` slices of `observed_at`.
 */
export function buildSamplingStatusByDate(
  observations: ReadonlyArray<PromptAnswerObservation>,
): Map<string, DailyPointSamplingStatus> {
  const countByDate = new Map<string, number>();
  for (const o of observations) {
    if (typeof o.observed_at !== "string" || o.observed_at.length < 10) continue;
    const date = o.observed_at.slice(0, 10);
    countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
  }
  const out = new Map<string, DailyPointSamplingStatus>();
  for (const [date, count] of countByDate) {
    const status: SamplingStatus = classifySampling(count);
    // SamplingStatus and DailyPointSamplingStatus are the same string
    // union; the cast is a structural identity, not a re-mapping.
    out.set(date, status as DailyPointSamplingStatus);
  }
  return out;
}

/**
 * Stamp `sampling_status` onto each point in a dense series whose date
 * appears in the supplied map. Returns a NEW array — never mutates the
 * caller's series. Untagged dates are left as-is (back-compat).
 *
 * Pure. Used by `computeChangeVerdict` after `denseSeries` returns.
 */
export function stampSamplingStatus(
  series: ReadonlyArray<DailyPoint>,
  samplingStatusByDate: ReadonlyMap<string, DailyPointSamplingStatus> | undefined,
): DailyPoint[] {
  if (!samplingStatusByDate || samplingStatusByDate.size === 0) {
    return [...series];
  }
  return series.map((p) => {
    const tag = samplingStatusByDate.get(p.date);
    if (!tag) return p;
    return { ...p, sampling_status: tag };
  });
}

/** Verdicts that represent a settled outcome worth remembering in the brain. */
const TERMINAL_VERDICTS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  "helping",
  "hurting",
  "nothing_yet",
  // Phase 4 (2026-04-27): not_implemented is terminal — the operator
  // would need to either (a) implement the edit (re-scan would
  // promote to verified_live) or (b) dismiss it. Either path
  // requires explicit action; the verdict engine does not change it
  // on its own.
  "not_implemented",
]);

export function isTerminalVerdict(v: VerdictLabel): boolean {
  return TERMINAL_VERDICTS.has(v);
}

/**
 * Phase 4 (2026-04-27): pure helper. Builds the join key used to look
 * up a `recommended_edits` row from a `changelog_entries` row.
 *
 * Both sides of the join (changelog → recommended_edits) carry the
 * same triple: `source_rec_id` / `action_type` / `target_element_key`.
 * `target_element_key` may be null on page-level edits — we encode
 * the null literally so two DIFFERENT page-level edits on the same
 * rec don't collide (the `(rec_id, action_type, "")` tuple uniquely
 * identifies the page-level row's recommended_edits id).
 *
 * Returns `null` when the changelog row lacks the required linkage
 * fields (legacy rows, imported CSV rows, scan-confirmed rows). The
 * caller skips the lifecycle short-circuit for null keys — those
 * rows fall through to the standard Z-score path.
 */
export function lifecycleLookupKey(input: {
  source_rec_id?: string | null;
  action_type?: string | null;
  target_element_key?: string | null;
}): string | null {
  const recId = input.source_rec_id;
  const action = input.action_type;
  if (!recId || recId.length === 0) return null;
  if (!action || action.length === 0) return null;
  const elementKey = input.target_element_key ?? "";
  return `${recId}::${action}::${elementKey}`;
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

// In-memory cache, lazy-loaded on first getter call, persisted after writes.
// Sprint 7 Phase 7.8e-3 (2026-04-26): the previous module-level top-level
// `await readStore(...)` (with `ensureUrlChangeOutcomesSeeded()` running
// the DB merge on Vercel) is replaced with a cached async getter. Phase
// 3.5C DB-merge logic preserved verbatim — runs on first getter call when
// DATA_SOURCE=supabase.
let _state: UrlChangeOutcome[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await readStore<UrlChangeOutcome>("url-change-outcomes");

  // Phase 3.5C (2026-04-22): on Vercel / DATA_SOURCE=supabase the disk read
  // above returned [] because the JSON file doesn't exist on the read-only
  // FS. Merge from `url_change_outcomes` table so getters see real data.
  if (process.env.DATA_SOURCE === "supabase") {
    try {
      const tenantId = await currentTenantId();
      const rows = await getRepository().forTenant(tenantId).getUrlChangeOutcomes();
      const byKey = new Map<string, UrlChangeOutcome>();
      for (const o of _state) {
        byKey.set(`${o.change_id}::${o.url}`, o);
      }
      for (const o of rows) {
        const k = `${o.change_id}::${o.url}`;
        const cur = byKey.get(k);
        if (!cur || o.updated_at > cur.updated_at) byKey.set(k, o);
      }
      _state.length = 0;
      _state.push(...byKey.values());
    } catch (e) {
      console.error("[url-change-outcomes] DB seed failed:", e);
    }
  }
});

export const getUrlChangeOutcomes = cache(
  async (): Promise<UrlChangeOutcome[]> => {
    await ensureLoaded();
    return _state!;
  },
);

/**
 * Backwards-compat shim. Pre-7.8e-3 callers chained
 * `ensureUrlChangeOutcomesSeeded()` to force the DB merge. Post-7.8e-3
 * the merge runs automatically on first getter call. Kept as a proxy
 * so caller cascade stays minimal.
 */
export async function ensureUrlChangeOutcomesSeeded(): Promise<void> {
  await ensureLoaded();
}

/** Resets the seed cache. Call after a write that should be reflected on
 *  the next read in this process. */
export function invalidateUrlChangeOutcomesSeed(): void {
  _state = null;
}

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
export async function getWatchingUrlOutcomes(): Promise<UrlChangeOutcome[]> {
  const urlChangeOutcomes = await getUrlChangeOutcomes();
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
export async function recordUrlOutcome(input: {
  change: ChangelogEntry;
  normalizedUrl: string;
  verdict: UrlVerdict;
  series: DailyPoint[];
  thresholds?: VerdictThresholds;
  /**
   * Phase 4 (2026-04-27): when true, landing-day resolution uses
   * `change.live_at ?? change.timestamp` to keep the landing-day
   * relative to the same baseline date the verdict engine used. When
   * false / absent, uses `change.timestamp` (pre-Phase-4 behavior).
   */
  useLiveAt?: boolean;
}): Promise<UrlChangeOutcome | null> {
  const urlChangeOutcomes = await getUrlChangeOutcomes();
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const v = input.verdict;

  if (!isTerminalVerdict(v.verdict)) return null;

  const landing =
    v.verdict === "helping" || v.verdict === "hurting"
      ? findLandingDay(
          input.series,
          resolveChangeDate(input.change, input.useLiveAt === true),
          v.verdict,
          thresholds,
        )
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
/**
 * Phase 4 (2026-04-27) options for the verdict engine. Both fields
 * default to off / null so legacy callers (and the entire flag-OFF
 * code path) get byte-identical behavior.
 */
export type ComputeVerdictOptions = {
  /**
   * When true, baseline-split timestamp = `change.live_at ?? change.timestamp`.
   * When false / absent, baseline-split timestamp = `change.timestamp`
   * (pre-Phase-4 behavior).
   */
  useLiveAt?: boolean;
  /**
   * When set, short-circuits Z-score computation and returns a
   * synthetic verdict with this label. v1 only supports
   * `"not_implemented"` — for changelog entries linked to
   * `recommended_edits` rows in `not_found_after_7d` lifecycle state.
   */
  forceVerdict?: "not_implemented";
  /**
   * S4 (operator audit, 2026-05-05) — per-date sampling status. When
   * supplied, each point in the dense series is stamped with the
   * matching status before the verdict engine runs. The engine's M3
   * sampling-status guard then demotes `helping`/`hurting` to
   * `nothing_yet` when the post-window contains any `proof` day or
   * has zero `full` days. Without this map the guard is a no-op
   * (back-compat), so calling code that doesn't care about sampling
   * keeps the original Z-score-only behavior.
   */
  samplingStatusByDate?: ReadonlyMap<string, DailyPointSamplingStatus>;
};

/**
 * Phase 4 (2026-04-27): pure helper resolving the baseline-split
 * timestamp. Exported so the runner + UI can stay in lock-step with
 * the verdict engine.
 *
 * Returns `change.timestamp.slice(0, 10)` when `useLiveAt` is false
 * OR when the entry has no `live_at`. Backwards compatible by
 * construction.
 */
export function resolveChangeDate(
  change: ChangelogEntry,
  useLiveAt: boolean,
): string {
  if (useLiveAt && change.live_at && change.live_at.length > 0) {
    return change.live_at.slice(0, 10);
  }
  return change.timestamp.slice(0, 10);
}

/**
 * Phase 4 (2026-04-27): synthetic verdict for the `not_implemented`
 * label. No Z-score, no series consumption, zeroed math fields.
 * Confidence is `"high"` because the lifecycle status itself is the
 * authoritative signal (operator accepted; ≥7d passed; scan never
 * found the change).
 */
function buildNotImplementedVerdict(): UrlVerdict {
  return {
    verdict: "not_implemented",
    z: null,
    delta_pct: null,
    delta_abs: null,
    post_days: 0,
    confidence: "high",
    sustain: { up: 0, down: 0 },
    explanation: {
      summary:
        "Beacon scanned the page for 7+ days after Accept and never found the proposed change live. No attribution computed.",
      math: {
        baseline_days_used: 0,
        mu_pre: 0,
        sigma_pre_raw: 0,
        sigma_pre_used: 0,
        post_days_used: 0,
        mu_post: 0,
        z: 0,
        sustain_up: 0,
        sustain_down: 0,
      },
    },
  };
}

export function computeChangeVerdict(
  change: ChangelogEntry,
  history: UrlCitationHistory,
  asOfDate?: string,
  thresholds?: VerdictThresholds,
  options?: ComputeVerdictOptions,
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

  const useLiveAt = options?.useLiveAt === true;
  const changeDate = resolveChangeDate(change, useLiveAt);

  // Phase 4: not_implemented short-circuit. No history needed — the
  // verdict is fully determined by the upstream lifecycle status.
  // Caller is responsible for resolving the lifecycle status before
  // calling (keeps this module decoupled from the recommendations
  // domain — the engine never imports `RecommendedEditRow`).
  if (options?.forceVerdict === "not_implemented") {
    return {
      normalizedUrl: normUrl,
      series: [],
      verdict: buildNotImplementedVerdict(),
    };
  }

  const seriesEntry: UrlCitationSeries | null = getSeriesForUrl(history, normUrl);
  if (!seriesEntry) return null;

  const range = {
    first: history.date_range.first ?? changeDate,
    last: history.date_range.last ?? new Date().toISOString().slice(0, 10),
  };
  const denseRaw = denseSeries(seriesEntry, range);

  // S4 (operator audit, 2026-05-05) — stamp the per-date sampling
  // status before the verdict engine sees the points. When the option
  // is undefined, this is a no-op (back-compat). When present, the
  // engine's M3 guard demotes `helping`/`hurting` → `nothing_yet` if
  // the post-window includes any proof day OR no full days.
  const dense = stampSamplingStatus(denseRaw, options?.samplingStatusByDate);

  const verdict = computeUrlVerdict({
    series: dense,
    changeDate,
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
  // Phase 7.7b Commit 5 (2026-04-25): server-context tenant resolution.
  const tenantId = await currentTenantId();
  // Phase 3.5C: seed from Supabase before mutating so a cold Vercel lambda
  // doesn't overwrite 120 existing rows with only its new ones.
  await ensureUrlChangeOutcomesSeeded();
  const urlChangeOutcomes = await getUrlChangeOutcomes();
  const t0 = Date.now();
  let processed = 0;
  let newlyRecorded = 0;
  let transitionsAdded = 0;
  const transitionsBefore = urlChangeOutcomes.reduce(
    (acc, o) => acc + o.transitions,
    0,
  );
  const existingIds = new Set(
    urlChangeOutcomes.map((o) => `${o.change_id}::${o.url}`),
  );

  // Phase 4 (2026-04-27): resolve the verdict flag once. When OFF,
  // skip the recommended_edits load + lifecycle-status lookup
  // entirely so flag-OFF runs are byte-identical to pre-Phase-4.
  const useLifecycleVerdict = isLifecycleVerdictEnabled();
  let lifecycleStatusByKey: Map<string, string> | null = null;
  if (useLifecycleVerdict) {
    try {
      const repo = getRepository().forTenant(tenantId);
      const allEdits = await repo.getRecommendedEdits();
      lifecycleStatusByKey = new Map();
      for (const e of allEdits) {
        const status = e.implementation_status ?? "recommended";
        const key = lifecycleLookupKey({
          source_rec_id: e.rec_id,
          action_type: e.action_type,
          target_element_key: e.target_element_key,
        });
        if (key !== null) lifecycleStatusByKey.set(key, status);
      }
    } catch (err) {
      log.warn("[verdict-engine] lifecycle status load failed; running without", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through with null map — verdict engine still runs the
      // standard Z-score path; just no `not_implemented` short-circuit.
    }
  }

  // S4 (operator audit, 2026-05-05) — build sampling-status-by-date once
  // per pass from prompt_answer_observations counts. Stamped onto each
  // dense-series point so the verdict engine's M3 guard can demote
  // helping/hurting verdicts whose post-window includes proof/partial
  // days. Failure to load observations is non-fatal: we fall back to
  // an empty map (untagged points; guard is a no-op).
  let samplingStatusByDate: Map<string, DailyPointSamplingStatus> = new Map();
  try {
    const observations = await getPromptAnswerObservations();
    samplingStatusByDate = buildSamplingStatusByDate(observations);
  } catch (err) {
    log.warn(
      "[verdict-engine] sampling-status load failed; running without S4 guard",
      {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  for (const change of input.changes) {
    if (change.archived) continue;

    // Phase 4: resolve forceVerdict from the lifecycle map (only when
    // flag is ON + map loaded + entry has the linkage fields).
    let forceVerdict: ComputeVerdictOptions["forceVerdict"] | undefined;
    if (useLifecycleVerdict && lifecycleStatusByKey) {
      const key = lifecycleLookupKey({
        source_rec_id: change.source_rec_id,
        action_type: change.action_type,
        target_element_key: change.target_element_key,
      });
      if (key !== null && lifecycleStatusByKey.get(key) === "not_found_after_7d") {
        forceVerdict = "not_implemented";
      }
    }

    // S4: pass the sampling-status map on every call. When the
    // lifecycle short-circuit is forced, the engine returns the
    // synthetic verdict early and the map is unused — fine.
    const verdictOptions: ComputeVerdictOptions = useLifecycleVerdict
      ? { useLiveAt: true, forceVerdict, samplingStatusByDate }
      : { samplingStatusByDate };

    const computed = computeChangeVerdict(
      change,
      input.history,
      input.asOfDate,
      input.thresholds,
      verdictOptions,
    );
    if (!computed) continue;
    processed += 1;

    // D4 (operator audit, 2026-05-05) — observability log when the M3
    // sampling-status guard demoted a helping/hurting verdict to
    // nothing_yet. Operator's brief: "Add a structured log when
    // sampling-status guard demotes or blocks a verdict." Emitted at
    // `warn` level so it surfaces in dashboards by default — a demotion
    // is operationally interesting (a measured-win was suppressed
    // because the post-window contained proof/partial data). No
    // behavior change; the demotion already happened in
    // `computeUrlVerdict`.
    if (computed.verdict.sampling_guard_demoted) {
      const demotion = computed.verdict.sampling_guard_demoted;
      log.warn("[verdict-engine] sampling-status guard demoted verdict", {
        tenantId,
        changeId: change.id,
        url: computed.normalizedUrl,
        windowAsOf: input.asOfDate ?? null,
        originalVerdict: demotion.from,
        demotedVerdict: demotion.to,
        reason: demotion.reason,
      });
    }

    const recorded = await recordUrlOutcome({
      change,
      normalizedUrl: computed.normalizedUrl,
      verdict: computed.verdict,
      series: computed.series,
      thresholds: input.thresholds,
      useLiveAt: useLifecycleVerdict,
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
  await syncUrlChangeOutcomes(urlChangeOutcomes, tenantId);

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
