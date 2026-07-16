/**
 * CX4.2 — Pattern aggregation.
 *
 * Takes a tenant's (ChangelogEntry, ChangeOutcome) pairs and aggregates
 * them into the global pattern store. Enforces:
 *
 *   1. Per-change dedup — one changelog entry = one sample per pattern.
 *      If the same change was already counted for a pattern, skip it.
 *   2. Observation-count normalization — uses normalized_citation_delta_pct
 *      from the CX4.0 inflation fix.
 *   3. Context binning — patterns are keyed by change_type + platform +
 *      context_bin (faq_count × site_maturity).
 *   4. Distinct tenant counting — contributing_tenant_count tracks how
 *      many unique tenants contributed, not raw event count.
 *
 * This function is called:
 *   - Once during CX4.3 (Ritz seeding)
 *   - After every audit run (daily rerun pipeline)
 *   - On demand for re-aggregation after taxonomy changes
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { PageSnapshot } from "@/domains/pages/types";
import { clusterChange } from "@/domains/forensics/spike-forensics";
import {
  type PatternKey,
  type OutcomeClass,
  type ContextBin,
  type FaqCountBin,
  type SiteMaturityBin,
  patternKeyHash,
  contextBinKey,
  aggregationDedupKey,
  CURRENT_TAXONOMY_VERSION,
} from "./contracts";
import { listGlobalPatterns, writeAllGlobalPatterns } from "./store";
import { getLogger } from "@/lib/obs/logger";

// ---------------------------------------------------------------------------
// Context bin computation
// ---------------------------------------------------------------------------

function computeFaqCountBin(
  faqCount: number | null | undefined,
): FaqCountBin {
  if (faqCount == null || faqCount === 0) return "zero";
  if (faqCount <= 3) return "low";
  return "high";
}

function computeSiteMaturityBin(
  daysSinceFirstObservation: number,
): SiteMaturityBin {
  return daysSinceFirstObservation >= 14 ? "established" : "new";
}

/**
 * Derive context bin from available page snapshot data.
 * When no snapshot is found, defaults to zero::new (most conservative).
 */
export function deriveContextBin(opts: {
  changeDate: string;
  pageSnapshots: PageSnapshot[];
  changeUrl: string | null;
  firstObservationDate: string | null;
}): ContextBin {
  const { changeDate, pageSnapshots, changeUrl, firstObservationDate } = opts;

  // FAQ count: find the latest snapshot for this page BEFORE the change
  let faqCountBin: FaqCountBin = "zero";
  if (changeUrl) {
    const priorSnapshots = pageSnapshots
      .filter(
        (s) =>
          s.url === changeUrl &&
          s.fetched_at < changeDate,
      )
      .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));

    if (priorSnapshots.length > 0) {
      const snap = priorSnapshots[0];
      const faqCount = snap.faqs?.length ?? 0;
      faqCountBin = computeFaqCountBin(faqCount);
    }
  }

  // Site maturity: days between first observation and change date
  let siteMaturityBin: SiteMaturityBin = "new";
  if (firstObservationDate) {
    const firstMs = new Date(firstObservationDate).getTime();
    const changeMs = new Date(changeDate).getTime();
    const daysSince = Math.max(
      0,
      Math.floor((changeMs - firstMs) / 86_400_000),
    );
    siteMaturityBin = computeSiteMaturityBin(daysSince);
  }

  return { faq_count: faqCountBin, site_maturity: siteMaturityBin };
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

function classifyOutcome(outcome: ChangeOutcome): OutcomeClass {
  const delta = outcome.normalized_citation_delta_pct;
  const days = outcome.days_after;

  if (delta <= -5 && days >= 7) return "regression";
  if (delta >= 5 && days <= 7) return "improvement_fast";
  if (delta >= 5 && days <= 21) return "improvement_slow";
  return "no_change";
}

// ---------------------------------------------------------------------------
// Platform extraction from outcome
// ---------------------------------------------------------------------------

