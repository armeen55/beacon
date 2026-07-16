/**
 * 2026-05-13 Phase A.1 Step 4 — citation-lifecycle compute module.
 *
 * Pure function that computes the time-to-first-citation metric for
 * a single `recommended_edits` row. Combines Sections 2.5 / 2.6 / 2.7
 * of the maximum-depth plan into one pure compute layer:
 *
 *   • First-CITATION anchor (D5) — not first mention, not primary
 *     recommendation. Those signals live in other compute paths.
 *   • Per-platform breakdown (D6) — ChatGPT + Perplexity only.
 *     Google AI Overviews is hardcoded `null` because polling is
 *     inactive; the slot stays in the type for forward-compatible UI.
 *   • UTC day boundaries (D7) — every date comparison anchors to
 *     YYYY-MM-DD UTC. No tenant-local complexity.
 *
 * Handles BOTH citation regimes per Section 2.4 audit (Path A locked):
 *
 *   • Benchmark regime (pre-2026-04-22): per-day `CitationObservation`
 *     rows from Profound cold-store shards. Joined to
 *     `PromptAnswerObservation` for `platform` and tenant scoping.
 *     `citation.url` is nullable — skipped when null.
 *
 *   • Native regime (2026-04-22+): citations live ON the prompt-answer
 *     row itself, in the `citation_urls` array. Each URL is a
 *     citation candidate for that observation. `citation_urls` is
 *     nullable + may be empty on pre-Commit-7 rows — skipped safely.
 *
 * The cutover date itself is not a parameter here — both regimes are
 * walked over the provided input arrays. Whichever holds the earlier
 * matching citation wins for `first_citation_date_iso`. Cross-regime
 * dedupe is automatic: only the earliest UTC date matters.
 *
 * Tenant safety (Section 2.4 hard rule): `CitationObservation` has no
 * `tenant_id` column. The caller's tenant scope is preserved by
 * deriving the set of allowed `prompt_answer_id` values from the
 * provided `promptAnswerObservations` array and dropping any citation
 * row whose `prompt_answer_id` isn't in that set. Callers MUST pass
 * tenant-scoped `promptAnswerObservations` (which is the case in
 * production via `getPromptAnswerObservations()` from the canonical
 * store, see `src/storage/canonical-store.ts`).
 *
 * No I/O. No fetch. No cache. Pure compute from provided arrays.
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

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Wider result-reason union. Extends the eligibility predicate's
 * reasons with `target_url_unparseable` for the (rare) case where a
 * row passes eligibility (target_url is non-null, non-sentinel) but
 * the canonicalizer cannot produce a comparable form (e.g., a malformed
 * URL slipped past upstream validation). Section 2.20's coding prompt
 * explicitly authorized extending the reason enum at this layer.
 */
export type TimeToCitationResultReason =
  | TimeToCitationEligibilityReason
  | "target_url_unparseable";

/**
 * Structural input — accepts the relevant subset of `RecommendedEditRow`.
 * Mirrors the shape `eligibility.ts` accepts so callers can pass a row
 * once through both layers.
 */
export type TimeToCitationRecommendedEditInput = {
  implementation_status?: ImplementationStatus;
  live_at?: string | null;
  target_url?: string | null;
};

export type TimeToCitationPerPlatformFirstCitation = {
  chatgpt: string | null;
  perplexity: string | null;
  google_ai_overviews: null;
};

export type TimeToCitationResult = {
  eligible: boolean;
  eligibility_reason: TimeToCitationResultReason;
  is_partial_live: boolean;
  first_citation_date_iso: string | null;
  days_to_first_citation: number | null;
  days_since_live: number | null;
  per_platform_first_citation: TimeToCitationPerPlatformFirstCitation;
  was_cited_before_live: boolean;
};

export type ComputeTimeToCitationArgs = {
  recommendedEdit: TimeToCitationRecommendedEditInput;
  citationObservations: CitationObservation[];
  promptAnswerObservations: PromptAnswerObservation[];
  now: Date | string;
};

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────
// Date helpers (UTC-only)
// ─────────────────────────────────────────────────────────────────────

/**
 * Truncate an ISO timestamp (or Date) to its UTC calendar date
 * (`YYYY-MM-DD`). Returns null on invalid input so callers can skip
 * defensively rather than throw.
 */
function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  // toISOString always emits UTC. Slice off the time portion.
  return d.toISOString().slice(0, 10);
}

