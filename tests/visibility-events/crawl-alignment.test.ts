/**
 * Crawl alignment tests — E1.7.
 *
 * Exercises computeCrawlAlignment:
 *   - Empty runs → empty alignment
 *   - Most recent pre-event website_crawl wins
 *   - Runs AFTER the event are ignored
 *   - Non-website-crawl runs are ignored
 *   - daysBeforeEvent is computed correctly
 */

import { describe, it, expect } from "vitest";
import { computeCrawlAlignment } from "@/domains/visibility-events/crawl-alignment";
import type { Spike } from "@/domains/visibility-events/types";
import type { ObservationRun } from "@/domains/observations/types";

function makeSpike(startDate: string): Spike {
  return {
    id: `spike-${startDate}`,
    metric: "citations",
    platform: "chatgpt",
    scopeId: "Custom Home Builder Bay Area",
    startDate,
    peakDate: startDate,
    peakValue: 50,
    baseline: 20,
    absoluteDelta: 30,
    relativeRatio: 2.5,
    dayCount: 1,
    isEmerging: false,
  };
}

function makeRun(
  runId: string,
  completed_at: string,
  run_type: ObservationRun["run_type"] = "website_crawl",
  status: ObservationRun["status"] = "completed",
): ObservationRun {
  return {
    run_id: runId,
    run_type,
    source: "test",
    status,
    started_at: completed_at,
    completed_at,
    scope_label: "Test",
    pages_scanned: 0,
    pages_changed: 0,
    pages_with_errors: 0,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
  };
}

describe("computeCrawlAlignment", () => {
  it("returns empty alignment when no runs supplied", () => {
    const result = computeCrawlAlignment({
      spike: makeSpike("2026-04-13"),
      observationRuns: [],
    });
    expect(result.runId).toBeNull();
    expect(result.crawlCompletedAt).toBeNull();
    expect(result.daysBeforeEvent).toBeNull();
  });

  it("picks the most recent completed website_crawl before the event", () => {
    const result = computeCrawlAlignment({
      spike: makeSpike("2026-04-13"),
      observationRuns: [
        makeRun("old", "2026-04-05T00:00:00Z"),
        makeRun("latest", "2026-04-11T00:00:00Z"),
        makeRun("mid", "2026-04-08T00:00:00Z"),
      ],
    });
    expect(result.runId).toBe("latest");
    expect(result.crawlCompletedAt).toBe("2026-04-11T00:00:00Z");
    expect(result.daysBeforeEvent).toBe(2);
  });

  it("ignores runs that completed AFTER the event start", () => {
    const result = computeCrawlAlignment({
      spike: makeSpike("2026-04-13"),
      observationRuns: [
        makeRun("before", "2026-04-08T00:00:00Z"),
        makeRun("after", "2026-04-14T00:00:00Z"),
      ],
    });
    expect(result.runId).toBe("before");
  });

  it("ignores non-website-crawl run types", () => {
    const result = computeCrawlAlignment({
      spike: makeSpike("2026-04-13"),
      observationRuns: [
        makeRun("citation-import", "2026-04-12T00:00:00Z", "citation_sample_import"),
        makeRun("verify", "2026-04-12T00:00:00Z", "website_verify"),
        makeRun("crawl", "2026-04-09T00:00:00Z", "website_crawl"),
      ],
    });
    expect(result.runId).toBe("crawl");
  });

  it("ignores non-completed crawl runs", () => {
    const result = computeCrawlAlignment({
      spike: makeSpike("2026-04-13"),
      observationRuns: [
        makeRun("failed", "2026-04-12T00:00:00Z", "website_crawl", "failed"),
        makeRun("ok", "2026-04-09T00:00:00Z", "website_crawl", "completed"),
      ],
    });
    expect(result.runId).toBe("ok");
  });
});
