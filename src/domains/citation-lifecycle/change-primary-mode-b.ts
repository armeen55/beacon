/**
 * Section 6 C6a (2026-05-15) — Mode B: affected-prompt uplift evidence
 * for a single recommended-edit on Changes detail.
 *
 * Pure compute. Given a recommended edit, its affected prompt IDs, and
 * the tenant-scoped daily-metric-snapshot rows, computes per-platform:
 *
 *   - pre window  = [live_at_date - 14 days, live_at_date)   exclusive of live_at day
 *   - post window = [live_at_date,           live_at_date + 14 days)  inclusive of live_at day
 *   - pre_count / pre_total / post_count / post_total = sums over the
 *     prompt-scope (`scope_type='prompt'`, `source_type='derived'`)
 *     snapshot rows whose `scope_id` is in the deduped affected-prompt
 *     set and `platform` matches the target.
 *   - status = "pass" / "still_learning" / "silent" — decided on RAW
 *     pre/post shares + raw_delta_pp (not rounded display fields).
 *     Borderline-rounding traps (4/10 → 449/1000: raw_delta 4.9pp but
 *     rounded delta_pp = 5 → silent) are pinned in
 *     `tests/domains/citation-lifecycle/change-primary-mode-b.test.ts`.
 *
 * Evaluation order (Section 6 R2 / Blocker 6 lock):
 *   1. Hard silence (eligibility, live_match_kind, affected prompts empty).
 *      `eligibility.reason` ∈ {"missing_target_url", "needs_new_page"}
 *      does NOT silence Mode B — Mode B is anchored to affected prompts +
 *      live_at, not URL.
 *   2. If days_since_live < 14 → BOTH platforms still_learning. Short-
 *      circuits BEFORE any sample compute so an early edit with
 *      accidental ≥7 sample on both sides cannot reach pass during the
 *      first 14 days.
 *   3. Compute pre/post sample windows per platform.
 *   4. If pre_total < 7 OR post_total < 7 → still_learning (sample short
 *      even after 14 days).
 *   5. If pre_total ≥ 7 AND post_total ≥ 7 AND raw_delta_pp ≥ 5 AND
 *      post_share_raw > pre_share_raw → pass.
 *   6. Otherwise silent (covers delta < 5; negative/zero direction;
 *    both windows zero shares; etc.).
 *
 * Tenant isolation: PURE module. No `getRepository` import. No
 * `tenant_id` filtering inside the helper — the loader's
 * `getRepository().forTenant(tenantId)` guarantees the snapshots passed
 * in are already tenant-scoped. Section 6 R2 Blocker 4 lock.
 *
 * REUSE:
 *   - `getTimeToCitationEligibility` for the eligibility silence subset.
 */

import { getTimeToCitationEligibility } from "./eligibility";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

/** Minimum cumulative observations per window for a Mode B pass. Section 6 H4. */
export const SECTION6_MODE_B_MIN_TOTAL_PER_WINDOW = 7;

/** Minimum raw percentage-point delta for a Mode B pass. Section 6 H4. */
export const SECTION6_MODE_B_MIN_RAW_DELTA_PP = 5;

/** Window length on each side of `live_at`. */
export const SECTION6_MODE_B_WINDOW_DAYS = 14;

const MS_PER_DAY = 86_400_000;

export type ChangePrimaryModeBStatus = "pass" | "still_learning" | "silent";

export type ChangePrimaryModeBPerPlatformResult = {
  status: ChangePrimaryModeBStatus;
  pre_count: number;
  pre_total: number;
  /** DISPLAY ONLY — rounded after status decided. Null when pre_total === 0. */
  pre_share_pct: number | null;
  post_count: number;
  post_total: number;
  /** DISPLAY ONLY. Null when post_total === 0. */
  post_share_pct: number | null;
  /** DISPLAY ONLY — rounded pre/post pct delta. Null when either share is null. */
  delta_pp: number | null;
};

export type ChangePrimaryModeBResult = {
  per_platform: {
    chatgpt: ChangePrimaryModeBPerPlatformResult;
    perplexity: ChangePrimaryModeBPerPlatformResult;
  };
};

export type ComputeChangePrimaryModeBArgs = {
  recommendedEdit: Pick<
    RecommendedEditRow,
    "implementation_status" | "live_at" | "live_match_kind" | "target_url"
  >;
  affectedPromptIds: ReadonlyArray<string>;
  snapshots: ReadonlyArray<DailyMetricSnapshot>;
  /** UTC instant used for the still_learning age check. */
  now: Date | string;
};

/** TitleCase platform labels match the C2 snapshot builder's emitted values. */
type PlatformLabel = "ChatGPT" | "Perplexity";

function utcDaysBetweenDates(startIso: string, endIso: string): number {
  const startMs = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const endMs = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  return Math.floor((endMs - startMs) / MS_PER_DAY);
}

