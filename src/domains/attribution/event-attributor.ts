/**
 * Phase 0 — Event attributor.
 *
 * Produces ONE `EventAttribution` per `ChangeEvent`. Dispatches by event
 * scope into three verdict vocabularies:
 *
 *   compound_launch  → landed_fast | landed_normal | landed_slow | never_landed
 *   sitewide_rollout → attributed_high | attributed_medium | attributed_low | inconclusive
 *   page_level       → helping | promising | nothing_yet | hurting |
 *                      degrading | inconclusive | not_enough_data
 *
 * The `promising` tier is emitted ONLY here — it is NOT written to the
 * production `url-verdict.ts` enum. Event-level reporting can surface
 * below-zBar-but-still-lifting pages without touching the live `/changes` UI.
 *
 * Every attribution record includes `confidence_source` so seed priors
 * never masquerade as learned truth.
 */

import type {
  ChangeEvent,
  ConfidenceSource,
  EventAttribution,
  SchemaMatchSpecificity,
  SiteMovementEvent,
} from "@/domains/events/types";
import {
  computeUrlVerdict,
  DEFAULT_THRESHOLDS,
  type UrlVerdict,
} from "@/domains/attribution/url-verdict";
import { EVENT_PRIORS_V1 } from "@/lib/event-priors";
import { classifyAssetType } from "@/domains/pages/classify-asset-type";
import {
  matchSchemaExperiment,
  SPECIFICITY_SCOPE_MULTIPLIER,
  confidenceSourceFromSpecificity,
} from "@/domains/attribution/match-schema-experiment";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/** One day of citation counts for one URL. Zero-filled. */
export type UrlDailySeries = {
  url: string;
  /** Sorted ascending by `date`. Days flagged as data_bad should be OMITTED, not zero-filled. */
  daily: Array<{ date: string; count: number }>;
};

