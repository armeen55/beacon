/**
 * Section 6 C6a (2026-05-15) — Mode A: cited-here primary-recommendation
 * evidence for a single recommended-edit on Changes detail.
 *
 * Pure compute. Given a recommended edit + the post-`live_at`
 * prompt-answer observations, computes:
 *
 *   - cited_here_count: how many post-live answers cited the edit's
 *     `target_url` (canonical exact match; no parent-URL fuzzy match).
 *   - primary_count: how many of those cited-here answers had
 *     `primary_recommendation === true`.
 *   - status: "pass" / "still_learning" / "silent" — decided on RAW
 *     primary share (not the rounded display pct). Borderline-rounding
 *     traps (99/199 → rounded 50% but raw 49.75% → silent) are pinned
 *     by `tests/domains/citation-lifecycle/change-primary-mode-a.test.ts`.
 *   - primary_share_pct: rounded DISPLAY output only; never an input to
 *     the status decision.
 *
 * Pass / still_learning / silent (Section 6 H3 lock + R2 raw-ratio fix):
 *   - silent      if NOT eligible (status / wrong_page / missing live_at
 *                 / missing target_url / needs_new_page) OR
 *                 live_match_kind === "wrong_page"
 *   - silent      if cited_here_count === 0 (regardless of days_since_live)
 *   - still_learning  if cited_here_count ∈ [1, 6] AND days_since_live >= 14
 *   - silent      if cited_here_count ∈ [1, 6] AND days_since_live < 14
 *   - pass        if cited_here_count >= 7 AND raw_primary_share >= 0.5
 *   - silent      otherwise (e.g., cited_here_count >= 7 but raw share < 0.5)
 *
 * observed_at boundary (Section 6 R2 / Blocker 7):
 *   - Mode A filters by INSTANT comparison
 *     (`new Date(obs.observed_at).getTime() >= liveAtMs`), not UTC date.
 *   - The loader over-fetches via `since: toUtcDateString(live_at)`;
 *     this helper re-filters at instant precision so a same-UTC-day-
 *     pre-`live_at` observation is correctly excluded.
 *
 * Tenant isolation: this module is PURE. It does NOT import
 * `getRepository` and does NOT reference the identifier; tenant scope
 * is enforced upstream at the loader, pinned by
 * `tests/architecture/change-primary-pure-modules-no-getRepository.test.ts`.
 *
 * REUSE:
 *   - `canonicalizeCitationUrl` (no parent-URL fuzzy match; D3 lock)
 *   - `getTimeToCitationEligibility` (Section 2 status/URL eligibility)
 */

import { canonicalizeCitationUrl } from "./canonicalize-url";
import { getTimeToCitationEligibility } from "./eligibility";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

/** Minimum cited-here sample size for a Mode A pass. Section 6 H3. */
export const SECTION6_MODE_A_MIN_CITED_HERE = 7;

/** Minimum raw primary share for a Mode A pass (50%). Section 6 H3. */
export const SECTION6_MODE_A_MIN_PRIMARY_SHARE = 0.5;

/** Days after `live_at` at which still_learning becomes meaningful. */
export const SECTION6_MODE_A_STILL_LEARNING_DAYS = 14;

const MS_PER_DAY = 86_400_000;

export type ChangePrimaryModeAStatus = "pass" | "still_learning" | "silent";

export type ChangePrimaryModeAResult = {
  status: ChangePrimaryModeAStatus;
  cited_here_count: number;
  primary_count: number;
  /** DISPLAY ONLY — rounded after status decided. Null when cited_here_count === 0. */
  primary_share_pct: number | null;
};

export type ComputeChangePrimaryModeAArgs = {
  recommendedEdit: Pick<
    RecommendedEditRow,
    | "implementation_status"
    | "live_at"
    | "live_match_kind"
    | "target_url"
  >;
  promptAnswerObservations: ReadonlyArray<
    Pick<
      PromptAnswerObservation,
      "observed_at" | "citation_urls" | "primary_recommendation"
    >
  >;
  /** UTC instant used for the still_learning age check. */
  now: Date | string;
};

