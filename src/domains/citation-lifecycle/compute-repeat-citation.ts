/**
 * 2026-05-16 Section 5.A — repeat-citation classifier (pure compute).
 *
 * Computes the citation-stability classification for a single
 * `recommended_edits` row over a rolling window. Pure function; no
 * I/O, no fetch, no LLM, no paid API. Tenant safety is preserved by
 * the caller-supplied `promptAnswerObservations` array — citation
 * rows from prompt-answers outside that set are dropped.
 *
 * Locked v1 rules (Section 5 G1–G5):
 *
 *   • Denominator = distinct UTC dates with at least one successful
 *     beacon-native poll-run since `live_at`, bounded by the window.
 *     Filter on `ProfoundImportRun`: `status === "completed"` AND
 *     `source_type === "beacon_native"`. Manual / API imports do NOT
 *     count (they backfill citations on dates the native cron didn't
 *     poll; counting them inflates the denominator for Section 5's
 *     "actually polled this URL" semantics).
 *
 *   • Numerator = distinct UTC dates with at least one citation
 *     matching `canonicalize(target_url)` since `live_at`, bounded by
 *     the window, INTERSECTED with the denominator's successful
 *     native poll dates. Cross-regime: cold-store `CitationObservation`
 *     rows (benchmark, pre-2026-04-22) AND native
 *     `PromptAnswerObservation.citation_urls[]` (≥ 2026-04-22) both
 *     contribute. Same UTC date matched from both regimes = 1 day.
 *     Intersecting with the denominator enforces
 *     `distinct_citation_days <= polling_days` (2026-05-16 bug-fix);
 *     without it the rate could exceed 1.0 when citations land on
 *     dates Beacon did not poll natively.
 *
 *   • Minimum-sample guard FIRST: `polling_days < 7` →
 *     `still_learning` regardless of citation count.
 *
 *   • Band thresholds (G5):
 *       stable        rate ≥ 0.50
 *       intermittent  0.20 ≤ rate < 0.50
 *       one_off       0   <  rate < 0.20
 *       not_repeated  rate = 0 AND first_citation_date_iso != null
 *       still_learning  (polling_days < 7) OR
 *                       (polling_days ≥ 7 AND distinct_citation_days === 0
 *                        AND first_citation_date_iso == null)
 *
 *   • The 0.50 boundary is INCLUSIVE of `stable`: 5 cited days out of
 *     10 polling days classifies as `stable`. Pinned by boundary test.
 *
 *   • First citation is recomputed INLINE from the same input arrays
 *     (cheap; small data; avoids coupling to `computeTimeToCitation`).
 *     First citation can be BEFORE the current window — that's what
 *     distinguishes `not_repeated` (was cited at some point) from
 *     `still_learning` (never cited at all).
 *
 *   • Per-platform breakdown is computed for `chatgpt` + `perplexity`;
 *     `google_ai_overviews` is hardcoded `null` because polling is
 *     inactive (matches `compute-time-to-citation.ts` D6 lock).
 *     Customer-facing G3 divergence detection (consumed in Section
 *     5.B) reads these breakdowns; the compute populates them either
 *     way.
 *
 *   • Same URL cited multiple times on one day = ONE distinct-citation-day.
 *     Same URL appearing twice in a single answer's `citation_urls[]`
 *     array = ONE day (per-obs Set dedupe).
 */

import {
  getTimeToCitationEligibility,
  type TimeToCitationEligibilityReason,
} from "./eligibility";
import { canonicalizeCitationUrl } from "./canonicalize-url";
import { normalizePlatform } from "@/lib/platform";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type RepeatCitationBand =
  | "stable"
  | "intermittent"
  | "one_off"
  | "not_repeated"
  | "still_learning";

export type RepeatCitationPlatformBreakdown = {
  polling_days: number;
  distinct_citation_days: number;
};

export type RepeatCitationResultReason =
  | TimeToCitationEligibilityReason
  | "target_url_unparseable";

export type RepeatCitationRecommendedEditInput = {
  implementation_status?: ImplementationStatus;
  live_at?: string | null;
  target_url?: string | null;
};

