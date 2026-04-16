/**
 * Visibility Event Engine — crawl alignment (E1.7).
 *
 * Finds the most recent website crawl that completed BEFORE a given event
 * start and records the gap in days. This is the only crawl timestamp
 * Beacon can actually observe — it's the self-crawl, not the LLM fetch
 * timestamp. We surface it as context for operators so they can see
 * whether Beacon had an observation opportunity close to the event, but
 * we never use it as an attribution input.
 *
 * Pure function — accepts observation runs as a parameter rather than
 * calling `listWebsiteCrawlRuns` internally, so tests and non-server
 * callers can supply in-memory data.
 *
 * Known blind spot (documented in plan Part 10): this tells us when
 * Beacon crawled the site, NOT when ChatGPT / Google / Perplexity
 * fetched it. Those platform-side fetch timestamps are inaccessible.
 */

import type { ObservationRun } from "@/domains/observations/types";
import type { CrawlAlignment, Spike } from "./types";

const EMPTY_ALIGNMENT: CrawlAlignment = {
  runId: null,
  crawlCompletedAt: null,
  daysBeforeEvent: null,
};

function msAtNoonUtc(dateYmd: string): number {
  return new Date(`${dateYmd}T12:00:00Z`).getTime();
}

function calendarDayMs(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

/**
 * Compute crawl alignment for a single spike.
 *
 * Returns the most recent website_crawl run that completed BEFORE the
 * spike start, along with the number of days between crawl completion
 * and spike start. When no runs match (empty input, only future runs,
 * only non-website-crawl runs) returns an empty alignment record.
 *
 * Input does NOT need to be pre-filtered — this function filters to
 * `run_type === "website_crawl"` and `status === "completed"` itself.
 */
export function computeCrawlAlignment(opts: {
  spike: Spike;
  observationRuns: ObservationRun[];
}): CrawlAlignment {
  const { spike, observationRuns } = opts;
  if (observationRuns.length === 0) return EMPTY_ALIGNMENT;

  const spikeStartMs = msAtNoonUtc(spike.startDate);

  // Filter to completed website crawls that finished before the event.
  const eligible = observationRuns.filter((r) => {
    if (r.run_type !== "website_crawl") return false;
    if (r.status !== "completed") return false;
    const completedMs = new Date(r.completed_at).getTime();
    if (Number.isNaN(completedMs)) return false;
    return completedMs < spikeStartMs;
  });

  if (eligible.length === 0) return EMPTY_ALIGNMENT;

  // Pick the most-recent completed run.
  eligible.sort(
    (a, b) =>
      new Date(b.completed_at).getTime() -
      new Date(a.completed_at).getTime(),
  );
  const latest = eligible[0];

  // Compute gap in calendar days so the result is stable regardless of
  // time-of-day on either side (spike.startDate maps to noon, but
  // completed_at can be any hour). Normalize both to midnight UTC.
  const spikeDayMs = calendarDayMs(spikeStartMs);
  const crawlDayMs = calendarDayMs(new Date(latest.completed_at).getTime());
  const daysBefore = Math.max(
    0,
    Math.round((spikeDayMs - crawlDayMs) / 86_400_000),
  );

  return {
    runId: latest.run_id,
    crawlCompletedAt: latest.completed_at,
    daysBeforeEvent: daysBefore,
  };
}
