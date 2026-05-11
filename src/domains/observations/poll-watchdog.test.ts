/**
 * Pure-helper tests for the poll watchdog.
 *
 * Truth table covers the decisive behaviors the route depends on:
 *   - all platforms covered → skip
 *   - some platform missing → dispatch (carrying the missing list)
 *   - `failed` rows do NOT cover (retry path)
 *   - `running` rows DO cover (avoid duplicate dispatch while a run is mid-flight)
 *   - non-poll `run_type` rows are ignored (no false coverage from website_crawl)
 *   - empty input → dispatch every platform
 *   - case-insensitive scope_label match
 *   - extra unknown platforms in input don't break the decision
 */

import { describe, expect, it } from "vitest";

import {
  WATCHDOG_EXPECTED_PLATFORMS,
  shouldDispatchPoll,
  type WatchdogObservationRun,
} from "./poll-watchdog";

function row(
  overrides: Partial<WatchdogObservationRun> = {},
): WatchdogObservationRun {
  return {
    run_type: "citation_sample_import",
    scope_label: "Native chatgpt poll · chunk offset=0 limit=all · 100/100 prompts",
    status: "completed",
    ...overrides,
  };
}

describe("shouldDispatchPoll — happy path", () => {
  it("both platforms completed → no dispatch", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …" }),
        row({ scope_label: "Native perplexity poll · …" }),
      ],
    });
    expect(d.shouldDispatch).toBe(false);
    expect(d.reason).toBe("skipped_already_ran_today");
    expect([...d.coveredPlatforms].sort()).toEqual(["chatgpt", "perplexity"]);
  });

  it("one platform missing → dispatch with that platform listed", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …" }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
    if (d.shouldDispatch) {
      expect(d.missingPlatforms).toEqual(["perplexity"]);
      expect(d.coveredPlatforms).toEqual(["chatgpt"]);
    }
  });

  it("empty input → dispatch every expected platform", () => {
    const d = shouldDispatchPoll({ todayObservationRuns: [] });
    expect(d.shouldDispatch).toBe(true);
    if (d.shouldDispatch) {
      expect([...d.missingPlatforms].sort()).toEqual(["chatgpt", "perplexity"]);
    }
  });
});

describe("shouldDispatchPoll — status semantics", () => {
  it("'running' covers (avoids duplicate dispatch while a run is mid-flight)", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …", status: "running" }),
        row({ scope_label: "Native perplexity poll · …", status: "running" }),
      ],
    });
    expect(d.shouldDispatch).toBe(false);
  });

  it("'failed' does NOT cover (retry path)", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …", status: "failed" }),
        row({ scope_label: "Native perplexity poll · …", status: "completed" }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
    if (d.shouldDispatch) {
      expect(d.missingPlatforms).toEqual(["chatgpt"]);
    }
  });

  it("a 'completed' row alongside a 'failed' row for the same platform → covered", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · failed-attempt", status: "failed" }),
        row({ scope_label: "Native chatgpt poll · retry-attempt", status: "completed" }),
        row({ scope_label: "Native perplexity poll · …", status: "completed" }),
      ],
    });
    expect(d.shouldDispatch).toBe(false);
  });

  it("unknown status (defensive) does NOT cover", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …", status: "wat" }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
  });
});

describe("shouldDispatchPoll — run_type filter", () => {
  it("website_crawl rows do NOT cover (even if scope_label coincidentally mentions a platform)", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        // pathological — a scan row that happens to mention 'chatgpt' must not count.
        row({
          run_type: "website_crawl",
          scope_label: "Sitemap canonical scan · mention chatgpt in description",
          status: "completed",
        }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
  });

  it("only citation_sample_import rows are considered", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ run_type: "scan", scope_label: "Native chatgpt poll · …" }),
        row({ run_type: "poll", scope_label: "Native perplexity poll · …" }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
    if (d.shouldDispatch) {
      expect([...d.missingPlatforms].sort()).toEqual(["chatgpt", "perplexity"]);
    }
  });
});

describe("shouldDispatchPoll — scope_label parsing", () => {
  it("case-insensitive match on platform name", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "NATIVE CHATGPT POLL · 100/100" }),
        row({ scope_label: "Native Perplexity Poll · 100/100" }),
      ],
    });
    expect(d.shouldDispatch).toBe(false);
  });

  it("null scope_label is treated as empty (covers nothing)", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: null }),
        row({ scope_label: null }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
  });

  it("scope_label without the 'Native <platform> poll' phrase covers nothing", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "ad-hoc chatgpt experiment" }),
        row({ scope_label: "something perplexity related" }),
      ],
    });
    expect(d.shouldDispatch).toBe(true);
  });
});

describe("shouldDispatchPoll — overridable expectations", () => {
  it("only one expected platform → only that platform must be covered", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [
        row({ scope_label: "Native chatgpt poll · …" }),
      ],
      expectedPlatforms: ["chatgpt"],
    });
    expect(d.shouldDispatch).toBe(false);
  });

  it("empty expected list → vacuously no dispatch (operator-locked override)", () => {
    const d = shouldDispatchPoll({
      todayObservationRuns: [],
      expectedPlatforms: [],
    });
    expect(d.shouldDispatch).toBe(false);
  });
});

describe("WATCHDOG_EXPECTED_PLATFORMS", () => {
  it("exports the operator-locked default list (chatgpt + perplexity)", () => {
    expect([...WATCHDOG_EXPECTED_PLATFORMS].sort()).toEqual([
      "chatgpt",
      "perplexity",
    ]);
  });
});