/**
 * Integer day count between two `YYYY-MM-DD` UTC dates. Positive if
 * `endIso >= startIso`. Negative if the end date is before the start
 * date (used for the `first_citation < live_at` edge case below).
 */
function utcDaysBetween(startIso: string, endIso: string): number {
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

// ─────────────────────────────────────────────────────────────────────
// Result shape helpers
// ─────────────────────────────────────────────────────────────────────

function emptyPerPlatform(): TimeToCitationPerPlatformFirstCitation {
  return {
    chatgpt: null,
    perplexity: null,
    // D6 lock: GAIO slot exists for forward-compat; polling is
    // inactive so the value is always null.
    google_ai_overviews: null,
  };
}

function ineligibleResult(
  reason: TimeToCitationResultReason,
): TimeToCitationResult {
  return {
    eligible: false,
    eligibility_reason: reason,
    is_partial_live: false,
    first_citation_date_iso: null,
    days_to_first_citation: null,
    days_since_live: null,
    per_platform_first_citation: emptyPerPlatform(),
    was_cited_before_live: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Core compute
// ─────────────────────────────────────────────────────────────────────

export function computeTimeToCitation(
  args: ComputeTimeToCitationArgs,
): TimeToCitationResult {
  const {
    recommendedEdit,
    citationObservations,
    promptAnswerObservations,
    now,
  } = args;

  // ── 1. Eligibility gate ────────────────────────────────────────────
  // Re-uses the locked eligibility predicate. If the row isn't a valid
  // measurement candidate, return immediately with the predicate's
  // reason and null metric fields.
  const elig = getTimeToCitationEligibility(recommendedEdit);
  if (!elig.eligible) {
    return ineligibleResult(elig.reason);
  }

  // ── 2. Anchor dates ────────────────────────────────────────────────
  // Eligibility already confirmed live_at is non-null, but the type
  // says optional — narrow defensively. toUtcDateString returns null
  // on invalid timestamps; treat that as missing_live_at to stay
  // honest if a future schema drift produces unparseable timestamps.
  const liveDateIso = toUtcDateString(recommendedEdit.live_at);
  if (liveDateIso == null) {
    return ineligibleResult("missing_live_at");
  }
  const nowDateIso = toUtcDateString(now);
  if (nowDateIso == null) {
    // Caller-provided `now` was unparseable. This shouldn't happen in
    // production (Section 2.7 has `now: Date | string`, both forms
    // should always parse) but the function stays total.
    return ineligibleResult("missing_live_at");
  }
  const daysSinceLive = utcDaysBetween(liveDateIso, nowDateIso);

  // ── 3. Canonicalize target URL ─────────────────────────────────────
  // After eligibility passed, the target URL is non-null and not the
  // create-page sentinel. But it might still be unparseable —
  // canonicalizer's credibility guard rejects malformed shapes.
  const canonicalTarget = canonicalizeCitationUrl(
    recommendedEdit.target_url ?? null,
  );
  if (canonicalTarget == null) {
    return {
      eligible: false,
      eligibility_reason: "target_url_unparseable",
      is_partial_live: elig.is_partial_live,
      first_citation_date_iso: null,
      days_to_first_citation: null,
      days_since_live: daysSinceLive,
      per_platform_first_citation: emptyPerPlatform(),
      was_cited_before_live: false,
    };
  }

  // ── 4. Tenant-scoped prompt-answer index ───────────────────────────
  // The allowed set: prompt-answer IDs the caller passed in. Citation
  // rows referencing IDs outside this set are silently dropped — the
  // only thing keeping multi-tenant citation reads tenant-safe.
  const promptAnswerById = new Map<string, PromptAnswerObservation>();
  for (const pa of promptAnswerObservations) {
    promptAnswerById.set(pa.id, pa);
  }

  // ── 5. Collect matches across both regimes ─────────────────────────
  // Match record: one entry per matched citation, keyed by platform
  // and UTC date. Cross-regime + intra-regime dedupe falls out
  // naturally because we only ever consult the earliest date.
  type Match = { platform: string; dateUtc: string };
  const matches: Match[] = [];

  // ── 5a. Benchmark regime: CitationObservation rows ─────────────────
  for (const citation of citationObservations) {
    // Skip null URLs (pre-T6.x rows, defensive).
    if (citation.url == null) continue;

    // Tenant gate: drop rows whose prompt_answer_id isn't in the
    // provided tenant scope.
    const pa = promptAnswerById.get(citation.prompt_answer_id);
    if (pa == null) continue;

    const canonical = canonicalizeCitationUrl(citation.url);
    if (canonical == null) continue;
    if (canonical !== canonicalTarget) continue;

    const dateIso = toUtcDateString(citation.observed_at);
    if (dateIso == null) continue;

    // audit-wave2 #1: benchmark/recovered rows store the CAPITALIZED display
    // variant ("ChatGPT"/"Perplexity"); the per-platform classifier compares
    // exact-lowercase, so an un-normalized platform dropped the citation from
    // per_platform AND the aggregate → a cited page read as uncited.
    matches.push({ platform: normalizePlatform(pa.platform), dateUtc: dateIso });
  }

  // ── 5b. Native regime: PromptAnswerObservation.citation_urls ───────
  for (const obs of promptAnswerObservations) {
    // citation_urls is `string[] | null | undefined`. Pre-Commit-7
    // rows have it null; brand-new schema rows with no citations
    // have it as `[]`. Both skip naturally.
    if (obs.citation_urls == null || obs.citation_urls.length === 0) {
      continue;
    }

    // Per-obs dedupe: a duplicate citation inside one answer's URL
    // list must not produce two matches with the same date. Mirrors
    // the invariant `buildNativeDayBuckets` enforces in
    // `src/domains/product/url-citation-history.ts`.
    const seenCanonicalUrls = new Set<string>();
    for (const rawUrl of obs.citation_urls) {
      const canonical = canonicalizeCitationUrl(rawUrl);
      if (canonical == null) continue;
      if (canonical !== canonicalTarget) continue;
      if (seenCanonicalUrls.has(canonical)) continue;
      seenCanonicalUrls.add(canonical);

      const dateIso = toUtcDateString(obs.observed_at);
      if (dateIso == null) continue;

      matches.push({ platform: normalizePlatform(obs.platform), dateUtc: dateIso });
    }
  }

  // ── 6. Per-platform first-citation map ─────────────────────────────
  // Earliest matching date per active platform. Unknown platforms
  // (anything outside ACTIVE_PLATFORMS) are silently dropped.
  const perPlatform = emptyPerPlatform();
  for (const match of matches) {
    if (match.platform === "chatgpt") {
      if (perPlatform.chatgpt == null || match.dateUtc < perPlatform.chatgpt) {
        perPlatform.chatgpt = match.dateUtc;
      }
    } else if (match.platform === "perplexity") {
      if (
        perPlatform.perplexity == null ||
        match.dateUtc < perPlatform.perplexity
      ) {
        perPlatform.perplexity = match.dateUtc;
      }
    }
    // Other platforms: silently ignored. GAIO slot stays null.
  }

  // ── 7. Aggregate first-citation date ───────────────────────────────
  // Min of per-platform values. Unknown-platform matches are
  // excluded by construction (only active-platform matches reached
  // perPlatform above; aggregate reads only from perPlatform).
  const platformDates = [perPlatform.chatgpt, perPlatform.perplexity].filter(
    (d): d is string => d != null,
  );
  const firstCitationDateIso =
    platformDates.length > 0
      ? platformDates.reduce((a, b) => (a < b ? a : b))
      : null;

  // ── 8. Days-to-first-citation + was_cited_before_live ──────────────
  let daysToFirstCitation: number | null = null;
  let wasCitedBeforeLive = false;
  if (firstCitationDateIso != null) {
    const delta = utcDaysBetween(liveDateIso, firstCitationDateIso);
    if (delta < 0) {
      // Citation observed before the row went live — operator may
      // have marked shipped late, OR the match engine re-stamped
      // live_at forward on a VL ↔ VLM transition (see Section 2.2
      // forward-only finding). Either way, surface the situation
      // with `was_cited_before_live: true` and clamp the day count
      // to zero. Section 2.7 of the plan locks this behavior.
      daysToFirstCitation = 0;
      wasCitedBeforeLive = true;
    } else {
      daysToFirstCitation = delta;
    }
  }

  return {
    eligible: true,
    eligibility_reason: elig.reason,
    is_partial_live: elig.is_partial_live,
    first_citation_date_iso: firstCitationDateIso,
    days_to_first_citation: daysToFirstCitation,
    days_since_live: daysSinceLive,
    per_platform_first_citation: perPlatform,
    was_cited_before_live: wasCitedBeforeLive,
  };
}