export type RepeatCitationResult = {
  eligible: boolean;
  eligibility_reason: RepeatCitationResultReason;
  window_days: number;
  polling_days: number;
  distinct_citation_days: number;
  citation_rate: number | null;
  band: RepeatCitationBand | null;
  per_platform: {
    chatgpt: RepeatCitationPlatformBreakdown;
    perplexity: RepeatCitationPlatformBreakdown;
    google_ai_overviews: null;
  };
  first_citation_date_iso: string | null;
};

export type ComputeRepeatCitationArgs = {
  recommendedEdit: RepeatCitationRecommendedEditInput;
  citationObservations: CitationObservation[];
  promptAnswerObservations: PromptAnswerObservation[];
  profoundImportRuns: ProfoundImportRun[];
  windowDays: number;
  now: Date | string;
};

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const ACTIVE_PLATFORMS: ReadonlySet<string> = new Set(["chatgpt", "perplexity"]);
const MS_PER_DAY = 86_400_000;
const MIN_SAMPLE_POLLING_DAYS = 7;
const BAND_STABLE_THRESHOLD = 0.5;
const BAND_INTERMITTENT_THRESHOLD = 0.2;

// ─────────────────────────────────────────────────────────────────────
// Date helpers (UTC-only)
// ─────────────────────────────────────────────────────────────────────

function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString().slice(0, 10);
}