function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addUtcDays(dateIso: string, days: number): string {
  const baseMs = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
  );
  return new Date(baseMs + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function emptyPerPlatformResult(
  status: ChangePrimaryModeBStatus,
): ChangePrimaryModeBPerPlatformResult {
  return {
    status,
    pre_count: 0,
    pre_total: 0,
    pre_share_pct: null,
    post_count: 0,
    post_total: 0,
    post_share_pct: null,
    delta_pp: null,
  };
}

function bothPlatforms(
  status: ChangePrimaryModeBStatus,
): ChangePrimaryModeBResult {
  return {
    per_platform: {
      chatgpt: emptyPerPlatformResult(status),
      perplexity: emptyPerPlatformResult(status),
    },
  };
}

export function computeChangePrimaryModeB(
  args: ComputeChangePrimaryModeBArgs,
): ChangePrimaryModeBResult {
  const { recommendedEdit, affectedPromptIds, snapshots, now } = args;

  // 1. Hard silence — eligibility reason subset for Mode B.
  //    target_url null / needs_new_page does NOT silence Mode B
  //    (R2 Blocker 3 — Mode B uses affected prompts + live_at).
  const eligibility = getTimeToCitationEligibility({
    implementation_status: recommendedEdit.implementation_status,
    live_at: recommendedEdit.live_at,
    target_url: recommendedEdit.target_url,
  });
  if (
    eligibility.reason === "excluded_wrong_page" ||
    eligibility.reason === "excluded_status" ||
    eligibility.reason === "missing_live_at"
  ) {
    return bothPlatforms("silent");
  }
  if (recommendedEdit.live_match_kind === "wrong_page") {
    return bothPlatforms("silent");
  }
  if (affectedPromptIds.length === 0) {
    return bothPlatforms("silent");
  }

  // Eligibility predicate or our subset above guarantees live_at non-null.
  const liveAt = recommendedEdit.live_at as string;
  const liveAtDateIso = toUtcDateString(liveAt);
  const nowDateIso = toUtcDateString(now);
  if (liveAtDateIso == null || nowDateIso == null) {
    return bothPlatforms("silent");
  }

  // 2. UTC calendar-date days_since_live + pre-window guard.
  const daysSinceLive = utcDaysBetweenDates(liveAtDateIso, nowDateIso);
  if (daysSinceLive < SECTION6_MODE_B_WINDOW_DAYS) {
    return bothPlatforms("still_learning");
  }

  // 3. Compute window bounds.
  //    pre  = [live_at - 14, live_at)
  //    post = [live_at,      live_at + 14)
  const preLoDateIso = addUtcDays(liveAtDateIso, -SECTION6_MODE_B_WINDOW_DAYS);
  const preHiDateIso = liveAtDateIso; // exclusive
  const postLoDateIso = liveAtDateIso; // inclusive
  const postHiDateIso = addUtcDays(liveAtDateIso, SECTION6_MODE_B_WINDOW_DAYS); // exclusive

  // 4. Defensive dedup (loader also dedupes; both layers do it).
  const promptIdSet = new Set(affectedPromptIds);

  // 5. Per-platform aggregation.
  const platforms: ReadonlyArray<PlatformLabel> = ["ChatGPT", "Perplexity"];
  const accum: Record<PlatformLabel, {
    pre_count: number;
    pre_total: number;
    post_count: number;
    post_total: number;
  }> = {
    ChatGPT: { pre_count: 0, pre_total: 0, post_count: 0, post_total: 0 },
    Perplexity: { pre_count: 0, pre_total: 0, post_count: 0, post_total: 0 },
  };

  for (const row of snapshots) {
    if (row.scope_type !== "prompt") continue;
    if (row.source_type !== "derived") continue;
    if (!promptIdSet.has(row.scope_id)) continue;
    if (row.platform !== "ChatGPT" && row.platform !== "Perplexity") continue;
    const rowCount = row.primary_recommendation_count;
    const rowTotal = row.total_possible;
    if (rowCount == null) continue;
    if (rowTotal == null || rowTotal <= 0) continue;

    const platformKey = row.platform as PlatformLabel;
    const date = row.date;
    if (date >= preLoDateIso && date < preHiDateIso) {
      accum[platformKey].pre_count += rowCount;
      accum[platformKey].pre_total += rowTotal;
    } else if (date >= postLoDateIso && date < postHiDateIso) {
      accum[platformKey].post_count += rowCount;
      accum[platformKey].post_total += rowTotal;
    }
  }

  // 6. Per-platform decision.
  const results = {} as Record<PlatformLabel, ChangePrimaryModeBPerPlatformResult>;
  for (const p of platforms) {
    const a = accum[p];
    const preShareRaw = a.pre_total > 0 ? a.pre_count / a.pre_total : null;
    const postShareRaw = a.post_total > 0 ? a.post_count / a.post_total : null;
    const rawDeltaPp =
      preShareRaw != null && postShareRaw != null
        ? (postShareRaw - preShareRaw) * 100
        : null;

    let status: ChangePrimaryModeBStatus;
    if (
      a.pre_total < SECTION6_MODE_B_MIN_TOTAL_PER_WINDOW ||
      a.post_total < SECTION6_MODE_B_MIN_TOTAL_PER_WINDOW
    ) {
      status = "still_learning";
    } else if (
      rawDeltaPp != null &&
      rawDeltaPp >= SECTION6_MODE_B_MIN_RAW_DELTA_PP &&
      preShareRaw != null &&
      postShareRaw != null &&
      postShareRaw > preShareRaw
    ) {
      status = "pass";
    } else {
      status = "silent";
    }

    // Display fields — rounded AFTER status decided. Never used as a gate.
    const preSharePct =
      preShareRaw != null ? Math.round(preShareRaw * 100) : null;
    const postSharePct =
      postShareRaw != null ? Math.round(postShareRaw * 100) : null;
    const displayDeltaPp =
      preSharePct != null && postSharePct != null
        ? postSharePct - preSharePct
        : null;

    results[p] = {
      status,
      pre_count: a.pre_count,
      pre_total: a.pre_total,
      pre_share_pct: preSharePct,
      post_count: a.post_count,
      post_total: a.post_total,
      post_share_pct: postSharePct,
      delta_pp: displayDeltaPp,
    };
  }

  return {
    per_platform: {
      chatgpt: results.ChatGPT,
      perplexity: results.Perplexity,
    },
  };
}