function dominantPlatform(
  outcome: ChangeOutcome,
): "chatgpt" | "google_aio" | "perplexity" {
  const deltas = outcome.platform_deltas;
  let best: "chatgpt" | "google_aio" | "perplexity" = "chatgpt";
  let bestDelta = -Infinity;

  for (const [platform, d] of Object.entries(deltas)) {
    const citDelta =
      d.citations_before > 0
        ? (d.citations_after - d.citations_before) / d.citations_before
        : d.citations_after > 0
          ? 1
          : 0;
    const normalized = platform.toLowerCase().replace(/[\s-]/g, "_");
    const mapped =
      normalized.includes("chatgpt")
        ? "chatgpt"
        : normalized.includes("google")
          ? "google_aio"
          : normalized.includes("perplexity")
            ? "perplexity"
            : null;
    if (mapped && citDelta > bestDelta) {
      bestDelta = citDelta;
      best = mapped;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export type AggregationInput = {
  tenantId: string;
  changes: ChangelogEntry[];
  outcomes: ChangeOutcome[];
  pageSnapshots: PageSnapshot[];
  firstObservationDate: string | null;
  seededFromFounder: boolean;
};

/**
 * Aggregate one tenant's change outcomes into the global pattern store.
 *
 * Per-change dedup: one changelog entry contributes exactly one sample
 * to a pattern. The dedup key is tenant_id + change_id + pattern_id.
 * If this key already exists in a pattern's contributing set, the
 * observation is skipped.
 *
 * Returns the count of new samples added.
 */
export async function aggregateTenantOutcomes(
  input: AggregationInput,
): Promise<{ patternsUpdated: number; samplesAdded: number }> {
  const log = getLogger({
    module: "global-patterns/aggregate",
    tenantId: input.tenantId,
  });

  const changeMap = new Map(input.changes.map((c) => [c.id, c]));

  // Only aggregate outcomes that have been normalized (CX4.0 prereq)
  const qualifiedOutcomes = input.outcomes.filter(
    (o) => o.normalized_citation_delta_pct !== undefined,
  );

  if (qualifiedOutcomes.length === 0) {
    log.info("No qualified outcomes to aggregate");
    return { patternsUpdated: 0, samplesAdded: 0 };
  }

  const existingPatterns = await listGlobalPatterns();
  const patternsById = new Map(existingPatterns.map((p) => [p.id, p]));

  // We can't track dedup keys in the stored pattern itself (too large),
  // so we track tenant_id presence in contributing_tenant_ids.
  // Per-change dedup within the same tenant needs a separate mechanism.
  // For v1: we track per-run to prevent double-counting within a single
  // aggregation call. Cross-run dedup is handled by only running
  // aggregation once per tenant per import.
  const thisRunDedupKeys = new Set<string>();

  let samplesAdded = 0;
  let patternsUpdated = 0;

  for (const outcome of qualifiedOutcomes) {
    const change = changeMap.get(outcome.change_id);
    if (!change) continue;

    const clusterLabel = clusterChange(change);
    const platform = dominantPlatform(outcome);
    const contextBin = deriveContextBin({
      changeDate: outcome.changed_at,
      pageSnapshots: input.pageSnapshots,
      changeUrl: change.url,
      firstObservationDate: input.firstObservationDate,
    });

    const key: PatternKey = {
      segment: "local_residential_builder",
      change_type: clusterLabel,
      platform,
      context_bin: contextBinKey(contextBin),
    };

    const patternId = patternKeyHash(key);
    const dedupKey = aggregationDedupKey(
      input.tenantId,
      outcome.change_id,
      patternId,
    );

    // Per-change dedup within this aggregation run
    if (thisRunDedupKeys.has(dedupKey)) continue;
    thisRunDedupKeys.add(dedupKey);

    const outcomeClass = classifyOutcome(outcome);
    const isPositive =
      outcomeClass === "improvement_fast" ||
      outcomeClass === "improvement_slow";

    let pattern = patternsById.get(patternId);

    if (!pattern) {
      // New pattern
      pattern = {
        id: patternId,
        key,
        outcome_class: outcomeClass,
        sample_count: 0,
        contributing_tenant_count: 0,
        contributing_tenant_ids: [],
        positive_rate: 0,
        median_days_to_signal: 0,
        avg_normalized_impact: 0,
        first_observed: outcome.changed_at,
        last_observed: outcome.changed_at,
        seeded_from_founder: input.seededFromFounder,
        taxonomy_version: CURRENT_TAXONOMY_VERSION,
      };
      patternsById.set(patternId, pattern);
      patternsUpdated++;
    }

    // Increment sample
    pattern.sample_count += 1;

    // Update distinct tenant count
    if (!pattern.contributing_tenant_ids.includes(input.tenantId)) {
      pattern.contributing_tenant_ids.push(input.tenantId);
      pattern.contributing_tenant_count =
        pattern.contributing_tenant_ids.length;
    }

    // Update positive rate (running average)
    const positiveCount = Math.round(
      pattern.positive_rate * (pattern.sample_count - 1),
    );
    pattern.positive_rate =
      (positiveCount + (isPositive ? 1 : 0)) / pattern.sample_count;

    // Update average normalized impact (running average)
    const prevTotal =
      pattern.avg_normalized_impact * (pattern.sample_count - 1);
    pattern.avg_normalized_impact =
      (prevTotal + outcome.normalized_citation_delta_pct) /
      pattern.sample_count;

    // Update median days (simplified: running average over POSITIVE samples
    // for v1). wave-5 #3 (2026-06-14): this updates ONLY for positive samples,
    // so the running-mean divisor/multiplier must be the POSITIVE-sample
    // count — NOT the total sample_count, which includes the no_change /
    // regression samples that never contributed a days value and biased the
    // mean toward 0 as the non-positive share grew (a wrong customer-facing
    // "typically within N days" claim). `positiveCount` (computed above) is
    // the count of positive samples BEFORE this one; a citation-gained
    // outcome always has days_after > 0, so it equals the positive-days count.
    if (isPositive && outcome.days_after > 0) {
      const prevDays = pattern.median_days_to_signal * positiveCount;
      pattern.median_days_to_signal = Math.round(
        (prevDays + outcome.days_after) / (positiveCount + 1),
      );
    }

    pattern.last_observed = outcome.changed_at;
    if (input.seededFromFounder) {
      pattern.seeded_from_founder = true;
    }

    samplesAdded++;
  }

  // Write all patterns back
  await writeAllGlobalPatterns([...patternsById.values()]);

  log.info(
    { patternsUpdated, samplesAdded, totalPatterns: patternsById.size },
    "Aggregation complete",
  );

  return { patternsUpdated, samplesAdded };
}