export type AttributeEventsInput = {
  events: ChangeEvent[];
  /** Movement events detected by the site-citation-timeline. */
  siteMovements: SiteMovementEvent[];
  /**
   * Keyed by normalized path. Only URLs referenced by events need to be
   * present.
   */
  urlSeriesByUrl: Record<string, UrlDailySeries>;
  /** Data-quality-flagged dates, for baseline/post computation. */
  dataQualityBadDates: Set<string>;
  /** YYYY-MM-DD of "today" — defaults to latest date across all series. */
  asOfDate?: string;
  /**
   * Phase 1 — optional map of ChangelogEntry by id. When provided AND a
   * page_level event's underlying child entry has
   * `change_family === "schema_experiment"`, the attributor consults the
   * 5-rung schema-matching ladder to set `matching_specificity` and
   * down-weight `c_scope` for muddy (visible_copy_changed) experiments.
   *
   * Not provided = legacy path, zero behavior change for non-schema events.
   */
  changelogById?: Map<string, import("@/domains/changelog/types").ChangelogEntry>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function attributeEvents(input: AttributeEventsInput): EventAttribution[] {
  const asOf = input.asOfDate ?? inferAsOfDate(input);
  const out: EventAttribution[] = [];

  for (const event of input.events) {
    let record: EventAttribution;
    switch (event.scope) {
      case "compound_launch":
        record = attributeCompoundLaunch(event, input, asOf);
        break;
      case "sitewide_rollout":
        record = attributeSitewideRollout(event, input, asOf);
        break;
      case "page_level":
        record = attributePageLevel(event, input, asOf);
        break;
    }
    out.push(record);
  }

  return out;
}

// ---------------------------------------------------------------------------
// compound_launch
// ---------------------------------------------------------------------------

function attributeCompoundLaunch(
  event: ChangeEvent,
  input: AttributeEventsInput,
  asOf: string,
): EventAttribution {
  const url = event.created_url;
  const series = url ? input.urlSeriesByUrl[url] : null;
  const firstDay = series ? firstCitationDay(series) : null;
  const daysToFirst =
    firstDay ? daysBetween(event.ended_at, firstDay) : null;

  // Post-only citation window on the created URL.
  const windowDays14 = filterWindow(series, event.ended_at, 14, asOf);
  const windowDays3 = filterWindow(series, event.ended_at, 3, asOf);
  const windowDays30 = filterWindow(series, event.ended_at, 30, asOf);

  const sum14 = sumCounts(windowDays14);
  const sum3 = sumCounts(windowDays3);
  const sum30 = sumCounts(windowDays30);

  let verdict: string;
  if (sum3 >= 5) verdict = "landed_fast";
  else if (sum14 >= 5) verdict = "landed_normal";
  else if (sum30 > 0) verdict = "landed_slow";
  else verdict = "never_landed";

  // Confidence components.
  const c_timing =
    daysToFirst == null
      ? 0.1
      : daysToFirst <= 3
        ? 1.0
        : daysToFirst <= 14
          ? 0.7
          : daysToFirst <= 30
            ? 0.4
            : 0.2;
  const c_scope = 1.0;
  const peakPerDay = maxCounts(windowDays30);
  const c_magnitude = Math.min(1.0, peakPerDay / 10);
  const confidence = geomean([c_timing, c_scope, c_magnitude]);

  const confidence_source: ConfidenceSource = "measured";
  const observed_lift_pct = sum30 > 0 ? (sum14 / Math.max(14, 1)) : null;

  const narrative = [
    `Launched ${url}.`,
    daysToFirst == null
      ? "URL never cited."
      : `First citation observed ${daysToFirst}d after the last launch edit.`,
    `Post-launch citations: ${sum3} by day 3, ${sum14} by day 14, ${sum30} by day 30.`,
  ].join(" ");

  return {
    event_id: event.id,
    site_movement_event_id: matchNearbyMovement(event, input.siteMovements, 5)?.id ?? null,
    verdict,
    confidence,
    evidence: {
      c_timing,
      c_scope,
      c_magnitude,
      confidence_source,
      narrative,
      observed_lift_pct,
      days_to_first_citation: daysToFirst,
    },
    recorded_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// sitewide_rollout
// ---------------------------------------------------------------------------

function attributeSitewideRollout(
  event: ChangeEvent,
  input: AttributeEventsInput,
  _asOf: string,
): EventAttribution {
  const prior = EVENT_PRIORS_V1[event.event_type] ?? 0.3;
  const nearbyMovement = matchNearbyMovement(event, input.siteMovements, 5);

  let c_timing: number;
  if (!nearbyMovement) {
    c_timing = 0;
  } else {
    // Closer to event's ended_at = higher c_timing. ±0 days = 1.0, linear to ±5 days = 0.2.
    const dist = daysBetween(event.ended_at, nearbyMovement.date);
    c_timing = Math.max(0.2, 1 - (dist / 5) * 0.8);
  }

  const c_scope = event.target_urls === null ? 0.7 : Math.min(1.0, 0.4 + (event.target_urls.length / 10) * 0.6);
  const c_magnitude = prior;

  let verdict: string;
  if (!nearbyMovement) {
    verdict = "inconclusive";
  } else if (prior >= 0.8 && c_timing >= 0.6) {
    verdict = "attributed_high";
  } else if (prior >= 0.5 && c_timing >= 0.4) {
    verdict = "attributed_medium";
  } else {
    verdict = "attributed_low";
  }

  const confidence = geomean([c_timing, c_scope, c_magnitude]);

  const confidence_source: ConfidenceSource = !nearbyMovement
    ? "inference"
    : prior >= 0.5
      ? "seed_prior"
      : "measured";

  const observed_lift_pct = nearbyMovement
    ? nearbyMovement.delta_pct
    : null;

  const narrative = nearbyMovement
    ? `${event.event_type} ended ${event.ended_at}; site movement mov-${nearbyMovement.date.replaceAll("-", "")} landed +${nearbyMovement.delta_abs} citations (${Math.round(nearbyMovement.delta_pct * 100)}%) ${Math.abs(daysBetween(event.ended_at, nearbyMovement.date))}d away. Prior=${prior.toFixed(2)} (seed).`
    : `${event.event_type} ended ${event.ended_at}; no site movement within ±5 days. Prior=${prior.toFixed(2)} (seed).`;

  return {
    event_id: event.id,
    site_movement_event_id: nearbyMovement?.id ?? null,
    verdict,
    confidence,
    evidence: {
      c_timing,
      c_scope,
      c_magnitude,
      confidence_source,
      narrative,
      observed_lift_pct,
      days_to_first_citation: null,
    },
    recorded_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// page_level
// ---------------------------------------------------------------------------

function attributePageLevel(
  event: ChangeEvent,
  input: AttributeEventsInput,
  asOf: string,
): EventAttribution {
  const url = event.target_urls?.[0] ?? event.created_url ?? null;
  const series = url ? input.urlSeriesByUrl[url] : null;
  const changeDate = event.ended_at;

  if (!series || series.daily.length === 0) {
    return inconclusivePageLevel(event, "No citation series for URL.");
  }

  const seriesFiltered = series.daily.filter(
    (p) => !input.dataQualityBadDates.has(p.date),
  );

  // Build a "zero-filled" post window — but with bad days OMITTED. The
  // verdict engine treats dates outside the array as missing; that matches
  // the "treat data_bad as missing, not zero" rule from the plan.
  const verdict: UrlVerdict = computeUrlVerdict({
    series: seriesFiltered,
    changeDate,
    asOfDate: asOf,
  });

  // Apply the local `promising` upgrade (event-level only; never mutates
  // production url-verdict.ts).
  let eventVerdict: string = verdict.verdict;
  if (verdict.verdict === "nothing_yet") {
    const z = verdict.z ?? 0;
    if (z >= 1.5 && verdict.sustain.up >= 4) {
      eventVerdict = "promising";
    }
  }

  // Confidence decomposition.
  const baselineDays = verdict.explanation.math.baseline_days_used;
  const c_timing = verdict.post_days >= 7 ? 1.0 : verdict.post_days / 7;
  let c_scope = 1.0;
  const c_magnitude = Math.min(1.0, Math.abs(verdict.z ?? 0) / 3);

  let confidence_source: ConfidenceSource =
    baselineDays >= DEFAULT_THRESHOLDS.baselineConfidentDays
      ? "measured"
      : "inference";

  // Phase 1 — schema-experiment matcher integration.
  //
  // ONLY runs when:
  //   - caller passed `changelogById` in the input, AND
  //   - the event's first child entry has `change_family === "schema_experiment"`
  // Non-schema events (and any callers that don't pass `changelogById`) keep
  // the legacy c_scope = 1.0 and the baseline-days-based confidence_source.
  let matching_specificity: SchemaMatchSpecificity | undefined;
  let schemaAdjustmentNote = "";
  if (input.changelogById && event.child_change_ids.length > 0) {
    const primaryChild = input.changelogById.get(event.child_change_ids[0]);
    if (primaryChild?.change_family === "schema_experiment" && url) {
      const assetType = classifyAssetType(url);
      const matched = matchSchemaExperiment({
        url,
        assetType,
        changelog: [primaryChild],
        scanTimestamp: primaryChild.updated_at ?? primaryChild.timestamp,
        schemaTypesAddedOnPage: primaryChild.schema_types_added ?? [],
      });
      if (matched) {
        matching_specificity = matched.specificity;
        // Apply specificity multiplier to c_scope.
        c_scope *= SPECIFICITY_SCOPE_MULTIPLIER[matched.specificity];
        // For muddy experiments (visible copy also changed), additionally
        // halve c_scope — we can't cleanly isolate the schema effect.
        if (primaryChild.visible_copy_changed === true) {
          c_scope *= 0.5;
          schemaAdjustmentNote =
            ` Schema match=${matched.specificity}; visible copy also changed, so c_scope is down-weighted.`;
        } else {
          schemaAdjustmentNote = ` Schema match=${matched.specificity}.`;
        }
        // Override confidence_source based on specificity (measured for
        // exact/strong, inference otherwise) unless the baseline already
        // gave us a stronger signal.
        const specSource = confidenceSourceFromSpecificity(matched.specificity);
        if (confidence_source === "inference" && specSource === "measured") {
          confidence_source = "measured";
        } else if (confidence_source === "measured" && specSource === "inference") {
          // Keep measured — baseline signal outranks partial/fallback text match.
        }
      } else {
        matching_specificity = "none";
      }
    }
  }

  const confidence = geomean([c_timing, c_scope, c_magnitude]);

  const badDaysInPost = countBadDaysInPost(
    series,
    changeDate,
    asOf,
    input.dataQualityBadDates,
  );

  const narrative =
    (badDaysInPost > 0
      ? `${verdict.explanation.summary} ${badDaysInPost} day(s) in the post-window were excluded as data_bad.`
      : verdict.explanation.summary) + schemaAdjustmentNote;

  return {
    event_id: event.id,
    site_movement_event_id: null,
    verdict: eventVerdict,
    confidence,
    evidence: {
      c_timing,
      c_scope,
      c_magnitude,
      confidence_source,
      narrative,
      observed_lift_pct: verdict.delta_pct,
      days_to_first_citation: null,
      matching_specificity,
    },
    recorded_at: new Date().toISOString(),
  };
}

function inconclusivePageLevel(
  event: ChangeEvent,
  reason: string,
): EventAttribution {
  return {
    event_id: event.id,
    site_movement_event_id: null,
    verdict: "inconclusive",
    confidence: 0,
    evidence: {
      c_timing: 0,
      c_scope: 1,
      c_magnitude: 0,
      confidence_source: "inference",
      narrative: reason,
      observed_lift_pct: null,
      days_to_first_citation: null,
    },
    recorded_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function geomean(parts: number[]): number {
  const clipped = parts.map((v) => Math.max(0, Math.min(1, v)));
  if (clipped.some((v) => v === 0)) return 0;
  const logs = clipped.map((v) => Math.log(v));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return Math.exp(mean);
}

function firstCitationDay(series: UrlDailySeries): string | null {
  for (const p of series.daily) if (p.count > 0) return p.date;
  return null;
}

function filterWindow(
  series: UrlDailySeries | null,
  startAfter: string,
  daysForward: number,
  asOf: string,
): Array<{ date: string; count: number }> {
  if (!series) return [];
  const start = addDays(startAfter, 1);
  const end = minDate(addDays(startAfter, daysForward), asOf);
  return series.daily.filter((p) => p.date >= start && p.date <= end);
}

function sumCounts(pts: Array<{ count: number }>): number {
  return pts.reduce((a, p) => a + p.count, 0);
}

function maxCounts(pts: Array<{ count: number }>): number {
  let m = 0;
  for (const p of pts) if (p.count > m) m = p.count;
  return m;
}

function matchNearbyMovement(
  event: ChangeEvent,
  movements: SiteMovementEvent[],
  toleranceDays: number,
): SiteMovementEvent | null {
  let best: { m: SiteMovementEvent; dist: number } | null = null;
  for (const m of movements) {
    const dist = Math.min(
      daysBetween(event.ended_at, m.date),
      daysBetween(event.started_at, m.date),
    );
    if (dist <= toleranceDays) {
      if (!best || dist < best.dist) best = { m, dist };
    }
  }
  return best?.m ?? null;
}

function countBadDaysInPost(
  series: UrlDailySeries,
  changeDate: string,
  asOf: string,
  badDates: Set<string>,
): number {
  const start = addDays(changeDate, 1);
  const end = minDate(addDays(changeDate, DEFAULT_THRESHOLDS.postWindowMaxDays), asOf);
  let count = 0;
  for (const d of badDates) {
    if (d >= start && d <= end) count += 1;
  }
  return count;
}

function inferAsOfDate(input: AttributeEventsInput): string {
  let max = "";
  for (const s of Object.values(input.urlSeriesByUrl)) {
    const last = s.daily[s.daily.length - 1]?.date;
    if (last && last > max) max = last;
  }
  return max || new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.abs(Math.round((da - db) / (24 * 3600 * 1000)));
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