function utcMsForDateString(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

/**
 * Count elements of `a` that also appear in `b`. Pure; O(|a|). Used
 * for the repeat-citation rate's numerator: only citation dates that
 * are ALSO successful native poll days contribute. Without this
 * intersection the rate could exceed 1.0 when citations land on
 * non-native (manual_import / api_import / benchmark) dates that
 * have no corresponding beacon_native poll.
 */
function intersectSize<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// Result shape helpers
// ─────────────────────────────────────────────────────────────────────

function emptyPerPlatform(): RepeatCitationResult["per_platform"] {
  return {
    chatgpt: { polling_days: 0, distinct_citation_days: 0 },
    perplexity: { polling_days: 0, distinct_citation_days: 0 },
    google_ai_overviews: null,
  };
}

function ineligibleResult(
  reason: RepeatCitationResultReason,
  windowDays: number,
): RepeatCitationResult {
  return {
    eligible: false,
    eligibility_reason: reason,
    window_days: windowDays,
    polling_days: 0,
    distinct_citation_days: 0,
    citation_rate: null,
    band: null,
    per_platform: emptyPerPlatform(),
    first_citation_date_iso: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Core compute
// ─────────────────────────────────────────────────────────────────────

export function computeRepeatCitation(
  args: ComputeRepeatCitationArgs,
): RepeatCitationResult {
  const {
    recommendedEdit,
    citationObservations,
    promptAnswerObservations,
    profoundImportRuns,
    windowDays,
    now,
  } = args;

  // ── 1. Eligibility gate ────────────────────────────────────────────
  const elig = getTimeToCitationEligibility(recommendedEdit);
  if (!elig.eligible) {
    return ineligibleResult(elig.reason, windowDays);
  }

  // ── 2. Anchor dates ────────────────────────────────────────────────
  const liveDateIso = toUtcDateString(recommendedEdit.live_at);
  if (liveDateIso == null) {
    return ineligibleResult("missing_live_at", windowDays);
  }
  const nowDateIso = toUtcDateString(now);
  if (nowDateIso == null) {
    return ineligibleResult("missing_live_at", windowDays);
  }

  // Window: [max(live_at, now - windowDays), now] inclusive on both
  // ends. Window-start clamps to live_at so polling days BEFORE the
  // ship don't count toward Section 5's denominator.
  const nowMs = utcMsForDateString(nowDateIso);
  const liveMs = utcMsForDateString(liveDateIso);
  const windowStartMs = Math.max(liveMs, nowMs - windowDays * MS_PER_DAY);
  const windowStartIso = new Date(windowStartMs).toISOString().slice(0, 10);
  const windowEndIso = nowDateIso;

  // ── 3. Canonicalize target URL ─────────────────────────────────────
  const canonicalTarget = canonicalizeCitationUrl(
    recommendedEdit.target_url ?? null,
  );
  if (canonicalTarget == null) {
    return {
      eligible: false,
      eligibility_reason: "target_url_unparseable",
      window_days: windowDays,
      polling_days: 0,
      distinct_citation_days: 0,
      citation_rate: null,
      band: null,
      per_platform: emptyPerPlatform(),
      first_citation_date_iso: null,
    };
  }

  // ── 4. Tenant-scoped prompt-answer index ───────────────────────────
  const promptAnswerById = new Map<string, PromptAnswerObservation>();
  for (const pa of promptAnswerObservations) {
    promptAnswerById.set(pa.id, pa);
  }

  // ── 5. Citation-day collection ─────────────────────────────────────
  // Two outputs:
  //   • allMatchDates: every UTC date the target URL was cited (any
  //     time, any platform). Powers `first_citation_date_iso` —
  //     can be BEFORE the current window.
  //   • inWindowDatesPerPlatform: dates inside the window keyed by
  //     active platform. Powers `distinct_citation_days` and the
  //     per-platform breakdown.

  const allMatchDates: string[] = [];
  const inWindowDatesAggregate = new Set<string>();
  const inWindowDatesByPlatform = new Map<string, Set<string>>();
  for (const p of ACTIVE_PLATFORMS) inWindowDatesByPlatform.set(p, new Set());

  function recordMatch(platform: string, dateIso: string): void {
    allMatchDates.push(dateIso);
    if (dateIso < windowStartIso || dateIso > windowEndIso) return;
    inWindowDatesAggregate.add(dateIso);
    if (ACTIVE_PLATFORMS.has(platform)) {
      inWindowDatesByPlatform.get(platform)!.add(dateIso);
    }
  }

  // 5a. Benchmark regime: CitationObservation rows. Tenant gate via
  // promptAnswerById drops citations whose prompt-answer is outside
  // the caller-provided tenant scope. Mirrors compute-time-to-citation §5a.
  for (const citation of citationObservations) {
    if (citation.url == null) continue;
    const pa = promptAnswerById.get(citation.prompt_answer_id);
    if (pa == null) continue;
    const canonical = canonicalizeCitationUrl(citation.url);
    if (canonical == null) continue;
    if (canonical !== canonicalTarget) continue;
    const dateIso = toUtcDateString(citation.observed_at);
    if (dateIso == null) continue;
    // audit-wave2 #12: normalize casing so capitalized benchmark platforms
    // ("ChatGPT"/"Perplexity") land in per_platform consistently with native rows.
    recordMatch(normalizePlatform(pa.platform), dateIso);
  }

  // 5b. Native regime: PromptAnswerObservation.citation_urls.
  // Per-obs Set dedupe: a URL appearing twice in one answer's array
  // counts as ONE match (mirrors compute-time-to-citation §5b).
  for (const obs of promptAnswerObservations) {
    if (obs.citation_urls == null || obs.citation_urls.length === 0) continue;
    const seenCanonicalUrls = new Set<string>();
    for (const rawUrl of obs.citation_urls) {
      const canonical = canonicalizeCitationUrl(rawUrl);
      if (canonical == null) continue;
      if (canonical !== canonicalTarget) continue;
      if (seenCanonicalUrls.has(canonical)) continue;
      seenCanonicalUrls.add(canonical);
      const dateIso = toUtcDateString(obs.observed_at);
      if (dateIso == null) continue;
      recordMatch(normalizePlatform(obs.platform), dateIso);
    }
  }

  // ── 6. First citation date (earliest match across all time) ────────
  // Sorted ascending — first element is the earliest. Can be before
  // window_start; that's what makes `not_repeated` semantically
  // distinct from `still_learning`.
  let firstCitationDateIso: string | null = null;
  for (const d of allMatchDates) {
    if (firstCitationDateIso == null || d < firstCitationDateIso) {
      firstCitationDateIso = d;
    }
  }

  // ── 7. Poll-day denominator from ProfoundImportRun ─────────────────
  // Filter: status === "completed" AND source_type === "beacon_native".
  // Distinct UTC `run_date` only; same date across multiple platforms
  // counts as ONE aggregate polling day. Per-platform polling-day
  // counts are derived separately for the breakdown.
  const aggregatePollingDates = new Set<string>();
  const pollingDatesByPlatform = new Map<string, Set<string>>();
  for (const p of ACTIVE_PLATFORMS) pollingDatesByPlatform.set(p, new Set());

  for (const run of profoundImportRuns) {
    if (run.status !== "completed") continue;
    if (run.source_type !== "beacon_native") continue;
    const dateIso = toUtcDateString(run.run_date);
    if (dateIso == null) continue;
    if (dateIso < windowStartIso || dateIso > windowEndIso) continue;
    aggregatePollingDates.add(dateIso);
    const runPlatform = normalizePlatform(run.platform);
    if (ACTIVE_PLATFORMS.has(runPlatform)) {
      pollingDatesByPlatform.get(runPlatform)!.add(dateIso);
    }
  }

  const pollingDays = aggregatePollingDates.size;

  // ── 7a. Poll-day intersection (2026-05-16 bug-fix) ─────────────────
  // The repeat-citation rate's denominator is "days Beacon successfully
  // polled the AI side." For a citation date to participate in the
  // numerator, that date must ALSO be a successful native poll day —
  // otherwise the rate could exceed 1.0 (citation observed on a day
  // we didn't poll natively, e.g., cold-store benchmark dates or
  // manual-import dates that don't have a corresponding beacon_native
  // ProfoundImportRun). Pre-fix production observed the failure mode
  // "Cited 3 of 0 poll days" on the operator diagnostic. Post-fix
  // contract: `distinct_citation_days <= polling_days` for the
  // aggregate AND `per_platform[p].distinct_citation_days <=
  // per_platform[p].polling_days` for each platform.
  //
  // `first_citation_date_iso` is COMPUTED FROM ALL OBSERVATIONS
  // (independent of poll days) — it answers "was this ever cited?"
  // and remains populated even when the in-window poll denominator
  // is 0. This is what distinguishes `not_repeated` from
  // `still_learning` once the polling sample crosses the gate.
  const distinctCitationDays = intersectSize(
    inWindowDatesAggregate,
    aggregatePollingDates,
  );

  // ── 8. Per-platform breakdown ──────────────────────────────────────
  // Per-platform numerator is intersected with the SAME platform's
  // poll-day set. A citation observed on a date that platform didn't
  // poll natively does not contribute to that platform's repeat
  // rate, mirroring the aggregate rule above.
  const perPlatform: RepeatCitationResult["per_platform"] = {
    chatgpt: {
      polling_days: pollingDatesByPlatform.get("chatgpt")!.size,
      distinct_citation_days: intersectSize(
        inWindowDatesByPlatform.get("chatgpt")!,
        pollingDatesByPlatform.get("chatgpt")!,
      ),
    },
    perplexity: {
      polling_days: pollingDatesByPlatform.get("perplexity")!.size,
      distinct_citation_days: intersectSize(
        inWindowDatesByPlatform.get("perplexity")!,
        pollingDatesByPlatform.get("perplexity")!,
      ),
    },
    google_ai_overviews: null,
  };

  // ── 9. Rate + band classification ──────────────────────────────────
  // Minimum-sample guard FIRST (G5 lock). Then never-cited fallback.
  // Then rate-based bands. Rate is null when polling_days is 0 (no
  // denominator); the still_learning guard catches it first.
  let band: RepeatCitationBand;
  let citationRate: number | null = null;

  if (pollingDays < MIN_SAMPLE_POLLING_DAYS) {
    band = "still_learning";
  } else if (distinctCitationDays === 0 && firstCitationDateIso != null) {
    band = "not_repeated";
    citationRate = 0;
  } else if (distinctCitationDays === 0 && firstCitationDateIso == null) {
    // Never cited at all. Section 2's `live_not_yet_cited` /
    // `stuck` lifecycle stage owns this surface; Section 5
    // defers via `still_learning` so the two metrics don't
    // overlap or contradict.
    band = "still_learning";
    citationRate = 0;
  } else {
    citationRate = distinctCitationDays / pollingDays;
    if (citationRate >= BAND_STABLE_THRESHOLD) {
      band = "stable";
    } else if (citationRate >= BAND_INTERMITTENT_THRESHOLD) {
      band = "intermittent";
    } else {
      band = "one_off";
    }
  }

  return {
    eligible: true,
    eligibility_reason: elig.reason,
    window_days: windowDays,
    polling_days: pollingDays,
    distinct_citation_days: distinctCitationDays,
    citation_rate: citationRate,
    band,
    per_platform: perPlatform,
    first_citation_date_iso: firstCitationDateIso,
  };
}