/** UTC calendar-date difference (whole days). Mirrors `utcDaysBetween` in compute-time-to-citation. */
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

function silentResult(): ChangePrimaryModeAResult {
  return {
    status: "silent",
    cited_here_count: 0,
    primary_count: 0,
    primary_share_pct: null,
  };
}

export function computeChangePrimaryModeA(
  args: ComputeChangePrimaryModeAArgs,
): ChangePrimaryModeAResult {
  const { recommendedEdit, promptAnswerObservations, now } = args;

  // 1. Section 2 eligibility predicate covers: status family (recommended /
  //    accepted / needs_review / not_found_after_7d / dismissed), status
  //    wrong_page, missing live_at, missing target_url, needs_new_page.
  const eligibility = getTimeToCitationEligibility({
    implementation_status: recommendedEdit.implementation_status,
    live_at: recommendedEdit.live_at,
    target_url: recommendedEdit.target_url,
  });
  if (!eligibility.eligible) return silentResult();

  // 2. `live_match_kind === "wrong_page"` (KIND form) is independent of
  //    the STATUS form already handled above; silence it explicitly so
  //    a row that the operator marked verified_live with a wrong-page
  //    match can never claim Mode A evidence.
  if (recommendedEdit.live_match_kind === "wrong_page") return silentResult();

  // Eligibility predicate guarantees these are non-null at this point.
  const liveAt = recommendedEdit.live_at as string;
  const targetUrl = recommendedEdit.target_url as string;

  const liveAtMs = new Date(liveAt).getTime();
  if (Number.isNaN(liveAtMs)) return silentResult();

  // 3. UTC calendar-date days_since_live.
  const liveAtDateIso = toUtcDateString(liveAt);
  const nowDateIso = toUtcDateString(now);
  if (liveAtDateIso == null || nowDateIso == null) return silentResult();
  const daysSinceLive = utcDaysBetweenDates(liveAtDateIso, nowDateIso);

  // 4. Canonicalize target URL once.
  const canonicalTarget = canonicalizeCitationUrl(targetUrl);
  if (canonicalTarget == null) return silentResult();

  // 5. Filter observations by INSTANT (>= live_at), then check cited-here
  //    via canonical exact URL match (no parent-URL fuzzy match).
  let citedHereCount = 0;
  let primaryCount = 0;
  for (const obs of promptAnswerObservations) {
    const obsMs = new Date(obs.observed_at).getTime();
    if (Number.isNaN(obsMs) || obsMs < liveAtMs) continue;

    const urls = obs.citation_urls;
    if (urls == null || urls.length === 0) continue;

    let citedHere = false;
    for (const u of urls) {
      const canon = canonicalizeCitationUrl(u);
      if (canon != null && canon === canonicalTarget) {
        citedHere = true;
        break;
      }
    }
    if (!citedHere) continue;

    citedHereCount += 1;
    if (obs.primary_recommendation === true) primaryCount += 1;
  }

  // 6. Status (raw ratio, not rounded pct).
  const rawShare = citedHereCount > 0 ? primaryCount / citedHereCount : 0;
  let status: ChangePrimaryModeAStatus;
  if (
    citedHereCount >= SECTION6_MODE_A_MIN_CITED_HERE &&
    rawShare >= SECTION6_MODE_A_MIN_PRIMARY_SHARE
  ) {
    status = "pass";
  } else if (
    citedHereCount >= 1 &&
    citedHereCount <= 6 &&
    daysSinceLive >= SECTION6_MODE_A_STILL_LEARNING_DAYS
  ) {
    status = "still_learning";
  } else {
    status = "silent";
  }

  // 7. Display field — rounded AFTER status decided. Never used as a gate.
  const primarySharePct =
    citedHereCount > 0
      ? Math.round((primaryCount / citedHereCount) * 100)
      : null;

  return {
    status,
    cited_here_count: citedHereCount,
    primary_count: primaryCount,
    primary_share_pct: primarySharePct,
  };
}
